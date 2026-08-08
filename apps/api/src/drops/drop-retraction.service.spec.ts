/**
 * Retracting drops that should never have been announced.
 *
 * Against a real database, because the whole question is what survives: the
 * public feed must lose them, and `drop_broadcasts` must not. Those rows are
 * the only record that a message was sent, and ADR-0002 spends them to make
 * "at most once, ever" true — a cleanup that destroys them turns the next
 * backfill into a second incident.
 */
import { ConfigService } from '@nestjs/config';
import { DropType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { DropRetractionService } from './drop-retraction.service';

const INSIDE = new Date('2026-08-07T13:00:00.000Z');
const BEFORE = new Date('2026-08-06T05:05:00.000Z');
const AFTER = new Date('2026-08-08T09:00:00.000Z');
const WINDOW = {
  from: new Date('2026-08-07T12:31:00.000Z'),
  to: new Date('2026-08-07T13:39:00.000Z'),
};

describe('DropRetractionService', () => {
  let prisma: PrismaService;
  let retraction: DropRetractionService;
  let catalog: CatalogService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    retraction = new DropRetractionService(prisma);
    catalog = new CatalogService(prisma);
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

  async function arrangeDrop(
    brandId: string,
    publishedAt: Date,
    over: { broadcast?: boolean; title?: string } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const drop = await prisma.drop.create({
      data: {
        brandId,
        title: over.title ?? `Superman Bronze ${tag}`,
        type: DropType.pre_order,
        sourceUrl: `https://yema.example/products/${tag}`,
        moderationStatus: 'approved',
        publishedAt,
      },
    });
    if (over.broadcast) {
      await prisma.dropBroadcast.createMany({
        data: [
          { dropId: drop.id, chatId: '@crownwatch_ua', locale: 'uk', status: 'sent', sentAt: new Date() },
          { dropId: drop.id, chatId: '@crownwatch_en', locale: 'en', status: 'sent', sentAt: new Date() },
        ],
      });
    }
    return drop;
  }

  const publishedIds = async (brandId: string) =>
    (await catalog.getBrandBySlug(
      (await prisma.brand.findUniqueOrThrow({ where: { id: brandId } })).slug,
    )).drops.map((d) => d.id);

  it('reports what it would retract without changing anything', async () => {
    const brand = await arrangeBrand();
    const inside = await arrangeDrop(brand.id, INSIDE);

    const result = await retraction.retract({ ...WINDOW, brandIds: [brand.id] });

    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((c) => c.id)).toEqual([inside.id]);
    expect(result.retracted).toBe(0);
    // Still public — a dry run that changed something would be worthless.
    expect(await publishedIds(brand.id)).toEqual([inside.id]);
  });

  it('takes the retracted drops off the public feed once confirmed', async () => {
    const brand = await arrangeBrand();
    await arrangeDrop(brand.id, INSIDE);
    await arrangeDrop(brand.id, INSIDE);

    const result = await retraction.retract({
      ...WINDOW,
      brandIds: [brand.id],
      confirm: true,
    });

    expect(result.retracted).toBe(2);
    expect(await publishedIds(brand.id)).toEqual([]);
  });

  it('leaves everything outside the window alone', async () => {
    // The 26 legitimate drops, including three genuine store releases the day
    // before, and drops that arrive after the cleanup runs.
    const brand = await arrangeBrand();
    const before = await arrangeDrop(brand.id, BEFORE);
    const after = await arrangeDrop(brand.id, AFTER);
    await arrangeDrop(brand.id, INSIDE);

    await retraction.retract({ ...WINDOW, brandIds: [brand.id], confirm: true });

    expect((await publishedIds(brand.id)).sort()).toEqual([before.id, after.id].sort());
  });

  it('destroys no record of what was already sent', async () => {
    // The load-bearing one. Deleting a drop would cascade these away.
    const brand = await arrangeBrand();
    const drop = await arrangeDrop(brand.id, INSIDE, { broadcast: true });

    await retraction.retract({ ...WINDOW, brandIds: [brand.id], confirm: true });

    const rows = await prisma.dropBroadcast.findMany({ where: { dropId: drop.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    // And the drop itself still exists, so the history is auditable.
    expect(await prisma.drop.findUnique({ where: { id: drop.id } })).not.toBeNull();
  });

  it('leaves nothing for a later backfill to re-announce', async () => {
    // The failure this whole ticket exists to avoid: a cleanup that ends in
    // 372 messages going out a second time.
    const brand = await arrangeBrand();
    await arrangeDrop(brand.id, INSIDE, { broadcast: true });
    await arrangeDrop(brand.id, INSIDE);

    await retraction.retract({ ...WINDOW, brandIds: [brand.id], confirm: true });

    const telegram = new CapturingTelegram();
    const alerts = new AlertDispatchService(
      prisma,
      new ConfigService({
        digest: { publicWebUrl: 'https://crownswatch.org' },
        telegram: {
          botToken: 'test-token',
          channels: { uk: '@crownwatch_ua', en: '@crownwatch_en' },
          groups: [],
        },
      }),
      telegram,
    );
    const backfill = await alerts.backfill({ limit: 50, confirm: true, delayMs: 0 });

    // Scoped to this brand: the backfill considers the whole database, and
    // other specs leave their own drops pending in the shared test database.
    expect(backfill.candidates.filter((c) => c.brandName === brand.name)).toEqual([]);
    expect(telegram.sent.filter((s) => s.text.includes(brand.name))).toEqual([]);
  });

  it('refuses a window that would retract nothing, rather than reporting success', async () => {
    // A mistyped window is far more likely than a genuinely empty one, and
    // "0 retracted, all good" is exactly how that mistake goes unnoticed.
    const brand = await arrangeBrand();

    await expect(
      retraction.retract({
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2020-01-02T00:00:00.000Z'),
        brandIds: [brand.id],
        confirm: true,
      }),
    ).rejects.toThrow(/no drops/i);
  });

  it('refuses a backwards window', async () => {
    const brand = await arrangeBrand();

    await expect(
      retraction.retract({ from: WINDOW.to, to: WINDOW.from, brandIds: [brand.id] }),
    ).rejects.toThrow(/window/i);
  });
});
