/**
 * Giving history the Watch it was always about.
 *
 * Against a real database, because every acceptance criterion here is about
 * what survives. The three YEMA Drops from 2026-08-06 must stay three rows
 * under one Watch, and every `drop_broadcasts` row must come through untouched
 * — those rows are what makes "at most once, ever" true (ADR-0002), and a
 * cleanup that loses them re-announces a watch followers have already seen.
 */
import { ConfigService } from '@nestjs/config';
import { DropType, ModerationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { PrismaService } from '../prisma/prisma.service';
import { DropWatchBackfillService } from './drop-watch-backfill.service';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';

describe('DropWatchBackfillService', () => {
  let prisma: PrismaService;
  let backfill: DropWatchBackfillService;
  let telegram: CapturingTelegram;
  let alerts: AlertDispatchService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    backfill = new DropWatchBackfillService(prisma);
    telegram = new CapturingTelegram();
    alerts = new AlertDispatchService(
      prisma,
      new ConfigService({
        digest: { publicWebUrl: 'https://crownswatch.org' },
        telegram: {
          botToken: 'test-token',
          channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
        },
      }),
      telegram,
    );
  });

  beforeEach(() => {
    telegram.sent = [];
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

  /** A Watch with one Variant per product URL, as a poll would have built it. */
  async function arrangeWatch(
    brandId: string,
    name: string,
    productUrls: string[],
  ) {
    const tag = randomUUID().slice(0, 8);
    return prisma.watch.create({
      data: {
        brandId,
        key: `${name.toLowerCase()}-${tag}`,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tag}`,
        name,
        variants: { create: productUrls.map((productUrl) => ({ productUrl })) },
      },
    });
  }

  /** A published Drop, optionally with the broadcast rows proving it was sent. */
  async function arrangeDrop(
    brandId: string,
    over: { sourceUrl?: string | null; title?: string; broadcast?: boolean } = {},
  ) {
    const drop = await prisma.drop.create({
      data: {
        brandId,
        title: over.title ?? 'Superman Bronze CMM.10',
        type: DropType.pre_order,
        sourceUrl: over.sourceUrl === undefined ? null : over.sourceUrl,
        moderationStatus: ModerationStatus.approved,
        publishedAt: new Date('2026-08-06T05:05:00.000Z'),
      },
    });
    if (over.broadcast) {
      await prisma.dropBroadcast.createMany({
        data: [
          { locale: 'uk', chatId: UK_CHANNEL },
          { locale: 'en', chatId: EN_CHANNEL },
        ].map(({ locale, chatId }, i) => ({
          dropId: drop.id,
          locale,
          chatId,
          status: 'sent',
          messageId: `${1000 + i}`,
        })),
      });
    }
    return drop;
  }

  it('changes nothing on a dry run, but says what it would do', async () => {
    const brand = await arrangeBrand();
    const watch = await arrangeWatch(brand.id, 'Superman Bronze', [
      'https://yema.example/products/u8',
    ]);
    const drop = await arrangeDrop(brand.id, {
      sourceUrl: 'https://yema.example/products/u8',
    });

    const result = await backfill.backfill();

    expect(result.dryRun).toBe(true);
    expect(result.assigned).toBe(0);
    expect(result.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dropId: drop.id, watchId: watch.id }),
      ]),
    );
    const reloaded = await prisma.drop.findUniqueOrThrow({ where: { id: drop.id } });
    expect(reloaded.watchId).toBeNull();
  });

  it('groups the three YEMA drops under one watch, still as three rows', async () => {
    // The case the ticket names. Assigning is the whole job; merging them would
    // destroy the record that three messages went out.
    const brand = await arrangeBrand();
    const urls = [
      'https://yema.example/products/superman-u8',
      'https://yema.example/products/superman-u7',
      'https://yema.example/products/superman-u4',
    ];
    const watch = await arrangeWatch(brand.id, 'Superman Bronze CMM.10', urls);
    for (const sourceUrl of urls) {
      await arrangeDrop(brand.id, { sourceUrl, broadcast: true });
    }

    await backfill.backfill({ confirm: true });

    const drops = await prisma.drop.findMany({ where: { brandId: brand.id } });
    expect(drops).toHaveLength(3);
    expect(drops.every((d) => d.watchId === watch.id)).toBe(true);
  });

  it('preserves every broadcast record', async () => {
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Diver', ['https://yema.example/products/diver']);
    const drop = await arrangeDrop(brand.id, {
      sourceUrl: 'https://yema.example/products/diver',
      broadcast: true,
    });

    const result = await backfill.backfill({ confirm: true });

    expect(result.broadcastRowsAfter).toBe(result.broadcastRowsBefore);
    const rows = await prisma.dropBroadcast.findMany({ where: { dropId: drop.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    expect(rows.map((r) => r.messageId).sort()).toEqual(['1000', '1001']);
  });

  it('leaves the broadcast path with nothing left to send', async () => {
    // The criterion that matters most: a backfilled drop must not look fresh to
    // the dispatcher, or a follower is told twice about the same watch.
    //
    // Driven through `AlertDispatchService.backfill`, not `broadcastDrop`:
    // backfill is the path an operator would actually re-run afterwards, and it
    // is the one that *chooses* which drops to offer. Handing a known drop
    // straight to `broadcastDrop` would only re-prove ADR-0002's claim, which
    // holds whether or not this backfill ran.
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Meridian', ['https://yema.example/products/meridian']);
    const drop = await arrangeDrop(brand.id, {
      sourceUrl: 'https://yema.example/products/meridian',
      broadcast: true,
    });

    await backfill.backfill({ confirm: true });
    const offered = await alerts.backfill({ confirm: true, limit: 100 });

    expect(offered.candidates.map((c) => c.dropId)).not.toContain(drop.id);
    expect(telegram.sent.map((s) => s.text).join('\n')).not.toContain('Meridian');
    // And the direct path is still closed too, by the claim.
    const direct = await alerts.broadcastDrop(drop.id);
    expect(direct.sentCount).toBe(0);
  });

  it('leaves a drop alone when nothing identifies its watch', async () => {
    // An RSS-sourced drop names a watch in prose and has no store product. A
    // guess from the title would put an announcement on the wrong page.
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Superman Bronze', [
      'https://yema.example/products/known',
    ]);
    const rss = await arrangeDrop(brand.id, {
      sourceUrl: null,
      title: 'Superman Bronze',
    });
    const gone = await arrangeDrop(brand.id, {
      sourceUrl: 'https://yema.example/products/delisted',
    });

    const result = await backfill.backfill({ confirm: true });

    expect(result.unresolved).toBeGreaterThanOrEqual(2);
    for (const id of [rss.id, gone.id]) {
      const reloaded = await prisma.drop.findUniqueOrThrow({ where: { id } });
      expect(reloaded.watchId).toBeNull();
    }
  });

  it('refuses to hand a drop to another brand’s watch', async () => {
    // Only reachable if the two disagree about who sells a URL, but a wrong
    // watch_id is silent and puts an announcement on a stranger's page.
    const owner = await arrangeBrand();
    const other = await arrangeBrand();
    const url = 'https://yema.example/products/contested';
    await arrangeWatch(owner.id, 'Contested', [url]);
    const drop = await arrangeDrop(other.id, { sourceUrl: url });

    await backfill.backfill({ confirm: true });

    const reloaded = await prisma.drop.findUniqueOrThrow({ where: { id: drop.id } });
    expect(reloaded.watchId).toBeNull();
  });

  it('does nothing the second time it is run', async () => {
    const brand = await arrangeBrand();
    await arrangeWatch(brand.id, 'Repeat', ['https://yema.example/products/repeat']);
    await arrangeDrop(brand.id, { sourceUrl: 'https://yema.example/products/repeat' });

    const first = await backfill.backfill({ confirm: true });
    const second = await backfill.backfill({ confirm: true });

    expect(first.assigned).toBeGreaterThanOrEqual(1);
    expect(second.assignments.map((a) => a.sourceUrl)).not.toContain(
      'https://yema.example/products/repeat',
    );
  });
});
