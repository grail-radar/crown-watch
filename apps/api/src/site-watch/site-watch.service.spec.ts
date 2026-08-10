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
import { LinkProbe } from './link-probe';
import { RobotsService } from './robots.service';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { SiteWatchService } from './site-watch.service';
import { WatchWriterService } from './watch-writer.service';

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
      siteWatch: {
        userAgent: 'CrownWatchBot/0.1 (+https://crownswatch.org)',
        // Pacing is asserted by one test that passes its own delay; every
        // other test would otherwise wait two seconds per source.
        pollDelayMs: 0,
      },
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
      new WatchWriterService(prisma),
      alerts,
      robots,
      new LinkProbe(fetcher, robots),
      config,
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

  /** The same service, with its own view of how big one poll may be. */
  const serviceWithLimit = (maxChangesPerPoll: number) =>
    new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      new WatchWriterService(prisma),
      alerts,
      robots,
      new LinkProbe(fetcher, robots),
      new ConfigService({
        digest: { publicWebUrl: 'https://crownswatch.org' },
        siteWatch: {
          userAgent: 'CrownWatchBot/0.1 (+https://crownswatch.org)',
          pollDelayMs: 0,
          maxChangesPerPoll,
        },
        telegram: {
          botToken: 'test-token',
          channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
        },
      }),
    );

  /** A catalogue of `count` distinct in-stock products. */
  const catalogueOf = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      handle: `ref-${i}`,
      title: `Watch ref ${i}`,
      available: true,
    }));

  const dropsFor = (brandId: string) =>
    prisma.drop.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' } });

  const watchesFor = (brandId: string) =>
    prisma.watch.findMany({
      where: { brandId },
      include: { variants: true },
      orderBy: { name: 'asc' },
    });

  describe('the catalogue it builds alongside the drops', () => {
    it('knows what a brand sells from the very first poll, while announcing nothing', async () => {
      // A baseline is silent by design, but silence is not ignorance: a store
      // registered today should have pages immediately.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'aquascaphe', title: 'Aquascaphe', available: true },
        { handle: 'scalegraph', title: 'Scalegraph', available: true },
      ]);

      const result = await service.pollSource(source.id);

      expect(result.baseline).toBe(true);
      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(result.watchesRecorded).toBe(2);
      expect(await watchesFor(brandId)).toHaveLength(2);
    });

    it('treats the references a store lists for one model as one watch', async () => {
      // Three products, one title — the YEMA case that motivated the entity.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'superman-u8', title: 'Superman Bronze CMM.10', available: true },
        { handle: 'superman-u7', title: 'Superman Bronze CMM.10', available: true },
        { handle: 'superman-u4', title: 'Superman Bronze CMM.10', available: true },
      ]);

      await service.pollSource(source.id);

      const watches = await watchesFor(brandId);
      expect(watches).toHaveLength(1);
      expect(watches[0].variants).toHaveLength(3);
    });

    it('does not grow a second copy of the catalogue when nothing changed', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'aquascaphe', title: 'Aquascaphe', available: true }]);

      await service.pollSource(source.id);
      const first = await watchesFor(brandId);
      await service.pollSource(source.id);
      const second = await watchesFor(brandId);

      expect(second).toHaveLength(1);
      // The URL a reader may already hold must survive a re-poll untouched.
      expect(second[0].slug).toBe(first[0].slug);
      expect(second[0].id).toBe(first[0].id);
      expect(second[0].variants).toHaveLength(1);
    });

    it('announces one drop for the several products of one watch', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'first', title: 'First', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'first', title: 'First', available: true },
        { handle: 'superman-a', title: 'Superman Bronze', available: true },
        { handle: 'superman-b', title: 'Superman Bronze', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      const drops = await dropsFor(brandId);
      expect(drops).toHaveLength(1);
      expect(drops[0].title).toBe('Superman Bronze');
      const superman = (await watchesFor(brandId)).find(
        (w) => w.name === 'Superman Bronze',
      );
      expect(superman?.variants).toHaveLength(2);
      expect(drops[0].watchId).toBe(superman?.id);
    });
  });

  describe('one event is one alert', () => {
    // 2026-08-06: three near-identical "New release — YEMA Superman Bronze
    // CMM.10" messages reached both Channels within a second, because YEMA
    // lists one model as three products. ADR-0002 says a Channel that repeats
    // itself gets muted, so this is the blocker on carrying the feed into
    // anybody else's community.

    it('puts one message on each channel for a watch listed as three products', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'superman-u8', title: 'Superman Bronze CMM.10', price: '2190.00', available: true },
        { handle: 'superman-u7', title: 'Superman Bronze CMM.10', price: '2190.00', available: true },
        { handle: 'superman-u4', title: 'Superman Bronze CMM.10', price: '2190.00', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect(result.broadcastsSent).toBe(2); // one per channel, not six
      expect(telegram.sent).toHaveLength(2);
      expect(await dropsFor(brandId)).toHaveLength(1);
      // The report says the one event covered three references.
      expect(result.changes[0].products).toBe(3);
    });

    it('records which watch the drop is about', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'diver-a', title: 'Harbour Diver', available: true },
        { handle: 'diver-b', title: 'Harbour Diver', available: true },
      ]);
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      const watch = (await watchesFor(brandId)).find(
        (w) => w.name === 'Harbour Diver',
      );
      expect(drop.watchId).toBe(watch!.id);
      expect(watch!.variants).toHaveLength(2);
    });

    it('links the reference a reader can actually buy', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'gone', title: 'Meridian GMT', price: '900.00', available: false },
        { handle: 'here', title: 'Meridian GMT', price: '950.00', available: true },
      ]);
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      expect(drop.sourceUrl).toBe('https://brand.example/products/here');
      for (const message of telegram.sent) {
        expect(message.text).toContain('https://brand.example/products/here');
      }
    });

    it('carries the span of prices its references are sold at', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'steel', title: 'Field Watch', price: '650.00', available: true },
        { handle: 'gold', title: 'Field Watch', price: '850.00', available: true },
      ]);
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      expect(Number(drop.priceLow)).toBe(650);
      expect(Number(drop.priceHigh)).toBe(850);
      // The template renders priceLow only, and is deliberately untouched.
      // Unlabelled, because this store's feed does not say which currency it
      // just served — a bare number beats a wrong one (#24).
      for (const message of telegram.sent) {
        expect(message.text).toContain('650');
        expect(message.text).not.toMatch(/650\s*[A-Z]{3}/);
      }
    });

    it('announces a restock once when a sold-out watch returns', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'superman-u8', title: 'Superman Bronze', available: false },
        { handle: 'superman-u7', title: 'Superman Bronze', available: false },
      ]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'superman-u8', title: 'Superman Bronze', available: true },
        { handle: 'superman-u7', title: 'Superman Bronze', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      const drops = await dropsFor(brandId);
      expect(drops).toHaveLength(1);
      expect(drops[0].type).toBe('restock');
      expect(telegram.sent).toHaveLength(2);
    });

    it('says nothing when a watch that never sold out gains a reference back', async () => {
      // This is where #26 departs from ADR-0003's original reading. The watch
      // was buyable throughout, so "back in stock" would be false.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'diver-a', title: 'Harbour Diver', available: true },
        { handle: 'diver-b', title: 'Harbour Diver', available: false },
      ]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'diver-a', title: 'Harbour Diver', available: true },
        { handle: 'diver-b', title: 'Harbour Diver', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('says nothing when a store merely retitles a product', async () => {
      // The grouping key changes; the thing in the world does not.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'diver', title: 'Harbour Diver', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'diver', title: 'Harbour Diver Automatic', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.changed).toBe(true); // the snapshot moved…
      expect(result.dropsCreated).toBe(0); // …and nobody was interrupted
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('honours a grouping correction on the very next poll, with no restart', async () => {
      // ADR-0003's condition, end to end and against the long-lived service
      // this suite shares: an operator writes a row, and the next scheduled
      // poll groups differently. Nothing is deployed and nothing is restarted.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      const brand = await prisma.brand.findUniqueOrThrow({
        where: { id: brandId },
      });
      await prisma.watchGroupingOverride.create({
        data: {
          brandId,
          // The store appends the reference to one bracelet and not the other,
          // so the rule would split one model into two watches — and announce
          // it twice.
          productUrl: 'https://brand.example/products/superman-u7',
          watchKey: `${brand.slug}:superman bronze`,
          note: 'Reference is appended to the U7 bracelet only',
        },
      });

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'superman-u8', title: 'Superman Bronze', available: true },
        { handle: 'superman-u7', title: 'Superman Bronze Ref. CMM.10', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.groupingOverridesApplied).toBe(1);
      expect(result.dropsCreated).toBe(1); // one model, one alert
      expect(result.broadcastsSent).toBe(2);
      const [drop] = await dropsFor(brandId);
      const watch = (await watchesFor(brandId)).find(
        (w) => w.variants.length === 2,
      );
      // The Drop points at the watch the brand page actually shows.
      expect(drop.watchId).toBe(watch!.id);
    });

    it('regroups a store that has not changed at all since the correction', async () => {
      // The case an operator actually hits: they notice a brand page listing
      // one watch twice, write the override, and wait. The store has no reason
      // to change, so a poll that only regroups on a changed catalogue would
      // leave the correction unapplied indefinitely.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'twin-a', title: 'Twin Diver', available: true },
        { handle: 'twin-b', title: 'Twin Diver Ref. 002', available: true },
      ]);
      await service.pollSource(source.id);
      expect(await watchesFor(brandId)).toHaveLength(2);

      const brand = await prisma.brand.findUniqueOrThrow({
        where: { id: brandId },
      });
      await prisma.watchGroupingOverride.create({
        data: {
          brandId,
          productUrl: 'https://brand.example/products/twin-b',
          watchKey: `${brand.slug}:twin diver`,
        },
      });

      // Same catalogue, byte for byte.
      const result = await service.pollSource(source.id);

      expect(result.changed).toBe(false);
      expect(result.groupingOverridesApplied).toBe(1);
      const populated = (await watchesFor(brandId)).filter(
        (w) => w.variants.length > 0,
      );
      expect(populated).toHaveLength(1);
      expect(populated[0].variants).toHaveLength(2);
      // Regrouping the catalogue is not an event; nobody is interrupted.
      expect(result.dropsCreated).toBe(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('reports an override the store has moved out from under', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'diver', title: 'Diver', available: true }]);
      await service.pollSource(source.id);

      await prisma.watchGroupingOverride.create({
        data: {
          brandId,
          productUrl: 'https://brand.example/products/long-gone',
          watchKey: 'whatever:it-was',
        },
      });

      fetcher.serve([
        { handle: 'diver', title: 'Diver', available: true },
        { handle: 'field', title: 'Field Watch', available: true },
      ]);
      const result = await service.pollSource(source.id);

      // Harmless — the poll worked — but not silent.
      expect(result.status).toBe('ok');
      expect(result.groupingOverridesUnmatched).toEqual([
        'https://brand.example/products/long-gone',
      ]);
    });

    it('says nothing when the store adds a strap', async () => {
      // Serica's feed announced "Bracelet Lézard - Marron" as a watch release,
      // and YEMA's announced ten straps and a warranty product. Every one
      // reached both Channels, which cannot unsend.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'diver', title: 'Harbour Diver', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'diver', title: 'Harbour Diver', available: true },
        { handle: 'strap', title: 'Vintage Leather Strap', available: true },
        { handle: 'box', title: 'Collectors Watch Box', available: true },
        { handle: 'warranty', title: 'Warranty Product', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('keeps the accessory data in full, and says what it is', async () => {
      // Classification, not exclusion — the sibling ticket needs this data.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'diver', title: 'Harbour Diver', price: '650.00', available: true },
        { handle: 'strap', title: 'Rallye Leather Strap', price: '90.00', available: true },
      ]);

      const result = await service.pollSource(source.id);

      // Counted apart, not lumped together: one of each.
      expect(result.watchesRecorded).toBe(1);
      expect(result.accessoriesRecorded).toBe(1);
      expect(result.newAccessories).toEqual(['Rallye Leather Strap']);
      const watches = await watchesFor(brandId);
      const strap = watches.find((w) => w.name === 'Rallye Leather Strap');
      expect(strap?.kind).toBe('accessory');
      expect(strap?.variants).toHaveLength(1);
      expect(Number(strap?.variants[0].price)).toBe(90);
      expect(watches.find((w) => w.name === 'Harbour Diver')?.kind).toBe('watch');
    });

    it('still announces a watch alongside the accessories', async () => {
      // The failure that would matter most: a rule that silenced everything.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'strap', title: 'Leather Strap', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'strap', title: 'Leather Strap', available: true },
        { handle: 'gmt', title: 'Meridian GMT', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect((await dropsFor(brandId))[0].title).toBe('Meridian GMT');
      expect(telegram.sent).toHaveLength(2);
    });

    it('lets an operator silence a watch the rule could not name', async () => {
      // Serica's "'Black Tie'" is a set of spring bars and no rule reads that
      // off the title. Marking the row is the fix, and it needs no deploy.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'bonk', title: 'Mystery Fitting', available: true },
      ]);
      await service.pollSource(source.id);
      expect(await dropsFor(brandId)).toHaveLength(1); // announced, wrongly

      await prisma.watch.updateMany({
        where: { brandId, name: 'Mystery Fitting' },
        data: { kindOverride: 'accessory' },
      });

      // It comes back in stock later; that must not be announced either.
      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'bonk', title: 'Mystery Fitting', available: false },
      ]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'bonk', title: 'Mystery Fitting', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(1); // still just the first
      const marked = (await watchesFor(brandId)).find(
        (w) => w.name === 'Mystery Fitting',
      );
      expect(marked?.kind).toBe('accessory');
    });

    it('lets an operator rescue a watch the rule wrongly silenced', async () => {
      // The other direction, and the one that matters more. `bracelet` earns
      // its place in the rule — it is how both Serica and YEMA title the strap
      // itself — but it also appears in a watch listed on a given bracelet.
      // Silence is the expensive mistake, so it has to be recoverable.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'band', title: 'Skin Diver CMM.20 Steel Bracelet', available: true },
      ]);
      await service.pollSource(source.id);
      expect(await dropsFor(brandId)).toHaveLength(0); // silenced, wrongly

      await prisma.watch.updateMany({
        where: { brandId, name: 'Skin Diver CMM.20 Steel Bracelet' },
        data: { kindOverride: 'watch' },
      });

      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'band', title: 'Skin Diver CMM.20 Steel Bracelet', available: false },
      ]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        { handle: 'band', title: 'Skin Diver CMM.20 Steel Bracelet', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(1);
      expect((await dropsFor(brandId))[0].title).toBe('Skin Diver CMM.20 Steel Bracelet');
    });

    it('applies a correction to a store that has not changed', async () => {
      // Same trap as the grouping override: a correction is written about a
      // catalogue with no reason to move.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([
        { handle: 'fitting', title: 'Odd Fitting', available: true },
      ]);
      await service.pollSource(source.id);

      await prisma.watch.updateMany({
        where: { brandId, name: 'Odd Fitting' },
        data: { kindOverride: 'accessory' },
      });

      const result = await service.pollSource(source.id); // identical catalogue

      expect(result.changed).toBe(false);
      const marked = (await watchesFor(brandId)).find(
        (w) => w.name === 'Odd Fitting',
      );
      expect(marked?.kind).toBe('accessory');
    });

    it('does not re-announce a watch when the store adds a buying option', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'diver-a', title: 'Harbour Diver', available: true }]);
      await service.pollSource(source.id);

      fetcher.serve([
        { handle: 'diver-a', title: 'Harbour Diver', available: true },
        { handle: 'diver-b', title: 'Harbour Diver', available: true },
      ]);
      const result = await service.pollSource(source.id);

      expect(result.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
    });
  });

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
    // No currency: this store's feed serves a bare number and does not say
    // which market price list it came from (#24).
    expect(drops[0].currency).toBeNull();
    expect(drops[0].sourceUrl).toBe('https://brand.example/products/field');
    expect(drops[0].imageUrl).toBe('https://cdn.example/field.jpg');
  });

  describe('a store that serves more than one market price list', () => {
    // The 2026-08-06 failure. YEMA serves at least two price lists — observed
    // pairs 349/390, 39/47, 49/59, whose ratios differ, so these are separate
    // lists rather than one converted — and `watch_config.currency` was a
    // label typed once at registration. Both Channels were told
    // "Price: 2190 USD" for a figure nobody can now place, and a Channel
    // cannot unsend (ADR-0002).

    /** Two market price lists for one catalogue, as a store would serve them. */
    const priceLists = {
      home: [{ handle: 'diver', title: 'Harbour Diver', price: '349.00', available: true }],
      export: [{ handle: 'diver', title: 'Harbour Diver', price: '390.00', available: true }],
    };

    it('never labels a figure from a feed that does not say', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'other', title: 'Other', available: true }]);
      await service.pollSource(source.id);

      // First poll of the watch lands on one list…
      fetcher.serve([
        { handle: 'other', title: 'Other', available: true },
        ...priceLists.home,
      ]);
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      expect(Number(drop.priceLow)).toBe(349);
      expect(drop.currency).toBeNull();
      for (const message of telegram.sent) {
        expect(message.text).toContain('349');
        expect(message.text).not.toMatch(/[A-Z]{3}\s*$/m);
      }
    });

    it('labels nothing as the store switches lists under it, poll after poll', async () => {
      // The criterion, driven properly: one source, one product, and the store
      // answering from a different price list each time — which is exactly
      // what YEMA did. The old bug was that the *number* moved between polls
      // while the *label* never did.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(priceLists.home);
      await service.pollSource(source.id); // silent baseline, list A

      // It sells out on list B, comes back on list A, sells out on list B
      // again — a restock each time it returns, at whichever price is served.
      const polls = [
        [{ ...priceLists.export[0], available: false }],
        priceLists.home,
        [{ ...priceLists.export[0], available: false }],
        priceLists.export,
      ];
      for (const catalogue of polls) {
        fetcher.serve(catalogue);
        await service.pollSource(source.id);
      }

      const drops = await dropsFor(brandId);
      expect(drops.length).toBeGreaterThanOrEqual(2); // it did announce
      // Both lists appear across the run, and not one figure is labelled.
      expect(drops.map((d) => Number(d.priceLow))).toEqual(
        expect.arrayContaining([349, 390]),
      );
      expect(drops.every((d) => d.currency === null)).toBe(true);
      for (const message of telegram.sent) {
        expect(message.text).not.toMatch(/\d\s*[A-Z]{3}\b/);
      }
    });

    it('reads the currency per fetch when the store does print it', async () => {
      // The other half. A store whose page carries the symbol gets a label,
      // and it comes from the same bytes as the number — so a switch to a
      // different market moves both together.
      const HTML = {
        adapter: 'html_selectors',
        selectors: { item: '.product-card', link: 'a', title: 'h3', price: '.price' },
      };
      const page = (price: string) => `<!doctype html><html><body>
        <ul><li class="product-card">
          <a href="/products/diver"><h3>Harbour Diver</h3></a>
          <span class="price">${price}</span>
        </li></ul></body></html>`;

      const { source, brandId } = await arrangeSource({ watchConfig: HTML });
      fetcher.next = { status: 200, body: page('€ 349.00') };
      await service.pollSource(source.id);

      // The store switches list between polls; a new watch appears priced in
      // the other currency, and is labelled with *that* one.
      fetcher.next = {
        status: 200,
        body: `<!doctype html><html><body><ul>
          <li class="product-card"><a href="/products/diver"><h3>Harbour Diver</h3></a><span class="price">£ 299.00</span></li>
          <li class="product-card"><a href="/products/gmt"><h3>Meridian GMT</h3></a><span class="price">£ 459.00</span></li>
        </ul></body></html>`,
      };
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      expect(drop.title).toBe('Meridian GMT');
      expect(Number(drop.priceLow)).toBe(459);
      expect(drop.currency).toBe('GBP');
    });

    it('omits the label when a store prints an ambiguous symbol', async () => {
      const HTML = {
        adapter: 'html_selectors',
        selectors: { item: '.product-card', link: 'a', title: 'h3', price: '.price' },
      };
      const page = (products: Array<[string, string, string]>) =>
        `<!doctype html><html><body><ul>${products
          .map(
            ([handle, title, price]) =>
              `<li class="product-card"><a href="/products/${handle}"><h3>${title}</h3></a><span class="price">${price}</span></li>`,
          )
          .join('')}</ul></body></html>`;

      const { source, brandId } = await arrangeSource({ watchConfig: HTML });
      fetcher.next = { status: 200, body: page([['diver', 'Harbour Diver', '$349']]) };
      await service.pollSource(source.id);

      fetcher.next = {
        status: 200,
        body: page([
          ['diver', 'Harbour Diver', '$349'],
          ['gmt', 'Meridian GMT', '$459'],
        ]),
      };
      await service.pollSource(source.id);

      const [drop] = await dropsFor(brandId);
      // `$` is six currencies. CronusArt and YEMA both print it.
      expect(Number(drop.priceLow)).toBe(459);
      expect(drop.currency).toBeNull();
    });
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

  it('reports which watches changed, not just how many', async () => {
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
          kind: 'new_watch',
          type: 'pre_order',
          title: 'Field Watch',
          url: 'https://brand.example/products/field',
          products: 1,
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
      // The number, with no currency after it. On 2026-08-06 a message like
      // this carried "2190 USD" for a figure nobody can now place (#24).
      expect(message.text).toContain('650');
      expect(message.text).not.toMatch(/650\s*[A-Z]{3}/);
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
      new WatchWriterService(prisma),
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
      new LinkProbe(fetcher, robots),
      new ConfigService({ siteWatch: { pollDelayMs: 0 } }),
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
      new WatchWriterService(prisma),
      new AlertDispatchService(
        prisma,
        new ConfigService({
          digest: { publicWebUrl: 'https://crownswatch.org' },
          telegram: { botToken: undefined, channels: {} },
        }),
        telegram,
      ),
      robots,
      new LinkProbe(fetcher, robots),
      new ConfigService({ siteWatch: { pollDelayMs: 0 } }),
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

  describe('refusing to announce an implausible number of drops', () => {
    // 2026-08-07: a lost snapshot made one poll read 182 real products as new
    // releases, and both Channels were told about every one of them. A Channel
    // cannot unsend (ADR-0002), so the wall has to stand in front of publishing
    // rather than behind it — whatever caused the flood.

    it('publishes nothing and sends nothing when one poll finds too many changes', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      const result = await service.pollSource(source.id);

      expect(result.status).toBe('refused');
      expect(result.dropsCreated).toBe(0);
      expect(result.broadcastsSent).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('says on the source row that it was held, and why', async () => {
      const { source } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      const result = await service.pollSource(source.id);

      expect(result.health).toBe(SourceHealth.held);
      expect(result.refusedReason).toMatch(/12 change/); // twelve new products
      const reloaded = await prisma.source.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(reloaded.healthStatus).toBe(SourceHealth.held);
      expect(reloaded.lastError).toMatch(/refus/i);
      expect(reloaded.lastPolledAt).not.toBeNull();
      // Held, not broken: the store answered, so nothing is backing off and no
      // failure streak is running. Only a human clears this.
      expect(reloaded.consecutiveFailures).toBe(0);
      expect(reloaded.nextAttemptAt).toBeNull();
    });

    it('shows what it would have published without publishing any of it', async () => {
      const { source } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      const result = await service.pollSource(source.id);

      expect(result.changes).toHaveLength(12);
      expect(result.changes.map((c) => c.title)).toContain('Watch ref 12');
      expect(result.changes[0].url).toMatch(/^https:\/\/brand\.example\/products\//);
      // Reported, not sent. The listing is what an operator rules on, so it
      // must not be able to drift from what actually reached the Channels.
      expect(result.changes.every((c) => c.broadcasts === 0)).toBe(true);
      expect(telegram.sent).toHaveLength(0);
    });

    it('holds the flood rather than swallowing it, so the next poll refuses too', async () => {
      // The snapshot decision that makes the guard honest. Storing the refused
      // catalogue would silence the next poll — the flood would vanish, and with
      // it any genuine release hiding inside it.
      const { source } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      await service.pollSource(source.id);
      // Still only the baseline: nothing a refused poll saw was written down.
      expect(
        await prisma.rawIngestionEvent.count({ where: { sourceId: source.id } }),
      ).toBe(1);

      const again = await service.pollSource(source.id);

      expect(again.status).toBe('refused');
      expect(again.changes).toHaveLength(12);
    });

    it('keeps refusing once held, even after the flood shrinks below the wall', async () => {
      // The flood must not be able to walk through in instalments. A held
      // source that loses a few products between polls would otherwise present
      // a diff under the threshold and announce the rest of the same flood.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      expect((await service.pollSource(source.id)).status).toBe('refused');

      // Four of the twelve are still there — well under the limit of ten.
      fetcher.serve(catalogueOf(5));
      const shrunk = await service.pollSource(source.id);

      expect(shrunk.status).toBe('refused');
      expect(shrunk.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('lets go of a source whose store returns to the catalogue we hold', async () => {
      // The one automatic exit, and it is safe because it announces nothing by
      // definition: the store matches the snapshot exactly, so there is no diff
      // left to publish and nothing for a human to rule on.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);
      fetcher.serve(catalogueOf(13));
      await service.pollSource(source.id);

      fetcher.serve(catalogueOf(1));
      const recovered = await service.pollSource(source.id);

      expect(recovered.status).toBe('ok');
      expect(recovered.changed).toBe(false);
      expect(recovered.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      const reloaded = await prisma.source.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(reloaded.healthStatus).toBe(SourceHealth.healthy);
      expect(reloaded.lastError).toBeNull();
    });

    it('lets a held source be re-baselined, which is the other way out', async () => {
      // When the flood turns out to be an artefact, the runbook has the
      // operator delete the stale snapshot so the next poll starts clean. A
      // hold that survived that would leave the source stuck for good.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);
      fetcher.serve(catalogueOf(13));
      await service.pollSource(source.id);

      await prisma.rawIngestionEvent.deleteMany({
        where: { sourceId: source.id },
      });
      const rebaselined = await service.pollSource(source.id);

      expect(rebaselined.status).toBe('ok');
      expect(rebaselined.baseline).toBe(true);
      expect(rebaselined.dropsCreated).toBe(0);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
      const reloaded = await prisma.source.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(reloaded.healthStatus).toBe(SourceHealth.healthy);
    });

    it('does not record a refused catalogue as the brand it sells', async () => {
      // The pages are built from the same payload the poll just refused to
      // believe. Recording them would put 12 invented Watches on the Brand page.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);
      expect(await watchesFor(brandId)).toHaveLength(1);

      fetcher.serve(catalogueOf(13));
      const result = await service.pollSource(source.id);

      expect(result.watchesRecorded).toBe(0);
      expect(await watchesFor(brandId)).toHaveLength(1);
    });

    it('publishes the whole flood once an operator releases it', async () => {
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(source.id);
      fetcher.serve(catalogueOf(13));
      await service.pollSource(source.id);

      // The operator read the report, agrees the store really did release
      // twelve watches, and lets this one poll through.
      const released = await service.pollSource(source.id, { release: true });

      expect(released.status).toBe('ok');
      expect(released.dropsCreated).toBe(12);
      expect(released.broadcastsSent).toBe(24); // two channels apiece
      expect(await dropsFor(brandId)).toHaveLength(12);
      const reloaded = await prisma.source.findUniqueOrThrow({
        where: { id: source.id },
      });
      expect(reloaded.healthStatus).toBe(SourceHealth.healthy);
      expect(reloaded.lastError).toBeNull();
    });

    it('reads its threshold from configuration rather than a constant', async () => {
      const strict = serviceWithLimit(2);
      const { source } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await strict.pollSource(source.id);

      fetcher.serve(catalogueOf(4)); // three new products, limit is two
      const result = await strict.pollSource(source.id);

      expect(result.status).toBe('refused');
      expect(result.refusedReason).toMatch(/limit 2/);
    });

    it('cannot be switched off by a nonsensical threshold', async () => {
      // A mistyped environment variable must not be the thing that lets a
      // flood through, so an unusable value falls back to the default rather
      // than opening the gate.
      const misconfigured = serviceWithLimit(0);
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await misconfigured.pollSource(source.id);

      fetcher.serve(catalogueOf(13));
      const result = await misconfigured.pollSource(source.id);

      expect(result.status).toBe('refused');
      expect(await dropsFor(brandId)).toHaveLength(0);
    });

    it('lets a poll sitting exactly on the threshold through', async () => {
      // "Implausible" has to start somewhere, and the boundary is where a wall
      // is most likely to block the ordinary case it was never meant to catch.
      const strict = serviceWithLimit(2);
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await strict.pollSource(source.id);

      fetcher.serve(catalogueOf(3)); // two new products
      const result = await strict.pollSource(source.id);

      expect(result.status).toBe('ok');
      expect(result.dropsCreated).toBe(2);
      expect(await dropsFor(brandId)).toHaveLength(2);
    });

    it('still takes a silent baseline of a brand-new store, however large', async () => {
      // A first poll announces nothing at all, so a big catalogue is no risk —
      // and onboarding a hundred-product brand must not need the wall moved.
      const { source, brandId } = await arrangeSource();
      fetcher.serve(catalogueOf(40));

      const result = await service.pollSource(source.id);

      expect(result.status).toBe('ok');
      expect(result.baseline).toBe(true);
      expect(result.dropsCreated).toBe(0);
      expect(result.watchesRecorded).toBe(40);
      expect(await dropsFor(brandId)).toHaveLength(0);
      expect(telegram.sent).toHaveLength(0);
    });

    it('counts a refusal apart from a failure in the run report', async () => {
      // A held source is not a broken one, and an operator reading the run
      // needs to be able to tell them apart at a glance.
      const held = await arrangeSource();
      fetcher.serve(catalogueOf(1));
      await service.pollSource(held.source.id);
      fetcher.serve(catalogueOf(13));

      const run = await service.pollAll();

      const ours = run.sources.find((s) => s.sourceId === held.source.id);
      expect(ours?.status).toBe('refused');
      expect(ours?.health).toBe(SourceHealth.held);
      expect(run.refusedCount).toBeGreaterThanOrEqual(1);
      // A refusal is not a failure — conflating them would page someone about a
      // store that answered perfectly well.
      expect(
        run.sources.filter((s) => s.status === 'error').map((s) => s.sourceId),
      ).not.toContain(held.source.id);
      expect(await dropsFor(held.brandId)).toHaveLength(0);
    });
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

  it('pauses between stores so one run does not hammer several at once', async () => {
    // Four freshly registered stores answered 429 together on the first real
    // run, because the loop walked them back to back. Different brands, one
    // shared platform edge — being polite has to mean the whole run, not each
    // request in isolation.
    await arrangeSource();
    await arrangeSource();
    fetcher.serve([{ handle: 'diver', available: true }]);

    const startedAt = Date.now();
    await service.pollAll({ delayMs: 80 });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(80);
  });

  it('does not pause for a source it never contacted', async () => {
    // A source in backoff costs the store no request, so it should cost the
    // run no time either — otherwise a long list of resting sources would
    // stretch every poll for no reason.
    const { source } = await arrangeSource();
    fetcher.next = { status: 500, body: 'boom' };
    await service.pollSource(source.id); // puts it into backoff

    const startedAt = Date.now();
    const run = await service.pollAll({ delayMs: 0 });
    const elapsed = Date.now() - startedAt;

    expect(run.sources.find((s) => s.sourceId === source.id)?.status).toBe(
      'skipped',
    );
    expect(elapsed).toBeLessThan(5000);
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
