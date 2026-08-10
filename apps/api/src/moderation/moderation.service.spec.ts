/**
 * Approving a drop is a human saying "this is real, make it public" — the moment
 * it should reach people's phones.
 *
 * The real service and a real database; only Telegram is replaced, via the
 * capturing double. Assertions are on the messages a follower would receive.
 */
import { ConfigService } from '@nestjs/config';
import { DropType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from './moderation.service';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';

function configure(
  over: { botToken?: string | undefined; channels?: Record<string, string> } = {},
) {
  return new ConfigService({
    digest: { publicWebUrl: 'https://crownswatch.org' },
    telegram: {
      botToken: 'botToken' in over ? over.botToken : 'test-token',
      channels:
        over.channels ?? { uk: UK_CHANNEL, en: EN_CHANNEL },
      // No pause between drops in tests; the pacing itself is asserted
      // separately by counting what arrived, not by waiting for it.
      dispatchGapMs: 0,
    },
  });
}

describe('ModerationService', () => {
  let prisma: PrismaService;
  let telegram: CapturingTelegram;
  let alerts: AlertDispatchService;
  let service: ModerationService;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    telegram = new CapturingTelegram();
    alerts = new AlertDispatchService(prisma, configure(), telegram);
    service = new ModerationService(prisma, alerts);
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  /** A drop sitting in the moderation queue, as extraction would have left it. */
  async function arrangePending(over: { title?: string } = {}) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Mandetbrote ${tag}`, slug: `mandetbrote-${tag}` },
    });
    brandIds.push(brand.id);
    const drop = await prisma.drop.create({
      data: {
        brandId: brand.id,
        title: over.title ?? 'Secret Orbital II',
        type: DropType.pre_order,
        priceLow: 1450,
        currency: 'EUR',
        imageUrl: 'https://cdn.example/orbital.jpg',
        sourceUrl: 'https://wornandwound.com/mandetbrote-secret-orbital-ii/',
        moderationStatus: 'pending',
      },
    });
    return { drop, brand };
  }

  const broadcastsFor = (dropId: string) =>
    prisma.dropBroadcast.findMany({ where: { dropId } });

  describe('what the queue tells a reviewer', () => {
    it('says why a Drop that would have published is waiting', async () => {
      // A Tier 4 Drop demoted for a dead link needs its *link* checked before
      // approval, not its prose — and the reviewer cannot know that unless the
      // queue says so (ADR-0007).
      const { drop } = await arrangePending({ title: 'Held Diver' });
      await prisma.drop.update({
        where: { id: drop.id },
        data: { heldReason: 'The store does not serve https://brand.example/products/held' },
      });

      const { drops } = await service.queue(200);
      const held = drops.find((d) => d.id === drop.id);

      expect(held?.heldReason).toContain('/products/held');
    });

    it('leaves it null for a Drop that is simply awaiting review', async () => {
      // An extracted Drop is pending because that is where extracted Drops
      // start. That is not a reason, and inventing one would make the field
      // meaningless the day it was added.
      const { drop } = await arrangePending({ title: 'Ordinary Candidate' });

      const { drops } = await service.queue(200);

      expect(drops.find((d) => d.id === drop.id)?.heldReason).toBeNull();
    });
  });

  it('announces an approved drop to both channels', async () => {
    const { drop, brand } = await arrangePending();

    await service.approve(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(2);
    expect(telegram.sent.map((s) => s.chatId).sort()).toEqual(
      [EN_CHANNEL, UK_CHANNEL].sort(),
    );
    for (const message of telegram.sent) {
      expect(message.text).toContain(brand.name);
      expect(message.text).toContain('Secret Orbital II');
      expect(message.text).toContain('1450 EUR');
      // Same template as a detected drop, photo included.
      expect(message.imageUrl).toBe('https://cdn.example/orbital.jpg');
    }
  });

  it('labels an extracted drop as coverage, never as somewhere to buy', async () => {
    // Its source link is the article it was extracted from.
    const { drop } = await arrangePending();

    await service.approve(drop.id);
    await alerts.whenIdle();

    const en = telegram.sent.find((s) => s.chatId === EN_CHANNEL)!;
    expect(en.text).toContain('Read the coverage');
    expect(en.text).not.toContain('Buy from');
  });

  it('announces nothing when a drop is rejected', async () => {
    const { drop } = await arrangePending();

    await service.reject(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(0);
    expect(await broadcastsFor(drop.id)).toHaveLength(0);
  });

  it('does not announce a drop twice when it is approved again', async () => {
    const { drop } = await arrangePending();
    await service.approve(drop.id);
    await alerts.whenIdle();

    await service.approve(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(2);
    expect(await broadcastsFor(drop.id)).toHaveLength(2);
  });

  it('does not re-announce a drop the watcher already posted', async () => {
    const { drop } = await arrangePending();
    // The live path got there first.
    await alerts.broadcastDrop(drop.id);
    expect(telegram.sent).toHaveLength(2);

    await service.approve(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(2);
  });

  it('approves the drop even when every channel is down', async () => {
    // Publishing must not depend on Telegram being reachable.
    const { drop } = await arrangePending();
    telegram.broken.add(UK_CHANNEL);
    telegram.broken.add(EN_CHANNEL);

    const result = await service.approve(drop.id);
    await alerts.whenIdle();

    expect(result.moderationStatus).toBe('approved');
    expect(result.publishedAt).not.toBeNull();
    const rows = await broadcastsFor(drop.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
  });

  it('approves normally when the bot token is not configured', async () => {
    const { drop } = await arrangePending();
    const dispatcher = new AlertDispatchService(
      prisma,
      configure({ botToken: undefined }),
      telegram,
    );
    const unconfigured = new ModerationService(prisma, dispatcher);

    const result = await unconfigured.approve(drop.id);
    await dispatcher.whenIdle();

    expect(result.moderationStatus).toBe('approved');
    expect(result.publishedAt).not.toBeNull();
    expect(telegram.sent).toHaveLength(0);
    // Nothing was claimed, so configuring the token later still delivers.
    expect(await broadcastsFor(drop.id)).toHaveLength(0);
  });

  it('approves normally when no channels are configured', async () => {
    const { drop } = await arrangePending();
    const dispatcher = new AlertDispatchService(
      prisma,
      configure({ channels: {} }),
      telegram,
    );
    const unconfigured = new ModerationService(prisma, dispatcher);

    const result = await unconfigured.approve(drop.id);
    await dispatcher.whenIdle();

    expect(result.moderationStatus).toBe('approved');
    expect(telegram.sent).toHaveLength(0);
    expect(await broadcastsFor(drop.id)).toHaveLength(0);
  });

  it('finishes announcing what is queued when the process shuts down', async () => {
    // A deploy landing mid-review must not discard the announcements.
    const { drop } = await arrangePending();

    await service.approve(drop.id);
    expect(telegram.sent).toHaveLength(0);
    await alerts.onApplicationShutdown();

    expect(telegram.sent).toHaveLength(2);
  });

  it('returns without waiting for Telegram', async () => {
    // A moderator clicking approve must not wait on a third party. If dispatch
    // were inline, the send would already have happened by the time approve
    // resolves.
    const { drop } = await arrangePending();

    await service.approve(drop.id);

    expect(telegram.sent).toHaveLength(0);
    await alerts.whenIdle();
    expect(telegram.sent).toHaveLength(2);
  });

  it('loses nothing when a queue of drops is approved in quick succession', async () => {
    // Clearing a backlog is the realistic case, and Telegram throttles bursts
    // per channel. Every approved drop must still be announced exactly once.
    const drops: Array<{ id: string }> = [];
    for (let i = 0; i < 6; i += 1) {
      drops.push((await arrangePending({ title: `Orbital ${i}` })).drop);
    }

    for (const drop of drops) await service.approve(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(12);
    for (const drop of drops) {
      const rows = await broadcastsFor(drop.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'sent')).toBe(true);
    }
  });

  it('sends one drop at a time rather than all at once', async () => {
    // The pacing that keeps a burst under the channel rate limit only works if
    // dispatch is serialised — parallel sends would defeat any gap between them.
    const drops: Array<{ id: string }> = [];
    for (let i = 0; i < 4; i += 1) {
      drops.push((await arrangePending({ title: `Serial ${i}` })).drop);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    telegram.onSend = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield, so overlapping sends would actually be observed as overlapping.
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
    };

    for (const drop of drops) await service.approve(drop.id);
    await alerts.whenIdle();

    expect(telegram.sent).toHaveLength(8);
    expect(maxInFlight).toBe(1);
  });
});
