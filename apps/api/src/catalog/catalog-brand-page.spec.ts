/**
 * What a Brand page is served, and in what shape.
 *
 * The screen this product is judged on (#28). A reader deciding whether a Brand
 * deserves their attention needs the judgement, then what it costs, then what
 * the Brand makes — and each Watch exactly once, however many store products
 * sit beneath it. YEMA reading "4 drops tracked" for two watches, and listing
 * the Superman Bronze three times, is the bug this file pins down.
 *
 * The real service against a real database: the page renders what it is given,
 * so counting, collapsing and pricing are decided here rather than in JSX.
 */
import { BrandStatus, DropType, ModerationStatus, WatchKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService — the Brand page', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    // Watches, variants and drops all cascade from the brand.
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand(name = 'YEMA') {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `${name} ${tag}`,
        slug: `${name.toLowerCase()}-${tag}`,
        website: 'https://yema.example',
      },
    });
    brandIds.push(brand.id);
    return brand;
  }

  /**
   * One Watch and the store products beneath it. Each variant needs its own
   * URL: a product URL identifies exactly one thing in the whole database.
   */
  async function arrangeWatch(
    brandId: string,
    name: string,
    variants: Array<{
      price?: number | null;
      currency?: string | null;
      available?: boolean;
      image?: string | null;
    }> = [{}],
    kind: WatchKind = WatchKind.watch,
  ) {
    const tag = randomUUID().slice(0, 8);
    return prisma.watch.create({
      data: {
        brandId,
        kind,
        key: `${name.toLowerCase()}-${tag}`,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag}`,
        name,
        variants: {
          create: variants.map((v, i) => ({
            productUrl: `https://yema.example/products/${tag}-${i}`,
            price: v.price === undefined ? 500 : v.price,
            currency: v.currency === undefined ? 'EUR' : v.currency,
            imageUrl: v.image === undefined ? 'https://cdn.example/w.jpg' : v.image,
            available: v.available ?? true,
          })),
        },
      },
    });
  }

  const arrangeDrop = (
    brandId: string,
    watchId: string | null,
    title: string,
    publishedAt = new Date(),
  ) =>
    prisma.drop.create({
      data: {
        brandId,
        watchId,
        title,
        type: DropType.restock,
        moderationStatus: ModerationStatus.approved,
        publishedAt,
      },
    });

  describe('what the Brand makes', () => {
    it('lists a Watch once however many store products sit beneath it', async () => {
      // The Superman Bronze CMM.10 is three YEMA products, one per bracelet.
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze CMM.10', [
        { price: 990 },
        { price: 1090 },
        { price: 1190 },
      ]);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.watches.map((w) => w.name)).toEqual([
        'Superman Bronze CMM.10',
      ]);
      expect(detail.watches[0].variantCount).toBe(3);
    });

    it('gives each Watch a link, a price and a photo', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Heritage', [
        { price: 1290, image: null },
        { price: 990, image: 'https://cdn.example/heritage.jpg' },
      ]);

      const [watch] = (await catalog.getBrandBySlug(brand.slug)).watches;

      expect(watch.slug).toBeTruthy();
      expect(Number(watch.priceLow)).toBe(990); // cheapest of the two
      expect(watch.currency).toBe('EUR');
      // Borrowed from whichever variant has one, exactly as the Watch page does.
      expect(watch.imageUrl).toBe('https://cdn.example/heritage.jpg');
      expect(watch.available).toBe(true);
    });

    it('keeps accessories out of the list of Watches', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [{ price: 990 }]);
      await arrangeWatch(
        brand.id,
        'Rallye Leather Strap',
        [{ price: 60 }],
        WatchKind.accessory,
      );

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.watches.map((w) => w.name)).toEqual(['Superman Bronze']);
      expect(detail.accessories.map((a) => a.name)).toEqual([
        'Rallye Leather Strap',
      ]);
    });

    it('leads with the ones a reader can actually buy', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'A Sold Out Watch', [
        { price: 800, available: false },
      ]);
      await arrangeWatch(brand.id, 'Z In Stock Watch', [
        { price: 1800, available: true },
      ]);

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.watches.map((w) => w.name)).toEqual([
        'Z In Stock Watch',
        'A Sold Out Watch',
      ]);
    });

    it('gives a Brand with no Watches an empty list rather than a missing one', async () => {
      const brand = await arrangeBrand();

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.watches).toEqual([]);
      expect(detail.watchCount).toBe(0);
      expect(detail.priceBand).toBeNull();
    });
  });

  describe('the headline count', () => {
    it('counts Watches rather than Drops', async () => {
      // YEMA's page read "4 drops tracked" for what a reader sees as 2 watches:
      // one release announced once per store product, before grouping existed.
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze CMM.10');
      const heritage = await arrangeWatch(brand.id, 'Superman Heritage');
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze CMM.10');
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze CMM.10 — steel');
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze CMM.10 — rubber');
      await arrangeDrop(brand.id, heritage.id, 'Superman Heritage');

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.watchCount).toBe(2);
    });

    it('does not count accessories among them', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze');
      await arrangeWatch(brand.id, 'Canvas Strap', [{}], WatchKind.accessory);

      expect((await catalog.getBrandBySlug(brand.slug)).watchCount).toBe(1);
    });

    it('is the true total even when the list of Watches is capped', async () => {
      // The count is what the page says out loud, so it may not quietly become
      // "however many we chose to render".
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze');
      await arrangeWatch(brand.id, 'Superman Heritage');

      const detail = await catalog.getBrandBySlug(brand.slug, 1);

      expect(detail.watches).toHaveLength(1);
      expect(detail.watchCount).toBe(2);
    });

    it('reaches the brand directory too', async () => {
      // A card reading "4 drops" next to a page reading "2 watches" is the same
      // inconsistency, one click earlier.
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze');
      await arrangeWatch(brand.id, 'Canvas Strap', [{}], WatchKind.accessory);
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze');
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze again');

      const { brands } = await catalog.listBrands(200);
      const mine = brands.find((b) => b.slug === brand.slug);

      expect(mine?._count.watches).toBe(1);
    });
  });

  describe('what it costs', () => {
    it('derives the band from the Brand’s own Variants', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [
        { price: 990 },
        { price: 1190 },
      ]);
      await arrangeWatch(brand.id, 'Superman Heritage', [{ price: 690 }]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(Number(priceBand?.low)).toBe(690);
      expect(Number(priceBand?.high)).toBe(1190);
      expect(priceBand?.currency).toBe('EUR');
    });

    it('does not let a strap set the floor', async () => {
      // "from €60" on a brand whose cheapest watch is €690 is a lie a reader
      // discovers one click later.
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [{ price: 690 }]);
      await arrangeWatch(
        brand.id,
        'Rallye Leather Strap',
        [{ price: 60 }],
        WatchKind.accessory,
      );

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(Number(priceBand?.low)).toBe(690);
    });

    it('labels the band only when every priced Variant carried a currency', async () => {
      // #24: a Shopify feed states a bare number. Reading a symbol into it is
      // how a €990 watch was shown as $990.
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [
        { price: 990, currency: 'EUR' },
        { price: 1190, currency: null },
      ]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(Number(priceBand?.low)).toBe(990);
      expect(Number(priceBand?.high)).toBe(1190);
      expect(priceBand?.currency).toBeNull();
    });

    it('serves a bare band when no Variant carried a currency at all', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [
        { price: 990, currency: null },
      ]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(Number(priceBand?.low)).toBe(990);
      expect(priceBand?.currency).toBeNull();
    });

    it('withholds the band when the prices are in two currencies', async () => {
      // €990 to $1,400 is not a range; it is two numbers that cannot be
      // compared, and a reader would read the smaller one as the entry price.
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [
        { price: 990, currency: 'EUR' },
      ]);
      await arrangeWatch(brand.id, 'Superman Heritage', [
        { price: 1400, currency: 'USD' },
      ]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(priceBand).toBeNull();
    });

    it('reports no band rather than zero when nothing is priced', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [{ price: null }]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(priceBand).toBeNull();
    });

    it('collapses to a single figure when every Watch costs the same', async () => {
      const brand = await arrangeBrand();
      await arrangeWatch(brand.id, 'Superman Bronze', [{ price: 990 }]);
      await arrangeWatch(brand.id, 'Superman Heritage', [{ price: 990 }]);

      const { priceBand } = await catalog.getBrandBySlug(brand.slug);

      expect(Number(priceBand?.low)).toBe(990);
      expect(Number(priceBand?.high)).toBe(990);
    });
  });

  describe('what has recently happened', () => {
    it('shows a Watch once however many times it was announced', async () => {
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze CMM.10');
      await arrangeDrop(
        brand.id,
        bronze.id,
        'Superman Bronze CMM.10 — bracelet',
        new Date('2026-08-06T09:00:00.000Z'),
      );
      await arrangeDrop(
        brand.id,
        bronze.id,
        'Superman Bronze CMM.10 — rubber',
        new Date('2026-08-06T09:01:00.000Z'),
      );

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops).toHaveLength(1);
    });

    it('keeps the most recent of them', async () => {
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze');
      await arrangeDrop(
        brand.id,
        bronze.id,
        'the old one',
        new Date('2026-07-01T00:00:00.000Z'),
      );
      await arrangeDrop(
        brand.id,
        bronze.id,
        'the latest one',
        new Date('2026-08-06T00:00:00.000Z'),
      );

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops.map((d) => d.title)).toEqual(['the latest one']);
    });

    it('keeps every Drop that belongs to no Watch', async () => {
      // Anything read out of a publication's prose has a null watch_id. They
      // are not duplicates of each other and collapsing them would delete news.
      const brand = await arrangeBrand();
      await arrangeDrop(
        brand.id,
        null,
        'Read about it in Hodinkee',
        new Date('2026-08-01T00:00:00.000Z'),
      );
      await arrangeDrop(
        brand.id,
        null,
        'And again in Fratello',
        new Date('2026-08-02T00:00:00.000Z'),
      );

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops.map((d) => d.title)).toEqual([
        'And again in Fratello',
        'Read about it in Hodinkee',
      ]);
    });

    it('keeps one Drop per Watch, not one Drop overall', async () => {
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze');
      const heritage = await arrangeWatch(brand.id, 'Superman Heritage');
      await arrangeDrop(brand.id, bronze.id, 'Bronze', new Date('2026-08-01T00:00:00.000Z'));
      await arrangeDrop(brand.id, bronze.id, 'Bronze again', new Date('2026-08-02T00:00:00.000Z'));
      await arrangeDrop(brand.id, heritage.id, 'Heritage', new Date('2026-08-03T00:00:00.000Z'));

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops.map((d) => d.title)).toEqual([
        'Heritage',
        'Bronze again',
      ]);
    });

    it('sends a reader from a Drop to the Watch it is about', async () => {
      const brand = await arrangeBrand();
      const bronze = await arrangeWatch(brand.id, 'Superman Bronze');
      await arrangeDrop(brand.id, bronze.id, 'Superman Bronze');

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.drops[0].watch).toEqual({
        brandSlug: brand.slug,
        watchSlug: bronze.slug,
      });
    });
  });

  describe('a Brand with nothing to show', () => {
    it('renders without an Annotation, a Watch or a Drop', async () => {
      const brand = await arrangeBrand();

      const detail = await catalog.getBrandBySlug(brand.slug);

      expect(detail.status).toBe(BrandStatus.listed);
      expect(detail.annotation).toBeNull();
      expect(detail.watches).toEqual([]);
      expect(detail.watchCount).toBe(0);
      expect(detail.priceBand).toBeNull();
      expect(detail.drops).toEqual([]);
      expect(detail.accessories).toEqual([]);
    });
  });
});
