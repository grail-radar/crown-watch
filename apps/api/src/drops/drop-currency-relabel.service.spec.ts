/**
 * Re-deriving the currency on Drops the watcher already published.
 *
 * Against a real database, because the question is what survives. Until #24 the
 * label came from `watch_config.currency`, typed once at registration, and
 * roughly half of YEMA's Drops carry one nobody can stand behind. This must
 * clear those without also throwing away the labels that were right.
 */
import { DropType, ModerationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DropCurrencyRelabelService } from './drop-currency-relabel.service';

describe('DropCurrencyRelabelService', () => {
  let prisma: PrismaService;
  let relabel: DropCurrencyRelabelService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    relabel = new DropCurrencyRelabelService(prisma);
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Brand ${tag}`, slug: `brand-${tag}` },
    });
    brandIds.push(brand.id);
    return brand;
  }

  /** A Watch whose Variants carry whatever the store last evidenced. */
  async function arrangeWatch(
    brandId: string,
    variants: Array<{ currency: string | null; price: number | null }>,
  ) {
    const tag = randomUUID().slice(0, 8);
    return prisma.watch.create({
      data: {
        brandId,
        key: `w-${tag}`,
        slug: `w-${tag}`,
        name: `Watch ${tag}`,
        variants: {
          create: variants.map((v, i) => ({
            productUrl: `https://brand.example/p/${tag}-${i}`,
            price: v.price,
            currency: v.currency,
            available: true,
          })),
        },
      },
    });
  }

  const arrangeDrop = (
    brandId: string,
    currency: string | null,
    watchId: string | null,
  ) =>
    prisma.drop.create({
      data: {
        brandId,
        watchId,
        title: 'A watch',
        type: DropType.pre_order,
        priceLow: 650,
        currency,
        moderationStatus: ModerationStatus.approved,
        publishedAt: new Date(),
      },
    });

  const reload = (id: string) =>
    prisma.drop.findUniqueOrThrow({ where: { id } });

  it('changes nothing on a dry run, but says what it would do', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [{ currency: null, price: 650 }]);
    const drop = await arrangeDrop(brand.id, 'USD', watch.id);

    const result = await relabel.relabel();

    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(0);
    expect(result.changes.map((c) => c.dropId)).toContain(drop.id);
    expect((await reload(drop.id)).currency).toBe('USD');
  });

  it('clears a label the store no longer evidences', async () => {
    // The YEMA case: a Shopify feed carries no currency, so the Variants say
    // nothing and the old `USD` was a coin flip.
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [
      { currency: null, price: 2190 },
      { currency: null, price: 2190 },
    ]);
    const drop = await arrangeDrop(brand.id, 'USD', watch.id);

    await relabel.relabel({ confirm: true });

    expect((await reload(drop.id)).currency).toBeNull();
  });

  it('leaves a label the store does evidence exactly where it is', async () => {
    // The Baltic case: the listing page prints `€ 640.00`, so the Variants
    // agree on EUR and the Drop was right all along. A blanket wipe would
    // have thrown this away.
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [
      { currency: 'EUR', price: 640 },
      { currency: 'EUR', price: 690 },
    ]);
    const drop = await arrangeDrop(brand.id, 'EUR', watch.id);

    const result = await relabel.relabel({ confirm: true });

    expect((await reload(drop.id)).currency).toBe('EUR');
    expect(result.changes.map((c) => c.dropId)).not.toContain(drop.id);
  });

  it('corrects a label that disagrees with the store', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [{ currency: 'GBP', price: 640 }]);
    const drop = await arrangeDrop(brand.id, 'EUR', watch.id);

    await relabel.relabel({ confirm: true });

    expect((await reload(drop.id)).currency).toBe('GBP');
  });

  it('clears rather than guesses when the variants disagree', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [
      { currency: 'EUR', price: 640 },
      { currency: 'GBP', price: 590 },
    ]);
    const drop = await arrangeDrop(brand.id, 'EUR', watch.id);

    await relabel.relabel({ confirm: true });

    expect((await reload(drop.id)).currency).toBeNull();
  });

  it('ignores an unpriced variant, which evidences nothing', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [
      { currency: 'EUR', price: 640 },
      { currency: null, price: null },
    ]);
    const drop = await arrangeDrop(brand.id, 'EUR', watch.id);

    await relabel.relabel({ confirm: true });

    expect((await reload(drop.id)).currency).toBe('EUR');
  });

  it('does not touch a Drop that is about no Watch', async () => {
    // An RSS-extracted Drop's currency was read out of a publication's prose,
    // not from the registration label this replaces.
    const brand = await arrangeBrand();
    const drop = await arrangeDrop(brand.id, 'CHF', null);

    const result = await relabel.relabel({ confirm: true });

    expect(result.skippedWithoutWatch).toBeGreaterThanOrEqual(1);
    expect(result.changes.map((c) => c.dropId)).not.toContain(drop.id);
    expect((await reload(drop.id)).currency).toBe('CHF');
  });

  it('leaves the price and the publication alone', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [{ currency: null, price: 650 }]);
    const drop = await arrangeDrop(brand.id, 'USD', watch.id);

    await relabel.relabel({ confirm: true });

    const after = await reload(drop.id);
    expect(Number(after.priceLow)).toBe(650);
    expect(after.publishedAt).not.toBeNull();
    expect(after.moderationStatus).toBe(ModerationStatus.approved);
  });

  it('does nothing the second time it is run', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, [{ currency: null, price: 650 }]);
    await arrangeDrop(brand.id, 'USD', watch.id);

    const first = await relabel.relabel({ confirm: true });
    const second = await relabel.relabel({ confirm: true });

    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect(second.updated).toBe(0);
  });
});
