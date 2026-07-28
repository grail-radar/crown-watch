/**
 * End-to-end tests for the Tier 4 pipeline.
 *
 * Everything runs through the real service and a real database; only the two
 * network seams are replaced — SiteFetcher inbound, TelegramClient outbound.
 * Each test states what the store returned and asserts on what a user would
 * see: which drops exist, whether they are public, and what reached the
 * channels.
 */
import { ConfigService } from '@nestjs/config';
import { SourceHealth, SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { CatalogService } from '../catalog/catalog.service';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { RobotsService } from './robots.service';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { SiteWatchService } from './site-watch.service';

/** Serves whatever the test says the store is showing right now. */
class StubFetcher extends SiteFetcher {
  next: FetchResult = { status: 200, body: '{"products":[]}' };
  calls: string[] = [];
  /** Served for any /robots.txt request; empty means "no restrictions". */
  robotsTxt = '';

  async fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    if (url.endsWith('/robots.txt')) {
      return { status: this.robotsTxt ? 200 : 404, body: this.robotsTxt };
    }
    return this.next;
  }

  /** Requests that actually hit the store, ignoring robots.txt lookups. */
  get storeCalls(): string[] {
    return this.calls.filter((u) => !u.endsWith('/robots.txt'));
  }

  /** Shape a Shopify-style response from a compact description. */
  serve(
    products: Array<{ handle: string; title?: string; price?: string; available: boolean; image?: string }>,
  ) {
    this.next = {
      status: 200,
      body: JSON.stringify({
        products: products.map((p) => ({
          handle: p.handle,
          title: p.title ?? p.handle,
          variants: [{ available: p.available, price: p.price ?? '500.00' }],
          images: p.image ? [{ src: p.image }] : [],
        })),
      }),
    };
  }
}

const ENDPOINT = 'https://brand.example/products.json';
const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';

describe('SiteWatchService', () => {
  let prisma: PrismaService;
  let fetcher: StubFetcher;
  let telegram: CapturingTelegram;
  let alerts: AlertDispatchService;
  let service: SiteWatchService;
  let robots: RobotsService;
  let catalog: CatalogService;
  const brandIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    fetcher = new StubFetcher();
    telegram = new CapturingTelegram();
    const config = new ConfigService({
      digest: { publicWebUrl: 'https://crownswatch.org' },
      siteWatch: { userAgent: 'CrownWatchBot/0.1 (+https://crownswatch.org)' },
      telegram: {
        botToken: 'test-token',
        channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
      },
    });
    alerts = new AlertDispatchService(prisma, config, telegram);
    robots = new RobotsService(fetcher, config);
    service = new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      alerts,
      robots,
    );
    catalog = new CatalogService(prisma);
  });

  beforeEach(() => {
    telegram.sent = [];
    fetcher.calls = [];
    fetcher.robotsTxt = '';
    // robots.txt is cached per origin, and every fixture shares one origin.
    robots.clearCache();
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.rawIngestionEvent.deleteMany({
      where: { sourceId: { in: sourceIds } },
    });
    await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /** A brand with a site-watch source pointing at its store. */
  async function arrangeSource(over: { brandId?: string; watchConfig?: unknown } = {}) {
    let brandId = over.brandId;
    if (!brandId) {
      const tag = randomUUID().slice(0, 8);
      const brand = await prisma.brand.create({
        data: { name: `Watch Co ${tag}`, slug: `watch-co-${tag}` },
      });
      brandIds.push(brand.id);
      brandId = brand.id;
    }
    const source = await prisma.source.create({
      data: {
        type: SourceType.site_watch,
        name: 'Store',
        // Sources are unique on (type, endpoint); the query string keeps each
        // fixture distinct while the origin — and so every product URL — stays
        // the same.
        endpoint: `${ENDPOINT}?s=${randomUUID()}`,
        brandId,
        watchConfig:
          over.watchConfig === undefined
            ? { adapter: 'shopify_products_json', currency: 'EUR' }
            : (over.watchConfig as never),
      },
    });
    sourceIds.push(source.id);
    return { source, brandId };
  }

  const dropsFor = (brandId: string) =>
    prisma.drop.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } });

  it('records a baseline on first sight and announces nothing', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'chrono', available: false },
    ]);

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('ok');
    expect(result.baseline).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.productCount).toBe(2);
    expect(result.dropsCreated).toBe(0);
    expect(await dropsFor(brandId)).toHaveLength(0);
    // The snapshot itself is kept, so the next poll has something to diff.
    expect(await prisma.rawIngestionEvent.count({ where: { sourceId: source.id } })).toBe(1);
  });

  it('creates nothing when the store is unchanged', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);

    const result = await service.pollSource(source.id);

    expect(result.changed).toBe(false);
    expect(result.dropsCreated).toBe(0);
    expect(await dropsFor(brandId)).toHaveLength(0);
    // No duplicate snapshot for an unchanged store.
    expect(await prisma.rawIngestionEvent.count({ where: { sourceId: source.id } })).toBe(1);
  });

  it('publishes a new release when a product appears', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);

    fetcher.serve([
      { handle: 'diver', available: true },
      {
        handle: 'field',
        title: 'Field Watch',
        price: '650.00',
        available: true,
        image: 'https://cdn.example/field.jpg',
      },
    ]);
    const result = await service.pollSource(source.id);

    expect(result.dropsCreated).toBe(1);
    const drops = await dropsFor(brandId);
    expect(drops).toHaveLength(1);
    expect(drops[0].title).toBe('Field Watch');
    expect(drops[0].type).toBe('pre_order');
    expect(Number(drops[0].priceLow)).toBe(650);
    expect(drops[0].currency).toBe('EUR');
    expect(drops[0].sourceUrl).toBe('https://brand.example/products/field');
    expect(drops[0].imageUrl).toBe('https://cdn.example/field.jpg');
  });

  it('publishes a restock when a sold-out product becomes available', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', title: 'Diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
    const result = await service.pollSource(source.id);

    expect(result.dropsCreated).toBe(1);
    const drops = await dropsFor(brandId);
    expect(drops[0].type).toBe('restock');
    expect(drops[0].title).toBe('Diver');
  });

  it('says nothing when a product sells out or only its price moves', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([
      { handle: 'diver', available: true, price: '500.00' },
      { handle: 'chrono', available: true, price: '700.00' },
    ]);
    await service.pollSource(source.id);

    fetcher.serve([
      { handle: 'diver', available: false, price: '500.00' }, // sold out
      { handle: 'chrono', available: true, price: '750.00' }, // price rise
    ]);
    const result = await service.pollSource(source.id);

    expect(result.changed).toBe(true); // the snapshot did move…
    expect(result.dropsCreated).toBe(0); // …but nothing worth interrupting anyone
    expect(await dropsFor(brandId)).toHaveLength(0);
  });

  it('detects a restock even when the catalogue returns to an earlier state', async () => {
    // The canonical silent restock: in stock → sold out → back in stock. The
    // third poll's catalogue is byte-identical to the first, so any dedup that
    // compares against all history (rather than the previous poll) would treat
    // it as "nothing changed" and swallow the alert.
    const { source, brandId } = await arrangeSource();

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
    const result = await service.pollSource(source.id);

    expect(result.changed).toBe(true);
    expect(result.dropsCreated).toBe(1);
    const drops = await dropsFor(brandId);
    expect(drops).toHaveLength(1);
    expect(drops[0].type).toBe('restock');
  });

  it('reports several changes from a single poll', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([
      { handle: 'diver', available: true }, // restock
      { handle: 'field', available: true }, // new release
      { handle: 'pilot', available: true }, // new release
    ]);
    const result = await service.pollSource(source.id);

    expect(result.dropsCreated).toBe(3);
    const drops = await dropsFor(brandId);
    expect(drops.filter((d) => d.type === 'restock')).toHaveLength(1);
    expect(drops.filter((d) => d.type === 'pre_order')).toHaveLength(2);
  });

  it('publishes site-watch drops immediately, bypassing the moderation queue', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', available: true },
    ]);
    await service.pollSource(source.id);

    const [drop] = await dropsFor(brandId);
    expect(drop.moderationStatus).toBe('approved');
    expect(drop.publishedAt).not.toBeNull();
    // Nobody reviewed it — that is what marks it auto-published.
    expect(drop.reviewedAt).toBeNull();
    // And it must not sit in the queue a human works through.
    const queued = await prisma.drop.count({
      where: { brandId, moderationStatus: 'pending' },
    });
    expect(queued).toBe(0);
  });

  it('serves the drop from the public catalogue the website reads', async () => {
    // Asserting the two columns is not the same as proving the public API
    // returns it — this drives the real CatalogService.
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', title: 'Field Watch', available: true },
    ]);
    await service.pollSource(source.id);

    const feed = await catalog.listPublishedDrops(100);
    const mine = feed.drops.filter((d) => d.brand.slug.startsWith('watch-co-'));
    expect(mine.some((d) => d.title === 'Field Watch')).toBe(true);

    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    const detail = await catalog.getBrandBySlug(brand.slug);
    expect(detail.drops.map((d) => d.title)).toContain('Field Watch');
  });

  it('reports which products changed, not just how many', async () => {
    const { source } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', title: 'Diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([
      { handle: 'diver', title: 'Diver', available: true },
      { handle: 'field', title: 'Field Watch', available: true },
    ]);
    const result = await service.pollSource(source.id);

    expect(result.changes).toHaveLength(2);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'restock', type: 'restock', title: 'Diver' }),
        expect.objectContaining({
          kind: 'new_product',
          type: 'pre_order',
          title: 'Field Watch',
          url: 'https://brand.example/products/field',
        }),
      ]),
    );
  });

  it('keeps provenance back to the site-watch source', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', available: true },
    ]);
    await service.pollSource(source.id);

    const drop = await prisma.drop.findFirstOrThrow({
      where: { brandId },
      include: { sourceEvent: { include: { source: true } } },
    });
    expect(drop.sourceEvent?.source.id).toBe(source.id);
    expect(drop.sourceEvent?.source.type).toBe(SourceType.site_watch);
  });

  it('puts a detected drop on both channels the moment it is found', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);

    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', title: 'Field Watch', price: '650.00', available: true },
    ]);
    const result = await service.pollSource(source.id);

    expect(result.broadcastsSent).toBe(2);
    expect(result.changes[0].broadcasts).toBe(2);
    expect(telegram.sent.map((s) => s.chatId).sort()).toEqual(
      [EN_CHANNEL, UK_CHANNEL].sort(),
    );

    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    for (const message of telegram.sent) {
      expect(message.text).toContain('Field Watch');
      expect(message.text).toContain(brand.name);
      expect(message.text).toContain('650 EUR');
      expect(message.text).toContain('https://brand.example/products/field');
      expect(message.text).toContain(`https://crownswatch.org/brands/${brand.slug}`);
    }
  });

  it('says nothing more when a later poll finds the store unchanged', async () => {
    // The outer of the two guards: the snapshot diff finds no change, so no
    // drop is created and dispatch is never reached. This does NOT exercise the
    // drop-level dedup — the test below does that.
    const { source } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', title: 'Diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
    await service.pollSource(source.id); // the restock — announced once
    expect(telegram.sent).toHaveLength(2);

    const repeat = await service.pollSource(source.id);

    expect(repeat.changed).toBe(false);
    expect(repeat.dropsCreated).toBe(0);
    expect(telegram.sent).toHaveLength(2);
  });

  it('will not re-announce a drop the pipeline already broadcast', async () => {
    // The inner guard, on a drop the real pipeline produced: handing that same
    // drop back to the dispatcher — an overlapping run, a retry, an operator
    // re-firing dispatch — must not produce a second post.
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', title: 'Diver', available: false }]);
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
    await service.pollSource(source.id);
    expect(telegram.sent).toHaveLength(2);

    const [drop] = await dropsFor(brandId);
    const again = await alerts.broadcastDrop(drop.id);

    expect(again.sentCount).toBe(0);
    expect(again.channels.every((c) => c.outcome === 'skipped')).toBe(true);
    expect(telegram.sent).toHaveLength(2);
  });

  it('creates the drop even when every channel is down', async () => {
    // Ingestion must not depend on Telegram being reachable.
    const silent = new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      new AlertDispatchService(
        prisma,
        new ConfigService({
          digest: { publicWebUrl: 'https://crownswatch.org' },
          telegram: {
            botToken: 'test-token',
            channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
          },
        }),
        (() => {
          const down = new CapturingTelegram();
          down.onSend = () => {
            throw new Error('Telegram is down');
          };
          return down;
        })(),
      ),
      robots,
    );

    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await silent.pollSource(source.id);
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', title: 'Field Watch', available: true },
    ]);
    const result = await silent.pollSource(source.id);

    expect(result.status).toBe('ok');
    expect(result.dropsCreated).toBe(1);
    expect(result.broadcastsSent).toBe(0);
    expect(await dropsFor(brandId)).toHaveLength(1);
  });

  it('polls and publishes normally when Telegram is not configured at all', async () => {
    const unconfigured = new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      new AlertDispatchService(
        prisma,
        new ConfigService({
          digest: { publicWebUrl: 'https://crownswatch.org' },
          telegram: { botToken: undefined, channels: {} },
        }),
        telegram,
      ),
      robots,
    );

    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await unconfigured.pollSource(source.id);
    fetcher.serve([
      { handle: 'diver', available: true },
      { handle: 'field', available: true },
    ]);
    const result = await unconfigured.pollSource(source.id);

    expect(result.status).toBe('ok');
    expect(result.dropsCreated).toBe(1);
    expect(result.broadcastsSent).toBe(0);
    expect(telegram.sent).toHaveLength(0);
    // The drop is still published to the site — only the alert was skipped.
    const [drop] = await dropsFor(brandId);
    expect(drop.publishedAt).not.toBeNull();
  });

  it('marks the source unhealthy when the store errors, and creates nothing', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.next = { status: 429, body: 'slow down' };

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.error).toContain('429');
    expect(await dropsFor(brandId)).toHaveLength(0);
    const reloaded = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    // `degraded`, not `error`: one rate-limit response is a store having a
    // moment, and health only escalates once failures persist. The escalation
    // itself is covered below.
    expect(reloaded.healthStatus).toBe(SourceHealth.degraded);
    expect(reloaded.lastPolledAt).not.toBeNull();
    expect(reloaded.nextAttemptAt).not.toBeNull();
  });

  it('refuses to treat an empty catalogue as the truth', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);
    await service.pollSource(source.id);

    fetcher.serve([]); // a broken selector or a blocked request looks like this
    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(await dropsFor(brandId)).toHaveLength(0);
    // The good snapshot is still the latest one we hold.
    expect(await prisma.rawIngestionEvent.count({ where: { sourceId: source.id } })).toBe(1);
  });

  it('fails clearly when the source has no brand attached', async () => {
    const source = await prisma.source.create({
      data: {
        type: SourceType.site_watch,
        name: 'Orphan store',
        endpoint: `${ENDPOINT}?s=${randomUUID()}`,
        watchConfig: { adapter: 'shopify_products_json' },
      },
    });
    sourceIds.push(source.id);
    fetcher.serve([{ handle: 'diver', available: true }]);

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/brand/i);
  });

  it('fails clearly when the adapter is unknown', async () => {
    const { source } = await arrangeSource({ watchConfig: { adapter: 'wat' } });
    fetcher.serve([{ handle: 'diver', available: true }]);

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/adapter/i);
  });

  it('polls every site-watch source and keeps going after one fails', async () => {
    const good = await arrangeSource();
    const broken = await arrangeSource({ watchConfig: { adapter: 'wat' } });
    fetcher.serve([{ handle: 'diver', available: true }]);

    const run = await service.pollAll();

    const ours = run.sources.filter((s) =>
      [good.source.id, broken.source.id].includes(s.sourceId),
    );
    expect(ours).toHaveLength(2);
    expect(ours.find((s) => s.sourceId === good.source.id)?.status).toBe('ok');
    expect(ours.find((s) => s.sourceId === broken.source.id)?.status).toBe('error');
  });

  describe('a brand with no structured product endpoint', () => {
    const HTML_SELECTORS = {
      adapter: 'html_selectors',
      currency: 'EUR',
      selectors: {
        item: '.product-card',
        link: '.product-card__link',
        title: '.product-card__title',
        price: '.price',
        soldOut: '.badge--sold-out',
      },
    };

    /** A listing page built from a compact description of what it shows. */
    const page = (
      products: Array<{ handle: string; title: string; price?: string; soldOut?: boolean }>,
      banner = 'Free shipping this week',
    ) => `<!doctype html><html><body>
      <div class="announcement">${banner}</div>
      <ul class="product-grid">
        ${products
          .map(
            (p) => `<li class="product-card">
              <a class="product-card__link" href="/products/${p.handle}?ref=grid">
                <h3 class="product-card__title">${p.title}</h3>
              </a>
              <span class="price">€ ${p.price ?? '500.00'}</span>
              ${p.soldOut ? '<span class="badge badge--sold-out">Sold out</span>' : ''}
            </li>`,
          )
          .join('')}
      </ul></body></html>`;

    it('watches an HTML store end to end, sharing the same pipeline', async () => {
      const { source, brandId } = await arrangeSource({ watchConfig: HTML_SELECTORS });
      fetcher.next = {
        status: 200,
        body: page([{ handle: 'diver', title: 'Harbour Diver' }]),
      };
      const first = await service.pollSource(source.id);
      expect(first.baseline).toBe(true);
      expect(await dropsFor(brandId)).toHaveLength(0);

      fetcher.next = {
        status: 200,
        body: page([
          { handle: 'diver', title: 'Harbour Diver' },
          { handle: 'field', title: 'Foundry Field', price: '640.00' },
        ]),
      };
      const second = await service.pollSource(source.id);

      expect(second.dropsCreated).toBe(1);
      const drops = await dropsFor(brandId);
      expect(drops[0].title).toBe('Foundry Field');
      expect(drops[0].type).toBe('pre_order');
      expect(Number(drops[0].priceLow)).toBe(640);
      expect(drops[0].currency).toBe('EUR');
      expect(drops[0].sourceUrl).toBe('https://brand.example/products/field');
      // Same alerting as the structured path — nothing is duplicated per adapter.
      expect(second.broadcastsSent).toBe(2);
    });

    it('turns a sold-out badge disappearing into a restock', async () => {
      const { source, brandId } = await arrangeSource({ watchConfig: HTML_SELECTORS });
      fetcher.next = {
        status: 200,
        body: page([{ handle: 'gmt', title: 'Meridian GMT', soldOut: true }]),
      };
      await service.pollSource(source.id);

      fetcher.next = {
        status: 200,
        body: page([{ handle: 'gmt', title: 'Meridian GMT' }]),
      };
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect((await dropsFor(brandId))[0].type).toBe('restock');
    });

    it('stays silent when only the marketing furniture changed', async () => {
      const { source, brandId } = await arrangeSource({ watchConfig: HTML_SELECTORS });
      const products = [{ handle: 'diver', title: 'Harbour Diver' }];
      fetcher.next = { status: 200, body: page(products, 'Free shipping this week') };
      await service.pollSource(source.id);

      fetcher.next = { status: 200, body: page(products, 'SUMMER SALE — 20% off') };
      const result = await service.pollSource(source.id);

      expect(result.changed).toBe(false);
      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
    });

    it('goes unhealthy rather than silently reporting an empty catalogue', async () => {
      // A store redesign is the realistic case: the selectors stop matching and
      // the page still returns 200. Treating that as "no products" would look
      // like the brand delisting everything.
      const { source, brandId } = await arrangeSource({ watchConfig: HTML_SELECTORS });
      fetcher.next = {
        status: 200,
        body: page([{ handle: 'diver', title: 'Harbour Diver' }]),
      };
      await service.pollSource(source.id);

      fetcher.next = {
        status: 200,
        body: '<!doctype html><html><body><ul class="redesigned"></ul></body></html>',
      };
      const result = await service.pollSource(source.id);

      expect(result.status).toBe('error');
      expect(result.error).toMatch(/no products/i);
      expect(result.health).toBe(SourceHealth.degraded);
      // Nothing was created and nothing was deleted — the good snapshot stands.
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(
        await prisma.rawIngestionEvent.count({ where: { sourceId: source.id } }),
      ).toBe(1);
    });

    it('fails clearly when the selectors are missing', async () => {
      const { source } = await arrangeSource({
        watchConfig: { adapter: 'html_selectors' },
      });
      fetcher.next = { status: 200, body: page([{ handle: 'a', title: 'A' }]) };

      const result = await service.pollSource(source.id);

      expect(result.status).toBe('error');
      expect(result.error).toMatch(/selectors/i);
    });
  });

  it('calls a first failure degraded, not broken', async () => {
    // One bad fetch is usually the internet. Escalating straight to "error"
    // would train an operator to ignore the field.
    const { source } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.health).toBe(SourceHealth.degraded);
    expect(result.consecutiveFailures).toBe(1);
    expect(result.nextAttemptAt).not.toBeNull();
    const reloaded = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(reloaded.healthStatus).toBe(SourceHealth.degraded);
    expect(reloaded.lastError).toContain('500');
    expect(reloaded.lastPolledAt).not.toBeNull();
  });

  it('escalates to error once a source keeps failing', async () => {
    const { source } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };

    // force=true is the operator retrying; it must not also skip escalation.
    await service.pollSource(source.id, { force: true });
    await service.pollSource(source.id, { force: true });
    const third = await service.pollSource(source.id, { force: true });

    expect(third.consecutiveFailures).toBe(3);
    expect(third.health).toBe(SourceHealth.error);
  });

  it('leaves a backing-off source completely alone', async () => {
    const { source } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };
    await service.pollSource(source.id);
    fetcher.calls = [];

    const skipped = await service.pollSource(source.id);

    expect(skipped.status).toBe('skipped');
    expect(skipped.skippedReason).toMatch(/backing off/);
    // The whole point: a source in backoff costs the store no request at all.
    expect(fetcher.storeCalls).toHaveLength(0);
  });

  it('lets an operator force past the backoff window', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };
    await service.pollSource(source.id);

    // The operator fixed the store and does not want to wait 15 minutes.
    fetcher.serve([{ handle: 'diver', available: true }]);
    const forced = await service.pollSource(source.id, { force: true });

    expect(forced.status).toBe('ok');
    expect(forced.baseline).toBe(true);
    expect(await dropsFor(brandId)).toHaveLength(0);
  });

  it('waits as long as a rate-limited store asks it to', async () => {
    const { source } = await arrangeSource();
    const twoHours = 2 * 60 * 60;
    fetcher.next = { status: 429, body: 'slow down', retryAfterSeconds: twoHours };

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/rate limited/i);
    // Retry-After is longer than our own first-failure curve, so it wins.
    const waitMs = new Date(result.nextAttemptAt!).getTime() - Date.now();
    expect(waitMs).toBeGreaterThan(1.9 * 60 * 60 * 1000);
  });

  it('records a source as healthy again once it recovers', async () => {
    const { source } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };
    await service.pollSource(source.id);

    fetcher.serve([{ handle: 'diver', available: true }]);
    const recovered = await service.pollSource(source.id, { force: true });

    expect(recovered.status).toBe('ok');
    expect(recovered.health).toBe(SourceHealth.healthy);
    expect(recovered.consecutiveFailures).toBe(0);
    const reloaded = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(reloaded.healthStatus).toBe(SourceHealth.healthy);
    // Window and stale error both cleared, so the next scheduled run treats it
    // as an ordinary source again.
    expect(reloaded.nextAttemptAt).toBeNull();
    expect(reloaded.lastError).toBeNull();
  });

  it('does not fetch a path robots.txt disallows', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.robotsTxt = 'User-agent: *\nDisallow: /products.json';
    fetcher.serve([{ handle: 'diver', available: true }]);

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('skipped');
    expect(result.skippedReason).toMatch(/robots/i);
    expect(fetcher.storeCalls).toHaveLength(0);
    expect(await dropsFor(brandId)).toHaveLength(0);
    // Being told not to crawl is obedience, not a fault — health is untouched.
    const reloaded = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(reloaded.healthStatus).not.toBe(SourceHealth.error);
    expect(reloaded.consecutiveFailures).toBe(0);
  });

  it('polls normally when robots.txt allows the path', async () => {
    const { source } = await arrangeSource();
    fetcher.robotsTxt = 'User-agent: *\nDisallow: /admin\nCrawl-delay: 1';
    fetcher.serve([{ handle: 'diver', available: true }]);

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('ok');
    expect(fetcher.storeCalls).toHaveLength(1);
  });

  it('reports a run as successful with its failures itemised', async () => {
    // A run that throws on the first bad shop would page someone every time a
    // single store had a bad night.
    const good = await arrangeSource();
    const broken = await arrangeSource({ watchConfig: { adapter: 'wat' } });
    fetcher.serve([{ handle: 'diver', available: true }]);

    const run = await service.pollAll();

    expect(run.failureCount).toBeGreaterThanOrEqual(1);
    expect(run.sources.find((s) => s.sourceId === good.source.id)?.status).toBe('ok');
    const failed = run.sources.find((s) => s.sourceId === broken.source.id);
    expect(failed?.status).toBe('error');
    expect(failed?.error).toMatch(/adapter/i);
    expect(failed?.health).toBe(SourceHealth.degraded);
  });
});
