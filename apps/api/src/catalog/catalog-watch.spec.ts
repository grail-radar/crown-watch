/**
 * What the website is served for one Watch.
 *
 * The real service against a real database — the page renders exactly what it
 * is given, so this is where "a reader can see every way to buy this watch" is
 * actually decided.
 */
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService — watches', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    catalog = new CatalogService(prisma);
  });

  afterAll(async () => {
    // Watches and variants cascade from the brand.
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeWatch(
    variants: Array<{
      url: string;
      price?: number | null;
      available?: boolean;
      image?: string | null;
      reference?: string | null;
    }>,
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Baltic ${tag}`, slug: `baltic-${tag}`, website: 'https://baltic.example' },
    });
    brandIds.push(brand.id);

    const watch = await prisma.watch.create({
      data: {
        brandId: brand.id,
        key: `${brand.slug}:aquascaphe`,
        slug: 'aquascaphe',
        name: 'Aquascaphe MK2',
        variants: {
          create: variants.map((v) => ({
            // A product URL is unique across the whole database, by design — it
            // identifies one thing in the world. So each test needs its own.
            productUrl: v.url.replace('://', `://${tag}.`),
            reference: v.reference ?? null,
            price: v.price === undefined ? 1585 : v.price,
            currency: 'EUR',
            imageUrl: v.image === undefined ? 'https://cdn.example/a.jpg' : v.image,
            available: v.available ?? true,
          })),
        },
      },
    });
    return { brand, watch };
  }

  it('serves a watch with every way to buy it', async () => {
    const { brand } = await arrangeWatch([
      { url: 'https://baltic.example/products/a', reference: 'REF-A' },
      { url: 'https://baltic.example/products/b' },
    ]);

    const watch = await catalog.getWatch(brand.slug, 'aquascaphe');

    expect(watch.name).toBe('Aquascaphe MK2');
    expect(watch.brand.name).toBe(brand.name);
    expect(watch.variants).toHaveLength(2);
    expect(watch.variants.every((v) => v.productUrl.includes('/products/'))).toBe(
      true,
    );
    expect(watch.variants.find((v) => v.reference === 'REF-A')).toBeDefined();
  });

  it('puts the cheapest way to buy it first', async () => {
    // The first thing anyone wants from a list of variants is the entry price.
    const { brand } = await arrangeWatch([
      { url: 'https://baltic.example/products/steel', price: 1685 },
      { url: 'https://baltic.example/products/strap', price: 1585 },
    ]);

    const watch = await catalog.getWatch(brand.slug, 'aquascaphe');

    expect(watch.variants.map((v) => Number(v.price))).toEqual([1585, 1685]);
  });

  it('borrows an image from whichever variant has one', async () => {
    // Stores routinely photograph the headline reference and not its siblings.
    const { brand } = await arrangeWatch([
      { url: 'https://baltic.example/products/a', price: 100, image: null },
      { url: 'https://baltic.example/products/b', price: 200, image: 'https://cdn.example/b.jpg' },
    ]);

    const watch = await catalog.getWatch(brand.slug, 'aquascaphe');

    expect(watch.imageUrl).toBe('https://cdn.example/b.jpg');
  });

  it('reports no image rather than inventing one', async () => {
    const { brand } = await arrangeWatch([
      { url: 'https://baltic.example/products/a', image: null },
    ]);

    expect((await catalog.getWatch(brand.slug, 'aquascaphe')).imageUrl).toBeNull();
  });

  it('says whether a variant can actually be bought right now', async () => {
    const { brand } = await arrangeWatch([
      { url: 'https://baltic.example/products/a', available: false },
    ]);

    const watch = await catalog.getWatch(brand.slug, 'aquascaphe');

    expect(watch.variants[0].available).toBe(false);
  });

  it('does not serve one brand’s watch under another brand’s name', async () => {
    // Slugs are unique per brand, not globally: two brands may both have an
    // `aquascaphe`, and the URL must decide which one a reader gets.
    const { brand } = await arrangeWatch([{ url: 'https://baltic.example/products/a' }]);
    const other = await prisma.brand.create({
      data: { name: 'Other', slug: `other-${randomUUID().slice(0, 8)}` },
    });
    brandIds.push(other.id);

    await expect(catalog.getWatch(other.slug, 'aquascaphe')).rejects.toThrow(
      NotFoundException,
    );
    await expect(catalog.getWatch(brand.slug, 'aquascaphe')).resolves.toBeDefined();
  });

  it('404s for a watch that does not exist', async () => {
    await expect(catalog.getWatch('nobody', 'nothing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
