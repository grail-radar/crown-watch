/**
 * Deleting a `drop_broadcasts` row — the one operation ADR-0002 exists to
 * forbid, permitted in exactly one case.
 *
 * A claim row is the record that a Drop reached a Channel, and removing one
 * makes that Drop a candidate again. That is why `BroadcastPurgeService` keeps
 * every row even when it deletes the post. The exception is a claim against a
 * Channel that never existed: `@crownwatch_ua_v2` lives only in a spec, it took
 * 30 claims on 2026-08-07 when the tests ran against production, no message was
 * ever sent to it, and `purge:broadcasts` fails on those rows for ever (#48).
 *
 * So the tests here are mostly about what it refuses to do.
 */
import { ConfigService } from '@nestjs/config';
import { DropType, ModerationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AlertDispatchService } from './alert-dispatch.service';
import { BroadcastClaimSweepService } from './broadcast-claim-sweep.service';
import { CapturingTelegram } from '../../test/capturing-telegram';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';
const GHOST = '@crownwatch_ua_v2';

describe('BroadcastClaimSweepService', () => {
  let prisma: PrismaService;
  let sweep: BroadcastClaimSweepService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const config = new ConfigService({
      digest: { publicWebUrl: 'https://crownswatch.org' },
      telegram: {
        botToken: 'test-token',
        channels: { uk: UK_CHANNEL, en: EN_CHANNEL },
      },
    });
    sweep = new BroadcastClaimSweepService(
      prisma,
      new AlertDispatchService(prisma, config, new CapturingTelegram()),
    );
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /** A published Drop with a claim against each of `chatIds`. */
  async function arrangeClaims(chatIds: string[]) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Serica ${tag}`, slug: `serica-${tag}` },
    });
    brandIds.push(brand.id);
    const drop = await prisma.drop.create({
      data: {
        brandId: brand.id,
        title: `Scalegraph ${tag}`,
        type: DropType.restock,
        moderationStatus: ModerationStatus.approved,
        publishedAt: new Date('2026-08-07T12:40:00.000Z'),
      },
    });
    for (const [i, chatId] of chatIds.entries()) {
      await prisma.dropBroadcast.create({
        data: {
          dropId: drop.id,
          chatId,
          locale: 'uk',
          status: 'sent',
          messageId: String(i + 1),
          sentAt: new Date('2026-08-07T12:40:00.000Z'),
        },
      });
    }
    return { brand, drop };
  }

  const claimsFor = (chatId: string, dropId: string) =>
    prisma.dropBroadcast.count({ where: { chatId, dropId } });

  describe('the dry run', () => {
    it('reports what it would delete and deletes nothing', async () => {
      const { drop } = await arrangeClaims([GHOST, UK_CHANNEL]);

      const report = await sweep.sweep({ chatIds: [GHOST] });

      expect(report.confirmed).toBe(false);
      expect(report.deleted).toBe(0);
      const ghost = report.channels.find((c) => c.chatId === GHOST);
      expect(ghost?.claims).toBeGreaterThanOrEqual(1);
      expect(await claimsFor(GHOST, drop.id)).toBe(1);
    });

    it('names the Drops the claims belong to, so they can be looked at', async () => {
      const { drop } = await arrangeClaims([GHOST]);

      const report = await sweep.sweep({ chatIds: [GHOST] });

      const titles = report.channels
        .find((c) => c.chatId === GHOST)
        ?.sample.map((s) => s.title);
      expect(titles).toContain(drop.title);
    });
  });

  describe('applying it', () => {
    it('deletes the claims against the Channel that never existed', async () => {
      const { drop } = await arrangeClaims([GHOST]);

      const report = await sweep.sweep({ chatIds: [GHOST], confirm: true });

      expect(report.confirmed).toBe(true);
      expect(report.deleted).toBeGreaterThanOrEqual(1);
      expect(await claimsFor(GHOST, drop.id)).toBe(0);
    });

    it('leaves every claim against a real Channel alone', async () => {
      const { drop } = await arrangeClaims([GHOST, UK_CHANNEL, EN_CHANNEL]);

      await sweep.sweep({ chatIds: [GHOST], confirm: true });

      expect(await claimsFor(GHOST, drop.id)).toBe(0);
      expect(await claimsFor(UK_CHANNEL, drop.id)).toBe(1);
      expect(await claimsFor(EN_CHANNEL, drop.id)).toBe(1);
    });

    it('removes no Drop, Brand or Source', async () => {
      // The ticket's own criterion: counts before and after, so a sweep that
      // reached further than its own table is visible rather than assumed.
      const { drop, brand } = await arrangeClaims([GHOST]);

      const report = await sweep.sweep({ chatIds: [GHOST], confirm: true });

      expect(report.counts.after.drops).toBe(report.counts.before.drops);
      expect(report.counts.after.brands).toBe(report.counts.before.brands);
      expect(report.counts.after.sources).toBe(report.counts.before.sources);
      expect(await prisma.drop.findUnique({ where: { id: drop.id } })).not.toBeNull();
      expect(await prisma.brand.findUnique({ where: { id: brand.id } })).not.toBeNull();
    });

    it('is safe to run twice', async () => {
      await arrangeClaims([GHOST]);

      await sweep.sweep({ chatIds: [GHOST], confirm: true });
      const again = await sweep.sweep({ chatIds: [GHOST], confirm: true });

      expect(again.deleted).toBe(0);
    });
  });

  describe('what it refuses', () => {
    it('will not touch a Channel we actually post to', async () => {
      // The whole hazard. Deleting a live Channel's claims would make every one
      // of those Drops a candidate again, and followers would be told twice
      // about releases they already saw (ADR-0002).
      const { drop } = await arrangeClaims([UK_CHANNEL]);

      const report = await sweep.sweep({ chatIds: [UK_CHANNEL], confirm: true });

      expect(report.refused.map((r) => r.chatId)).toContain(UK_CHANNEL);
      expect(report.deleted).toBe(0);
      expect(await claimsFor(UK_CHANNEL, drop.id)).toBe(1);
    });

    it('refuses the whole run rather than the offending chat alone', async () => {
      // All or nothing: an operator who mistyped one of two chat ids should get
      // an error, not a half-applied sweep they have to reason about.
      const { drop } = await arrangeClaims([GHOST, UK_CHANNEL]);

      const report = await sweep.sweep({
        chatIds: [GHOST, UK_CHANNEL],
        confirm: true,
      });

      expect(report.deleted).toBe(0);
      expect(await claimsFor(GHOST, drop.id)).toBe(1);
      expect(await claimsFor(UK_CHANNEL, drop.id)).toBe(1);
    });

    it('refuses an empty list rather than treating it as "everything"', async () => {
      const { drop } = await arrangeClaims([GHOST]);

      await expect(sweep.sweep({ chatIds: [], confirm: true })).rejects.toThrow(
        /at least one/i,
      );
      expect(await claimsFor(GHOST, drop.id)).toBe(1);
    });

    it('reports a chat id that matches nothing, rather than passing silently', async () => {
      // A typo should look like a typo. Zero claims and no error reads as "done".
      const report = await sweep.sweep({ chatIds: ['@nobody_here'] });

      const entry = report.channels.find((c) => c.chatId === '@nobody_here');
      expect(entry?.claims).toBe(0);
      expect(report.unmatched).toContain('@nobody_here');
    });
  });
});
