/**
 * Dispatch tests.
 *
 * The real service and a real database; only Telegram is replaced, via the
 * TelegramClient seam. Assertions are on the messages the channels would have
 * received — no network is touched.
 */
import { ConfigService } from '@nestjs/config';
import { DropType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AlertDispatchService } from './alert-dispatch.service';
import {
  TelegramClient,
  TelegramSendRequest,
  TelegramSendResult,
} from './telegram-client';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';
const WEB = 'https://crownswatch.org';

/** Captures what would have been posted, and can be told to fail a channel. */
class CapturingTelegram extends TelegramClient {
  sent: TelegramSendRequest[] = [];
  /** Channels that should throw instead of accepting a message. */
  broken = new Set<string>();

  async send(request: TelegramSendRequest): Promise<TelegramSendResult> {
    if (this.broken.has(request.chatId)) {
      throw new Error(`channel ${request.chatId} is unavailable`);
    }
    this.sent.push(request);
    return { messageId: String(this.sent.length) };
  }

  textFor(chatId: string): string | undefined {
    return this.sent.find((s) => s.chatId === chatId)?.text;
  }
}

/** Config with both channels wired up, unless the test says otherwise. */
function configure(
  over: {
    botToken?: string | undefined;
    uk?: string | undefined;
    en?: string | undefined;
  } = {},
) {
  return new ConfigService({
    digest: { publicWebUrl: WEB },
    telegram: {
      botToken: 'botToken' in over ? over.botToken : 'test-token',
      channels: {
        uk: 'uk' in over ? over.uk : UK_CHANNEL,
        en: 'en' in over ? over.en : EN_CHANNEL,
      },
    },
  });
}

describe('AlertDispatchService', () => {
  let prisma: PrismaService;
  let telegram: CapturingTelegram;
  const brandIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    telegram = new CapturingTelegram();
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  const dispatcher = (config = configure()) =>
    new AlertDispatchService(prisma, config, telegram);

  /** A published drop, as the site-watch path would have created it. */
  async function arrangeDrop(
    over: {
      title?: string;
      type?: DropType;
      priceLow?: number | null;
      currency?: string | null;
      sourceUrl?: string | null;
    } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: { name: `Lorier ${tag}`, slug: `lorier-${tag}` },
    });
    brandIds.push(brand.id);
    const drop = await prisma.drop.create({
      data: {
        brandId: brand.id,
        title: over.title ?? 'Neptune IV',
        type: over.type ?? DropType.pre_order,
        priceLow: over.priceLow === undefined ? 499 : over.priceLow,
        currency: over.currency === undefined ? 'USD' : over.currency,
        sourceUrl:
          over.sourceUrl === undefined
            ? 'https://lorier.com/products/neptune-iv'
            : over.sourceUrl,
        moderationStatus: 'approved',
        publishedAt: new Date(),
      },
    });
    return { drop, brand };
  }

  const broadcastsFor = (dropId: string) =>
    prisma.dropBroadcast.findMany({ where: { dropId }, orderBy: { locale: 'asc' } });

  it('posts a drop to both the Ukrainian and English channels', async () => {
    const { drop, brand } = await arrangeDrop();

    const result = await dispatcher().broadcastDrop(drop.id);

    expect(result.status).toBe('dispatched');
    expect(result.sentCount).toBe(2);
    expect(result.channels.map((c) => c.outcome)).toEqual(['sent', 'sent']);
    expect(telegram.sent.map((s) => s.chatId).sort()).toEqual(
      [EN_CHANNEL, UK_CHANNEL].sort(),
    );

    // Each message carries every fact the ticket asks for.
    for (const chatId of [UK_CHANNEL, EN_CHANNEL]) {
      const text = telegram.textFor(chatId)!;
      expect(text).toContain(brand.name);
      expect(text).toContain('Neptune IV');
      expect(text).toContain('499 USD');
      expect(text).toContain('https://lorier.com/products/neptune-iv');
      expect(text).toContain(`${WEB}/brands/${brand.slug}`);
    }
    // …in its own language.
    expect(telegram.textFor(UK_CHANNEL)).toContain('Новий реліз');
    expect(telegram.textFor(EN_CHANNEL)).toContain('New release');
  });

  it('says "back in stock" for a restock', async () => {
    const { drop } = await arrangeDrop({ type: DropType.restock });

    await dispatcher().broadcastDrop(drop.id);

    expect(telegram.textFor(EN_CHANNEL)).toContain('Back in stock');
    expect(telegram.textFor(UK_CHANNEL)).toContain('Знову в наявності');
  });

  it('leaves the price out when the store never gave one', async () => {
    const { drop } = await arrangeDrop({ priceLow: null, currency: null });

    await dispatcher().broadcastDrop(drop.id);

    expect(telegram.textFor(EN_CHANNEL)).not.toContain('Price');
    expect(telegram.textFor(EN_CHANNEL)).toContain('Neptune IV');
  });

  it('never posts the same drop to a channel twice', async () => {
    const { drop } = await arrangeDrop();
    const service = dispatcher();

    await service.broadcastDrop(drop.id);
    const second = await service.broadcastDrop(drop.id);

    expect(second.channels.map((c) => c.outcome)).toEqual(['skipped', 'skipped']);
    expect(second.channels[0].reason).toBe('already broadcast');
    // Two messages in total, not four.
    expect(telegram.sent).toHaveLength(2);
    expect(await broadcastsFor(drop.id)).toHaveLength(2);
  });

  it('stays silent on a re-run by a fresh process, as after a restart', async () => {
    // The dedup guard has to live in the database, not in the service's memory:
    // a redeploy mid-run must not replay the drop to a channel.
    const { drop } = await arrangeDrop();

    await dispatcher().broadcastDrop(drop.id);

    // A brand new service instance — nothing carried over but the database.
    const afterRestart = new AlertDispatchService(prisma, configure(), telegram);
    const result = await afterRestart.broadcastDrop(drop.id);

    expect(result.channels.every((c) => c.outcome === 'skipped')).toBe(true);
    expect(telegram.sent).toHaveLength(2);
  });

  it('does not repeat a drop when two runs overlap', async () => {
    // Overlapping polls are the normal case once this runs on a schedule.
    const { drop } = await arrangeDrop();

    const [first, second] = await Promise.all([
      dispatcher().broadcastDrop(drop.id),
      dispatcher().broadcastDrop(drop.id),
    ]);

    const outcomes = [...first.channels, ...second.channels].map((c) => c.outcome);
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(2);
    expect(outcomes.filter((o) => o === 'skipped')).toHaveLength(2);
    expect(telegram.sent).toHaveLength(2);
  });

  it('delivers to the healthy channel when the other one is down', async () => {
    const { drop } = await arrangeDrop();
    telegram.broken.add(UK_CHANNEL);

    const result = await dispatcher().broadcastDrop(drop.id);

    const uk = result.channels.find((c) => c.locale === 'uk')!;
    const en = result.channels.find((c) => c.locale === 'en')!;
    expect(uk.outcome).toBe('failed');
    expect(uk.reason).toContain('unavailable');
    expect(en.outcome).toBe('sent');
    expect(telegram.sent.map((s) => s.chatId)).toEqual([EN_CHANNEL]);

    // The failure is recorded rather than thrown away.
    const rows = await broadcastsFor(drop.id);
    expect(rows.find((r) => r.locale === 'uk')?.status).toBe('failed');
    expect(rows.find((r) => r.locale === 'en')?.status).toBe('sent');
  });

  it('does not retry a channel that failed, because a repeat is worse', async () => {
    // We cannot tell a message that never arrived from one that arrived just
    // before the connection dropped, so a failed send stays failed.
    const { drop } = await arrangeDrop();
    telegram.broken.add(UK_CHANNEL);
    await dispatcher().broadcastDrop(drop.id);

    telegram.broken.clear();
    const result = await dispatcher().broadcastDrop(drop.id);

    expect(result.channels.every((c) => c.outcome === 'skipped')).toBe(true);
    expect(telegram.sent.map((s) => s.chatId)).toEqual([EN_CHANNEL]);
  });

  it('re-broadcasts when a locale is pointed at a different channel', async () => {
    // Swapping a test channel for the real one — or fixing a typo'd id — is a
    // channel that has genuinely never seen this drop.
    const { drop } = await arrangeDrop();
    await dispatcher().broadcastDrop(drop.id);

    const moved = dispatcher(configure({ uk: '@crownwatch_ua_v2' }));
    const result = await moved.broadcastDrop(drop.id);

    expect(result.channels.find((c) => c.locale === 'uk')?.outcome).toBe('sent');
    expect(result.channels.find((c) => c.locale === 'en')?.outcome).toBe('skipped');
    expect(telegram.sent.map((s) => s.chatId)).toContain('@crownwatch_ua_v2');
  });

  it('skips dispatch with a warning when the bot token is absent', async () => {
    const { drop } = await arrangeDrop();

    const result = await dispatcher(configure({ botToken: undefined }))
      .broadcastDrop(drop.id);

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(result.channels).toHaveLength(0);
    expect(telegram.sent).toHaveLength(0);
    // Nothing was claimed, so configuring the token later still delivers.
    expect(await broadcastsFor(drop.id)).toHaveLength(0);
  });

  it('skips dispatch when no channels are configured', async () => {
    const { drop } = await arrangeDrop();

    const result = await dispatcher(configure({ uk: undefined, en: undefined }))
      .broadcastDrop(drop.id);

    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/channels/i);
    expect(telegram.sent).toHaveLength(0);
  });

  it('posts to the one channel that is configured', async () => {
    const { drop } = await arrangeDrop();

    const result = await dispatcher(configure({ uk: undefined }))
      .broadcastDrop(drop.id);

    expect(result.channels.map((c) => c.locale)).toEqual(['en']);
    expect(telegram.sent.map((s) => s.chatId)).toEqual([EN_CHANNEL]);
  });

  it('reports a missing drop as an error, not a skip, and does not throw', async () => {
    // An unconfigured bot is a supported state; a drop that vanished is a
    // fault. An operator reading a poll report has to be able to tell them
    // apart, so they are different statuses.
    const result = await dispatcher().broadcastDrop('does-not-exist');

    expect(result.status).toBe('error');
    expect(result.reason).toMatch(/not found/);
    expect(telegram.sent).toHaveLength(0);
  });

  it('keeps Telegram’s message id for provenance', async () => {
    const { drop } = await arrangeDrop();

    await dispatcher().broadcastDrop(drop.id);

    const rows = await broadcastsFor(drop.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.messageId !== null)).toBe(true);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });
});
