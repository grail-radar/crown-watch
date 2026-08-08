/**
 * Deleting the posts belonging to retracted drops.
 *
 * Real service, real database, Telegram replaced at the client seam. The
 * assertions are on which posts Telegram was asked to remove and on what
 * survives in `drop_broadcasts` — those rows are the at-most-once guarantee
 * (ADR-0002), and a purge that took them with it would re-arm a re-broadcast.
 */
import { DropType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastPurgeService } from './broadcast-purge.service';

const UK = '@crownwatch_ua';
const EN = '@crownwatch_en';

describe('BroadcastPurgeService', () => {
  let prisma: PrismaService;
  let telegram: CapturingTelegram;
  let purge: BroadcastPurgeService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    telegram = new CapturingTelegram();
    purge = new BroadcastPurgeService(prisma, telegram);
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /**
   * A drop with posts in both channels. `retracted` gives it the state #40
   * leaves behind; without it the drop is still live.
   */
  async function arrangeBroadcastDrop(
    over: { retracted?: boolean; messageIds?: [string, string]; sentAt?: Date } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `YEMA ${tag}`, slug: `yema-${tag}` },
    });
    brandIds.push(brand.id);

    const drop = await prisma.drop.create({
      data: {
        brandId: brand.id,
        title: `Superman ${tag}`,
        type: DropType.pre_order,
        moderationStatus: over.retracted ? 'rejected' : 'approved',
        publishedAt: over.retracted ? null : new Date(),
      },
    });

    const [uk, en] = over.messageIds ?? [`${Date.now()}1`, `${Date.now()}2`];
    await prisma.dropBroadcast.createMany({
      data: [
        { dropId: drop.id, chatId: UK, locale: 'uk', status: 'sent', messageId: uk, sentAt: over.sentAt ?? new Date() },
        { dropId: drop.id, chatId: EN, locale: 'en', status: 'sent', messageId: en, sentAt: over.sentAt ?? new Date() },
      ],
    });
    return { drop, brand, uk, en };
  }

  it('reports what it would delete without touching Telegram', async () => {
    const { uk } = await arrangeBroadcastDrop({ retracted: true });

    const result = await purge.purge();

    expect(result.dryRun).toBe(true);
    expect(result.posts).toBeGreaterThanOrEqual(2);
    expect(result.channels.map((c) => c.chatId).sort()).toEqual([EN, UK].sort());
    expect(telegram.deleted).toEqual([]);
    expect(telegram.deletedIds).not.toContain(uk);
  });

  it('deletes the posts of a retracted drop once confirmed', async () => {
    const { uk, en } = await arrangeBroadcastDrop({ retracted: true });

    await purge.purge({ confirm: true });

    expect(telegram.deletedIds).toContain(uk);
    expect(telegram.deletedIds).toContain(en);
  });

  it('never touches a post whose drop is still live', async () => {
    // The whole risk of a bulk delete: taking the legitimate history with it.
    const live = await arrangeBroadcastDrop({ retracted: false });

    await purge.purge({ confirm: true });

    expect(telegram.deletedIds).not.toContain(live.uk);
    expect(telegram.deletedIds).not.toContain(live.en);
  });

  it('leaves the broadcast records intact, so nothing can be re-announced', async () => {
    // The load-bearing one. These rows are the at-most-once evidence.
    const { drop } = await arrangeBroadcastDrop({ retracted: true });

    await purge.purge({ confirm: true });

    const rows = await prisma.dropBroadcast.findMany({ where: { dropId: drop.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    expect(rows.every((r) => r.messageId !== null)).toBe(true);
  });

  it('is safe to run twice', async () => {
    // Telegram skips ids it cannot find, and the rows stay, so a second run
    // asks again and changes nothing. An operator who is unsure should be able
    // to just re-run it.
    const { uk } = await arrangeBroadcastDrop({ retracted: true });

    await purge.purge({ confirm: true });
    const second = await purge.purge({ confirm: true });

    expect(second.failed).toBe(0);
    expect(telegram.deletedIds.filter((id) => id === uk)).toHaveLength(2);
  });

  it('asks Telegram in batches it will accept', async () => {
    // deleteMessages takes at most 100 ids; 250 posts must become three calls
    // per channel, not one that Telegram rejects outright.
    const brand = await prisma.brand.create({
      data: { name: `Bulk ${randomUUID().slice(0, 8)}`, slug: `bulk-${randomUUID().slice(0, 8)}` },
    });
    brandIds.push(brand.id);
    for (let i = 0; i < 120; i += 1) {
      const drop = await prisma.drop.create({
        data: {
          brandId: brand.id,
          title: `Bulk ${i}`,
          type: DropType.pre_order,
          moderationStatus: 'rejected',
          publishedAt: null,
        },
      });
      await prisma.dropBroadcast.create({
        data: { dropId: drop.id, chatId: UK, locale: 'uk', status: 'sent', messageId: `bulk-${i}`, sentAt: new Date() },
      });
    }

    await purge.purge({ confirm: true });

    const ukBatches = telegram.deleted.filter((d) => d.chatId === UK);
    expect(ukBatches.every((b) => b.messageIds.length <= 100)).toBe(true);
    expect(ukBatches.length).toBeGreaterThan(1);
  });

  it('does not let one undeletable post take the rest of its batch with it', async () => {
    // What happened in production. Test runs had written broadcast rows whose
    // message ids came from a capturing double — 1, 2, 3 — which are not real
    // posts. Telegram refuses the whole call when it finds an id it will not
    // delete, so one fake id cost 99 genuine posts their deletion.
    const bad = await arrangeBroadcastDrop({
      retracted: true,
      messageIds: ['1', '2'],
    });
    const good = await arrangeBroadcastDrop({ retracted: true });
    telegram.undeletableIds.add('1');
    telegram.undeletableIds.add('2');

    const result = await purge.purge({ confirm: true });

    // The real posts still go.
    expect(telegram.deletedIds).toContain(good.uk);
    expect(telegram.deletedIds).toContain(good.en);
    // And the impossible ones are reported rather than silently swallowed.
    const uk = result.channels.find((c) => c.chatId === UK)!;
    expect(uk.failed).toBe(1);
    expect(uk.failedIds).toContain(bad.uk);
    expect(uk.error).toMatch(/can't be deleted/);
  });

  it('reports a channel it could not delete from instead of failing the run', async () => {
    // One channel refusing must not leave the other untouched — and 48 hours
    // after the fact, every channel will refuse.
    await arrangeBroadcastDrop({ retracted: true });
    telegram.undeletable.add(UK);

    const result = await purge.purge({ confirm: true });

    const uk = result.channels.find((c) => c.chatId === UK)!;
    const en = result.channels.find((c) => c.chatId === EN)!;
    expect(uk.failed).toBeGreaterThan(0);
    expect(uk.error).toMatch(/cannot delete/);
    expect(en.deleted).toBeGreaterThan(0);
    expect(result.failed).toBeGreaterThan(0);
  });

  it('can be narrowed to the window a mistake happened in', async () => {
    const old = await arrangeBroadcastDrop({
      retracted: true,
      sentAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const recent = await arrangeBroadcastDrop({ retracted: true });

    await purge.purge({
      confirm: true,
      since: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(telegram.deletedIds).toContain(recent.uk);
    expect(telegram.deletedIds).not.toContain(old.uk);
  });
});
