/**
 * End-to-end tests for the Tier 4 pipeline.
 *
 * Everything runs through the real service and a real database; only the
 * network is replaced, via the SiteFetcher seam. Each test states what the
 * store returned and asserts on what a user would see: which drops exist, and
 * whether they are public.
 */
import { SourceHealth, SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { SiteWatchService } from './site-watch.service';

/** Serves whatever the test says the store is showing right now. */
class StubFetcher extends SiteFetcher {
  next: FetchResult = { status: 200, body: '{"products":[]}' };
  calls: string[] = [];

  async fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    return this.next;
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

describe('SiteWatchService', () => {
  let prisma: PrismaService;
  let fetcher: StubFetcher;
  let service: SiteWatchService;
  const brandIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    fetcher = new StubFetcher();
    service = new SiteWatchService(prisma, fetcher, new DropWriterService(prisma));
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

  it('marks the source unhealthy when the store errors, and creates nothing', async () => {
    const { source, brandId } = await arrangeSource();
    fetcher.next = { status: 429, body: 'slow down' };

    const result = await service.pollSource(source.id);

    expect(result.status).toBe('error');
    expect(result.error).toContain('429');
    expect(await dropsFor(brandId)).toHaveLength(0);
    const reloaded = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(reloaded.healthStatus).toBe(SourceHealth.error);
    expect(reloaded.lastPolledAt).not.toBeNull();
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
});
