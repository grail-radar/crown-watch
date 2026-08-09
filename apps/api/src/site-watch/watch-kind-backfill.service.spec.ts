/**
 * Classifying the Watches recorded before there was such a thing as a kind.
 *
 * Against a real database, because the point of the exercise is what can be
 * queried afterwards: until an accessory says so on its row, the accessory
 * Drops already on the public feed cannot be found.
 */
import { DropType, ModerationStatus, WatchKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WatchKindBackfillService } from './watch-kind-backfill.service';

describe('WatchKindBackfillService', () => {
  let prisma: PrismaService;
  let backfill: WatchKindBackfillService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    backfill = new WatchKindBackfillService(prisma);
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function arrangeBrand() {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `YEMA ${tag}`, slug: `yema-${tag}` },
    });
    brandIds.push(brand.id);
    return brand;
  }

  /** A Watch as it stood before kinds existed: everything defaulted to `watch`. */
  async function arrangeWatch(
    brandId: string,
    name: string,
    over: { kindOverride?: WatchKind; drops?: number } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const watch = await prisma.watch.create({
      data: {
        brandId,
        key: `${name.toLowerCase()}-${tag}`,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag}`,
        name,
        kindOverride: over.kindOverride ?? null,
      },
    });
    for (let i = 0; i < (over.drops ?? 0); i += 1) {
      await prisma.drop.create({
        data: {
          brandId,
          watchId: watch.id,
          title: name,
          type: DropType.pre_order,
          moderationStatus: ModerationStatus.approved,
          publishedAt: new Date(),
        },
      });
    }
    return watch;
  }

  const reload = (id: string) =>
    prisma.watch.findUniqueOrThrow({ where: { id } });

  it('changes nothing on a dry run, but says what it would do', async () => {
    const brand = await arrangeBrand();
    const strap = await arrangeWatch(brand.id, 'Vintage Leather Strap');

    const result = await backfill.backfill();

    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(0);
    expect(result.changes.map((c) => c.watchId)).toContain(strap.id);
    expect((await reload(strap.id)).kind).toBe(WatchKind.watch);
  });

  it('marks the straps and leaves the watches alone', async () => {
    const brand = await arrangeBrand();
    const strap = await arrangeWatch(brand.id, 'Rallye Leather Strap');
    const watch = await arrangeWatch(brand.id, 'Superman Bronze CMM.10');

    await backfill.backfill({ confirm: true });

    expect((await reload(strap.id)).kind).toBe(WatchKind.accessory);
    expect((await reload(watch.id)).kind).toBe(WatchKind.watch);
  });

  it('does not overturn an operator', async () => {
    // Someone decided this one already. The rule does not get a second vote.
    const brand = await arrangeBrand();
    const ruled = await arrangeWatch(brand.id, 'Leather Strap', {
      kindOverride: WatchKind.watch,
    });

    const result = await backfill.backfill({ confirm: true });

    expect(result.overridden).toBeGreaterThanOrEqual(1);
    expect(result.changes.map((c) => c.watchId)).not.toContain(ruled.id);
    expect((await reload(ruled.id)).kind).toBe(WatchKind.watch);
  });

  it('counts the Drops that were announced about accessories', async () => {
    // The number the cleanup ticket needs, and the reason this runs at all.
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Marine Nationale Parachute Strap', { drops: 3 });

    const result = await backfill.backfill();

    expect(result.accessoryDrops).toBeGreaterThanOrEqual(3);
  });

  it('makes accessory Drops findable by a query afterwards', async () => {
    // The acceptance criterion in one assertion: after this runs, "which Drops
    // should never have gone out" is a join, not a re-poll.
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Satin Leather Strap', { drops: 2 });
    await arrangeWatch(brand.id, 'Skin Diver CMM.20', { drops: 1 });

    await backfill.backfill({ confirm: true });

    const announced = await prisma.drop.findMany({
      where: { brandId: brand.id, watch: { kind: WatchKind.accessory } },
      select: { title: true },
    });
    expect(announced).toHaveLength(2);
    expect(announced.every((d) => d.title === 'Satin Leather Strap')).toBe(true);
  });

  it('does nothing the second time it is run', async () => {
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Mesh Bracelet');

    const first = await backfill.backfill({ confirm: true });
    const second = await backfill.backfill({ confirm: true });

    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect(second.updated).toBe(0);
  });
});
