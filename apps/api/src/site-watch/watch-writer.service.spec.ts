/**
 * Turning a store's product list into Watches, against a real database.
 *
 * Assertions are on what a reader would end up seeing on a brand's page — how
 * many watches, and how many ways there are to buy each — never on how the
 * grouping was computed. That belongs to `watch-identity.spec.ts`.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProductSnapshot } from './snapshot';
import { WatchWriterService } from './watch-writer.service';

const product = (over: Partial<ProductSnapshot> & { url: string }): ProductSnapshot => ({
  title: 'Superman Bronze CMM.10',
  price: 2190,
  currency: 'EUR',
  imageUrl: 'https://cdn.example/a.jpg',
  available: true,
  ...over,
});

describe('WatchWriterService', () => {
  let prisma: PrismaService;
  let writer: WatchWriterService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    writer = new WatchWriterService(prisma);
  });

  afterAll(async () => {
    // Watches and variants cascade from the brand.
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Watch Co ${tag}`, slug: `watch-co-${tag}` },
    });
    brandIds.push(brand.id);
    return brand;
  }

  const watchesFor = (brandId: string) =>
    prisma.watch.findMany({
      where: { brandId },
      include: { variants: { orderBy: { productUrl: 'asc' } } },
      orderBy: { name: 'asc' },
    });

  it('collapses the references a store lists for one model into one Watch', async () => {
    // The YEMA case: three products, one title, three ways to buy one watch.
    const brand = await arrangeBrand();

    await writer.record(brand.id, brand.slug, [
      product({ url: 'https://yema.example/products/superman-bronze-u8' }),
      product({ url: 'https://yema.example/products/superman-bronze-u7' }),
      product({ url: 'https://yema.example/products/superman-bronze-u4' }),
    ]);

    const watches = await watchesFor(brand.id);
    expect(watches).toHaveLength(1);
    expect(watches[0].name).toBe('Superman Bronze CMM.10');
    expect(watches[0].variants).toHaveLength(3);
  });

  it('keeps two dials of one line as two Watches', async () => {
    // The Baltic case, which any rule that hunts for a common stem gets wrong.
    const brand = await arrangeBrand();

    await writer.record(brand.id, brand.slug, [
      product({ url: 'https://baltic.example/products/panda', title: 'Scalegraph Classic - Panda' }),
      product({ url: 'https://baltic.example/products/reverse', title: 'Scalegraph Classic - Reverse Panda' }),
    ]);

    expect(await watchesFor(brand.id)).toHaveLength(2);
  });

  it('records what a reader needs to buy a particular variant', async () => {
    const brand = await arrangeBrand();

    await writer.record(brand.id, brand.slug, [
      product({
        url: 'https://serica.example/products/8315-2',
        title: 'Réf. 8315-2 (SYU66-20-SS)',
        price: 1585,
        currency: 'EUR',
        available: false,
      }),
    ]);

    const [watch] = await watchesFor(brand.id);
    const [variant] = watch.variants;
    expect(variant.productUrl).toBe('https://serica.example/products/8315-2');
    expect(variant.reference).toBe('SYU66-20-SS');
    expect(Number(variant.price)).toBe(1585);
    expect(variant.currency).toBe('EUR');
    expect(variant.available).toBe(false);
  });

  it('creates nothing twice when the same catalogue is recorded again', async () => {
    // Every poll of an unchanged store runs through here. If it were not
    // idempotent, a brand page would grow a duplicate watch every hour.
    const brand = await arrangeBrand();
    const catalogue = [
      product({ url: 'https://brand.example/products/a' }),
      product({ url: 'https://brand.example/products/b', title: 'Aquascaphe' }),
    ];

    await writer.record(brand.id, brand.slug, catalogue);
    const first = await watchesFor(brand.id);
    await writer.record(brand.id, brand.slug, catalogue);
    const second = await watchesFor(brand.id);

    expect(second).toHaveLength(first.length);
    expect(second.flatMap((w) => w.variants)).toHaveLength(2);
    // The URL a reader may already have shared must not move.
    expect(second.map((w) => w.slug)).toEqual(first.map((w) => w.slug));
    expect(second.map((w) => w.id)).toEqual(first.map((w) => w.id));
  });

  it('updates a variant in place when its price or availability moves', async () => {
    const brand = await arrangeBrand();
    const url = 'https://brand.example/products/moving';

    await writer.record(brand.id, brand.slug, [
      product({ url, price: 500, available: false }),
    ]);
    await writer.record(brand.id, brand.slug, [
      product({ url, price: 550, available: true }),
    ]);

    const [watch] = await watchesFor(brand.id);
    expect(watch.variants).toHaveLength(1);
    expect(Number(watch.variants[0].price)).toBe(550);
    expect(watch.variants[0].available).toBe(true);
  });

  it('gives two watches distinct URLs even when their names slug the same', async () => {
    // "Panda!" and "Panda?" are different watches that reduce to one slug.
    // Without a tiebreak the second would collide on (brand, slug) and the
    // whole poll would fail.
    const brand = await arrangeBrand();

    await writer.record(brand.id, brand.slug, [
      product({ url: 'https://brand.example/products/one', title: 'Panda!' }),
      product({ url: 'https://brand.example/products/two', title: 'Panda?' }),
    ]);

    const watches = await watchesFor(brand.id);
    expect(watches).toHaveLength(2);
    expect(new Set(watches.map((w) => w.slug)).size).toBe(2);
  });

  it('renames a watch in place when a store retitles its only product', async () => {
    // The same URL is the same thing in the world, whatever the store calls it.
    // A retitle must therefore rename the watch, not strand the old one: an
    // empty watch is a dead page at a URL somebody may already have shared.
    const brand = await arrangeBrand();
    const url = 'https://brand.example/products/renamed';

    await writer.record(brand.id, brand.slug, [product({ url, title: 'Old Name' })]);
    const [before] = await watchesFor(brand.id);
    await writer.record(brand.id, brand.slug, [product({ url, title: 'New Name' })]);

    const after = await watchesFor(brand.id);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('New Name');
    expect(after[0].variants).toHaveLength(1);
    // Same row, same URL — a reader's link still works.
    expect(after[0].id).toBe(before.id);
    expect(after[0].slug).toBe(before.slug);
  });

  it('leaves no watch behind with nothing to buy', async () => {
    // The general form of the case above: whatever the store does to its
    // titles, a brand page must never grow an entry that leads nowhere.
    const brand = await arrangeBrand();

    await writer.record(brand.id, brand.slug, [
      product({ url: 'https://brand.example/products/x', title: 'First Name' }),
      product({ url: 'https://brand.example/products/y', title: 'Other' }),
    ]);
    await writer.record(brand.id, brand.slug, [
      product({ url: 'https://brand.example/products/x', title: 'Second Name' }),
      product({ url: 'https://brand.example/products/y', title: 'Other' }),
    ]);

    const watches = await watchesFor(brand.id);
    expect(watches.every((w) => w.variants.length > 0)).toBe(true);
  });
});
