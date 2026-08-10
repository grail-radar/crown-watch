/**
 * A Drop that points at nothing never publishes, and never reaches a Channel.
 *
 * ADR-0001 lets a Tier 4 Drop skip moderation because the signal is a
 * structural diff of the store's own data, with nothing inferred. A product URL
 * the store will not serve falsifies that for one candidate — so this is where
 * the Drop falls back to the lane everything else already uses, rather than
 * being thrown away.
 *
 * Driven end to end through the real service and a real database, with only the
 * two network seams replaced. What is asserted is what a reader would see: does
 * the Drop exist, is it public, and did anything reach a Channel.
 */
import { ConfigService } from '@nestjs/config';
import { ModerationStatus, SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { LinkProbe } from './link-probe';
import { RobotsService } from './robots.service';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { SiteWatchService } from './site-watch.service';
import { WatchWriterService } from './watch-writer.service';

const ENDPOINT = 'https://brand.example/products.json';
const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';

/**
 * A store that answers differently per URL — the catalogue on one path, and
 * whatever the test says about each product page.
 */
class PerUrlFetcher extends SiteFetcher {
  catalogue: FetchResult = { status: 200, body: '{"products":[]}' };
  /** Status to serve for a product page, by handle. Absent means 200. */
  productStatus = new Map<string, number>();
  /** Handles whose request should fail outright, as a timeout would. */
  unreachable = new Set<string>();
  calls: string[] = [];
  robotsTxt = '';

  async fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    if (url.endsWith('/robots.txt')) {
      return { status: this.robotsTxt ? 200 : 404, body: this.robotsTxt };
    }
    const product = url.match(/\/products\/([^/?#]+)$/);
    if (product) {
      const handle = product[1];
      if (this.unreachable.has(handle)) {
        throw new Error('connect ETIMEDOUT');
      }
      return { status: this.productStatus.get(handle) ?? 200, body: '<html></html>' };
    }
    return this.catalogue;
  }

  /** Every product page this run asked for, by handle. */
  get checkedHandles(): string[] {
    return this.calls
      .map((u) => u.match(/\/products\/([^/?#]+)$/)?.[1])
      .filter((h): h is string => h !== undefined);
  }

  serve(products: Array<{ handle: string; title?: string; available: boolean; image?: string }>) {
    this.catalogue = {
      status: 200,
      body: JSON.stringify({
        products: products.map((p) => ({
          handle: p.handle,
          title: p.title ?? p.handle,
          variants: [{ available: p.available, price: '500.00' }],
          images: p.image ? [{ src: p.image }] : [],
        })),
      }),
    };
  }
}

describe('SiteWatchService — a candidate Drop with a dead link', () => {
  let prisma: PrismaService;
  let fetcher: PerUrlFetcher;
  let telegram: CapturingTelegram;
  let robots: RobotsService;
  let service: SiteWatchService;
  const brandIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    fetcher = new PerUrlFetcher();
    telegram = new CapturingTelegram();
    const config = new ConfigService({
      digest: { publicWebUrl: 'https://crownswatch.org' },
      siteWatch: {
        userAgent: 'CrownWatchBot/0.1 (+https://crownswatch.org)',
        pollDelayMs: 0,
      },
      telegram: {
        botToken: 'test-token',
        channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
      },
    });
    robots = new RobotsService(fetcher, config);
    service = new SiteWatchService(
      prisma,
      fetcher,
      new DropWriterService(prisma),
      new WatchWriterService(prisma),
      new AlertDispatchService(prisma, config, telegram),
      robots,
      new LinkProbe(fetcher, robots),
      config,
    );
  });

  beforeEach(() => {
    telegram.sent = [];
    fetcher.calls = [];
    fetcher.productStatus = new Map();
    fetcher.unreachable = new Set();
    fetcher.robotsTxt = '';
    robots.clearCache();
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.rawIngestionEvent.deleteMany({ where: { sourceId: { in: sourceIds } } });
    await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeSource() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Watch Co ${tag}`, slug: `watch-co-${tag}` },
    });
    brandIds.push(brand.id);
    const source = await prisma.source.create({
      data: {
        type: SourceType.site_watch,
        name: 'Store',
        endpoint: `${ENDPOINT}?s=${randomUUID()}`,
        brandId: brand.id,
        watchConfig: { adapter: 'shopify_products_json', currency: 'EUR' },
      },
    });
    sourceIds.push(source.id);
    return { source, brandId: brand.id };
  }

  const dropsFor = (brandId: string) =>
    prisma.drop.findMany({ where: { brandId }, orderBy: { title: 'asc' } });

  /**
   * Baseline first, then the store gains a product. A release is only ever a
   * second poll — the first is silent by definition.
   */
  async function arrangeRelease(handles: string[], newHandle: string) {
    const { source, brandId } = await arrangeSource();
    fetcher.serve(handles.map((h) => ({ handle: h, available: true })));
    await service.pollSource(source.id);
    fetcher.serve(
      [...handles, newHandle].map((h) => ({ handle: h, available: true })),
    );
    return { source, brandId };
  }

  describe('the store says there is no such product', () => {
    it('does not publish it and does not broadcast it', async () => {
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'ghost');
      fetcher.productStatus.set('ghost', 404);

      const result = await service.pollSource(source.id);

      const ghost = (await dropsFor(brandId)).find((d) => d.title === 'ghost');
      expect(ghost).toBeDefined();
      expect(ghost?.publishedAt).toBeNull();
      expect(ghost?.moderationStatus).toBe(ModerationStatus.pending);
      expect(telegram.sent).toHaveLength(0);
      expect(result.broadcastsSent).toBe(0);
    });

    it('keeps the Drop for a human rather than throwing the release away', async () => {
      // Discarding it would be permanent: the product is in the stored
      // snapshot from this poll on, so it can never raise an event again. A
      // store that publishes the page an hour later would go unannounced
      // forever.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'ghost');
      fetcher.productStatus.set('ghost', 404);

      await service.pollSource(source.id);

      const ghost = (await dropsFor(brandId)).find((d) => d.title === 'ghost');
      expect(ghost).toBeDefined();
      expect(ghost?.moderationStatus).toBe(ModerationStatus.pending);
    });

    it('leaves the Watch and its Variant in the catalogue', async () => {
      // This refuses an announcement. It does not prune the catalogue — the
      // product is one the store's own feed listed.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'ghost');
      fetcher.productStatus.set('ghost', 404);

      await service.pollSource(source.id);

      const watches = await prisma.watch.findMany({
        where: { brandId },
        include: { variants: true },
      });
      const ghost = watches.find((w) => w.name === 'ghost');
      expect(ghost).toBeDefined();
      expect(ghost?.variants).toHaveLength(1);
    });

    it('tells the operator which URL was refused, and why', async () => {
      const { source } = await arrangeRelease(['aquascaphe'], 'ghost');
      fetcher.productStatus.set('ghost', 404);

      const result = await service.pollSource(source.id);

      const change = result.changes.find((c) => c.title === 'ghost');
      expect(change?.link).toBe('gone');
      expect(change?.url).toContain('/products/ghost');
      expect(change?.broadcasts).toBe(0);
      expect(result.deadLinkCount).toBe(1);
    });

    it('records the reason on the Drop, where it outlives the poll', async () => {
      // The poll response and the log line are both gone by the time anyone
      // looks. Unlike a held Source, this refusal cannot re-derive itself —
      // the snapshot has moved on, so no later poll raises it again.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'ghost');
      fetcher.productStatus.set('ghost', 404);

      await service.pollSource(source.id);

      const ghost = (await dropsFor(brandId)).find((d) => d.title === 'ghost');
      expect(ghost?.heldReason).toContain('/products/ghost');
      expect(ghost?.heldReason).toMatch(/does not serve/i);
    });

    it('leaves the reason off a Drop that published normally', async () => {
      // "Why is this waiting" has no answer for something that is not waiting.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'fine');

      await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'fine');
      expect(drop?.publishedAt).not.toBeNull();
      expect(drop?.heldReason).toBeNull();
    });

    it('lets its healthy siblings publish normally', async () => {
      // A veto on one candidate, not a hold on the whole Source — that is what
      // makes this different from the flood guard (ADR-0005).
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'aquascaphe', available: true }]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'aquascaphe', available: true },
        { handle: 'ghost', available: true },
        { handle: 'scalegraph', available: true },
      ]);
      fetcher.productStatus.set('ghost', 404);

      const result = await service.pollSource(source.id);

      const drops = await dropsFor(brandId);
      const scalegraph = drops.find((d) => d.title === 'scalegraph');
      const ghost = drops.find((d) => d.title === 'ghost');
      expect(scalegraph?.publishedAt).not.toBeNull();
      expect(ghost?.publishedAt).toBeNull();
      expect(result.status).toBe('ok');
      // Both channels, for the one healthy release.
      expect(telegram.sent).toHaveLength(2);
    });

    it('treats a 410 the same way', async () => {
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'retired');
      fetcher.productStatus.set('retired', 410);

      await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'retired');
      expect(drop?.publishedAt).toBeNull();
    });
  });

  describe('the store did not answer the question', () => {
    it('publishes when the check times out', async () => {
      // A briefly unreachable store must not silently cost a brand a release.
      // Same call the robots cache makes when it cannot read a robots.txt.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'nautilus');
      fetcher.unreachable.add('nautilus');

      const result = await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'nautilus');
      expect(drop?.publishedAt).not.toBeNull();
      expect(telegram.sent).toHaveLength(2);
      expect(result.changes.find((c) => c.title === 'nautilus')?.link).toBe(
        'unverified',
      );
      expect(result.deadLinkCount).toBe(0);
    });

    it('publishes when the store answers 403 at a bot wall', async () => {
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'walled');
      fetcher.productStatus.set('walled', 403);

      await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'walled');
      expect(drop?.publishedAt).not.toBeNull();
    });

    it('publishes when the store is having a bad day', async () => {
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'brokenshop');
      fetcher.productStatus.set('brokenshop', 500);

      await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'brokenshop');
      expect(drop?.publishedAt).not.toBeNull();
    });

    it('does not check, and still publishes, when robots.txt forbids the path', async () => {
      // A disallowed path must not be requested at all — the whole point of
      // the directive. Not knowing is not evidence of a dead product.
      const { source, brandId } = await arrangeRelease(['aquascaphe'], 'private');
      fetcher.robotsTxt = 'User-agent: *\nDisallow: /products/';
      robots.clearCache();
      fetcher.calls = [];

      const result = await service.pollSource(source.id);

      expect(fetcher.checkedHandles).not.toContain('private');
      const drop = (await dropsFor(brandId)).find((d) => d.title === 'private');
      expect(drop?.publishedAt).not.toBeNull();
      expect(result.changes.find((c) => c.title === 'private')?.link).toBe(
        'unverified',
      );
    });
  });

  describe('the check is a request to somebody else’s shop', () => {
    it('asks about a release once, and about nothing else', async () => {
      // One request per candidate. A baseline poll records a whole catalogue
      // and announces none of it, so it must ask about none of it either.
      const { source } = await arrangeSource();
      fetcher.serve([
        { handle: 'aquascaphe', available: true },
        { handle: 'scalegraph', available: true },
      ]);
      fetcher.calls = [];

      await service.pollSource(source.id);
      expect(fetcher.checkedHandles).toEqual([]);

      fetcher.serve([
        { handle: 'aquascaphe', available: true },
        { handle: 'scalegraph', available: true },
        { handle: 'nautilus', available: true },
      ]);
      fetcher.calls = [];

      await service.pollSource(source.id);
      expect(fetcher.checkedHandles).toEqual(['nautilus']);
    });

    it('asks nothing at all of a store whose poll was refused', async () => {
      // The flood guard announces nothing, so there is nothing to vet — and
      // vetting first would turn a refusal into a burst of requests.
      const { source } = await arrangeSource();
      fetcher.serve([{ handle: 'aquascaphe', available: true }]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'aquascaphe', available: true },
        ...Array.from({ length: 12 }, (_, i) => ({
          handle: `flood-${i}`,
          available: true,
        })),
      ]);
      fetcher.calls = [];

      const result = await service.pollSource(source.id);

      expect(result.status).toBe('refused');
      expect(fetcher.checkedHandles).toEqual([]);
    });
  });

  describe('a candidate with no image', () => {
    it('publishes without one', async () => {
      // The explicit decision (ADR-0007): an image is presentation, not a
      // promise. The Channel path already falls back to a text message and the
      // site card to a monogram, so refusing would silence a real release over
      // a missing thumbnail.
      const { source, brandId } = await arrangeSource();
      fetcher.serve([{ handle: 'aquascaphe', available: true, image: 'https://cdn.example/a.jpg' }]);
      await service.pollSource(source.id);
      fetcher.serve([
        { handle: 'aquascaphe', available: true, image: 'https://cdn.example/a.jpg' },
        { handle: 'nophoto', available: true },
      ]);

      await service.pollSource(source.id);

      const drop = (await dropsFor(brandId)).find((d) => d.title === 'nophoto');
      expect(drop?.imageUrl).toBeNull();
      expect(drop?.publishedAt).not.toBeNull();
      expect(telegram.sent).toHaveLength(2);
    });
  });
});
