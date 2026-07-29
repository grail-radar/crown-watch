/**
 * What the website is served for each drop.
 *
 * The real service against a real database, because asserting on database
 * columns is not the same as proving the API returns them — and the website
 * renders exactly what it is given, so this is where the honesty of a purchase
 * link is actually decided.
 */
import { DropType, SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const STORE_PAGE = 'https://lorier.com/products/neptune-iv';
const ARTICLE = 'https://wornandwound.com/hands-on-the-lorier-neptune-iv/';
const BRAND_SITE = 'https://lorier.com';

describe('CatalogService — purchase links', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brandIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
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

  /** A published drop, with the provenance and brand details a test needs. */
  async function arrangeDrop(
    over: {
      fromStore?: boolean;
      sourceUrl?: string | null;
      brandWebsite?: string | null;
      published?: boolean;
    } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Lorier ${tag}`,
        slug: `lorier-${tag}`,
        website: over.brandWebsite === undefined ? BRAND_SITE : over.brandWebsite,
      },
    });
    brandIds.push(brand.id);

    let sourceEventId: string | undefined;
    if (over.fromStore) {
      const source = await prisma.source.create({
        data: {
          type: SourceType.site_watch,
          name: 'Store',
          endpoint: `https://lorier.com/products.json?s=${tag}`,
          brandId: brand.id,
          watchConfig: { adapter: 'shopify_products_json' },
        },
      });
      sourceIds.push(source.id);
      const event = await prisma.rawIngestionEvent.create({
        data: { sourceId: source.id, rawPayload: [], contentHash: tag, processed: true },
      });
      sourceEventId = event.id;
    }

    const published = over.published !== false;
    const drop = await prisma.drop.create({
      data: {
        brandId: brand.id,
        title: `Neptune ${tag}`,
        type: DropType.pre_order,
        sourceUrl: over.sourceUrl === undefined ? ARTICLE : over.sourceUrl,
        sourceEventId,
        moderationStatus: published ? 'approved' : 'pending',
        publishedAt: published ? new Date() : null,
      },
    });
    return { drop, brand };
  }

  it('offers the product page as a store link for a site-watch drop', async () => {
    const { drop } = await arrangeDrop({ fromStore: true, sourceUrl: STORE_PAGE });

    const served = await catalog.getPublishedDrop(drop.id);

    expect(served.purchase).toEqual({ url: STORE_PAGE, kind: 'store' });
  });

  it('offers the brand’s own site when there is no product page', async () => {
    const { drop } = await arrangeDrop();

    const served = await catalog.getPublishedDrop(drop.id);

    expect(served.purchase).toEqual({ url: BRAND_SITE, kind: 'brand_site' });
  });

  it('never presents a publication’s article as somewhere to buy', async () => {
    const { drop } = await arrangeDrop({ brandWebsite: null });

    const served = await catalog.getPublishedDrop(drop.id);

    expect(served.purchase).toBeNull();
    // The article is still reachable — it is just not a purchase link.
    expect(served.sourceUrl).toBe(ARTICLE);
  });

  it('offers nothing when there is neither a product page nor a brand site', async () => {
    const { drop } = await arrangeDrop({ sourceUrl: null, brandWebsite: null });

    const served = await catalog.getPublishedDrop(drop.id);

    expect(served.purchase).toBeNull();
  });

  it('serves the purchase link in the feed as well as on a drop', async () => {
    const { drop } = await arrangeDrop({ fromStore: true, sourceUrl: STORE_PAGE });

    const feed = await catalog.listPublishedDrops(200);

    const mine = feed.drops.find((d) => d.id === drop.id);
    expect(mine?.purchase).toEqual({ url: STORE_PAGE, kind: 'store' });
  });

  it('serves the purchase link on the brand’s own page', async () => {
    const { drop, brand } = await arrangeDrop({
      fromStore: true,
      sourceUrl: STORE_PAGE,
    });

    const page = await catalog.getBrandBySlug(brand.slug);

    const mine = page.drops.find((d) => d.id === drop.id);
    expect(mine?.purchase).toEqual({ url: STORE_PAGE, kind: 'store' });
  });

  it('still exposes only approved, published drops', async () => {
    // The purchase field must not become a way for a pending drop to leak.
    const { drop } = await arrangeDrop({ published: false });

    const feed = await catalog.listPublishedDrops(200);

    expect(feed.drops.some((d) => d.id === drop.id)).toBe(false);
    await expect(catalog.getPublishedDrop(drop.id)).rejects.toThrow();
  });

  it('does not leak how the decision was made', async () => {
    // The website renders what it is told; provenance is not its business, and
    // exposing it would invite the web app to start deciding for itself.
    const { drop } = await arrangeDrop({ fromStore: true, sourceUrl: STORE_PAGE });

    const served = (await catalog.getPublishedDrop(drop.id)) as Record<string, unknown>;

    expect(served).not.toHaveProperty('sourceEvent');
    expect(served).not.toHaveProperty('sourceType');
  });
});
