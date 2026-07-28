/**
 * Dispatch tests.
 *
 * The real service and a real database; only Telegram is replaced, via the
 * TelegramClient seam. Assertions are on the messages the channels would have
 * received — no network is touched.
 */
import { ConfigService } from '@nestjs/config';
import { DropType, SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CapturingTelegram } from '../../test/capturing-telegram';
import { PrismaService } from '../prisma/prisma.service';
import {
  AlertDispatchService,
  BackfillCandidate,
  BackfillResult,
} from './alert-dispatch.service';

const UK_CHANNEL = '@crownwatch_ua';
const EN_CHANNEL = '@crownwatch_en';
const WEB = 'https://crownswatch.org';

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
  const sourceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    telegram = new CapturingTelegram();
  });

  afterAll(async () => {
    await prisma.drop.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.rawIngestionEvent.deleteMany({
      where: { sourceId: { in: sourceIds } },
    });
    await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  const dispatcher = (config = configure()) =>
    new AlertDispatchService(prisma, config, telegram);

  /**
   * A published drop. By default it has no provenance, like an RSS-extracted
   * drop; pass `fromStore` to give it the site-watch lineage that makes its
   * sourceUrl a real product page.
   */
  async function arrangeDrop(
    over: {
      title?: string;
      type?: DropType;
      priceLow?: number | null;
      currency?: string | null;
      sourceUrl?: string | null;
      imageUrl?: string | null;
      brandWebsite?: string | null;
      fromStore?: boolean;
    } = {},
  ) {
    const tag = randomUUID().slice(0, 8);
    const brand = await prisma.brand.create({
      data: {
        name: `Lorier ${tag}`,
        slug: `lorier-${tag}`,
        website: over.brandWebsite ?? null,
      },
    });
    brandIds.push(brand.id);

    let sourceEventId: string | undefined;
    if (over.fromStore) {
      const source = await prisma.source.create({
        data: {
          type: SourceType.site_watch,
          name: 'Store',
          endpoint: `https://lorier.com/products.json?s=${tag}`,
          brandId: brand.id,
          watchConfig: { adapter: 'shopify_products_json' },
        },
      });
      sourceIds.push(source.id);
      const event = await prisma.rawIngestionEvent.create({
        data: { sourceId: source.id, rawPayload: [], contentHash: tag, processed: true },
      });
      sourceEventId = event.id;
    }

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
        imageUrl:
          over.imageUrl === undefined
            ? 'https://cdn.example/neptune.jpg'
            : over.imageUrl,
        sourceEventId,
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

  it('never says "buy" over a link to a magazine article', () => {
    // Tier 1 drops carry the publication's article as their sourceUrl. Calling
    // that "Buy from the brand" misleads every follower and misrepresents the
    // publication's coverage (CONTEXT.md §6).
    return (async () => {
      const { drop } = await arrangeDrop({
        sourceUrl: 'https://wornandwound.com/nomos-introduces-new-tetra-27/',
      });

      await dispatcher().broadcastDrop(drop.id);

      expect(telegram.textFor(EN_CHANNEL)).toContain('Read the coverage');
      expect(telegram.textFor(EN_CHANNEL)).not.toContain('Buy from');
      expect(telegram.textFor(UK_CHANNEL)).toContain('Читати огляд');
      // The link itself is still there — only its label changed.
      expect(telegram.textFor(EN_CHANNEL)).toContain('wornandwound.com');
    })();
  });

  it('says "buy" only when the drop came from the brand’s own store', async () => {
    const { drop } = await arrangeDrop({ fromStore: true });

    await dispatcher().broadcastDrop(drop.id);

    expect(telegram.textFor(EN_CHANNEL)).toContain('Buy from the brand');
    expect(telegram.textFor(UK_CHANNEL)).toContain('Купити в бренда');
  });

  it('carries the drop photo through to the channel', async () => {
    const { drop } = await arrangeDrop({
      imageUrl: 'https://cdn.example/baltic-scalegraph.jpg',
    });

    await dispatcher().broadcastDrop(drop.id);

    expect(telegram.sent).toHaveLength(2);
    for (const message of telegram.sent) {
      expect(message.imageUrl).toBe('https://cdn.example/baltic-scalegraph.jpg');
    }
  });

  it('still posts a drop that has no photo', async () => {
    const { drop } = await arrangeDrop({ imageUrl: null });

    const result = await dispatcher().broadcastDrop(drop.id);

    expect(result.sentCount).toBe(2);
    expect(telegram.sent.every((s) => !s.imageUrl)).toBe(true);
  });

  it('offers the brand’s own site when there is no product page', async () => {
    // The common case for an extracted drop: we know the brand's site, but the
    // only link the article gave us is the article.
    const { drop, brand } = await arrangeDrop({
      sourceUrl: 'https://wornandwound.com/nomos-introduces-new-tetra-27/',
      brandWebsite: 'https://lorier.com',
    });

    await dispatcher().broadcastDrop(drop.id);

    const en = telegram.textFor(EN_CHANNEL)!;
    expect(en).toContain('Visit the brand');
    expect(en).toContain('https://lorier.com');
    expect(en).not.toContain('Buy from');
    // The coverage is still there, as its own link.
    expect(en).toContain('Read the coverage');
    expect(en).toContain('wornandwound.com');
    expect(telegram.textFor(UK_CHANNEL)).toContain('Сайт бренда');
    expect(en).toContain(`${WEB}/brands/${brand.slug}`);
  });

  it('prefers the product page over the brand site when it has one', async () => {
    const { drop } = await arrangeDrop({
      fromStore: true,
      brandWebsite: 'https://lorier.com',
    });

    await dispatcher().broadcastDrop(drop.id);

    const en = telegram.textFor(EN_CHANNEL)!;
    expect(en).toContain('Buy from the brand');
    expect(en).toContain('https://lorier.com/products/neptune-iv');
    expect(en).not.toContain('Visit the brand');
    // A store drop's link is the product page — there is no article to cite.
    expect(en).not.toContain('Read the coverage');
  });

  it('offers nothing to click when the brand site is unknown', async () => {
    const { drop } = await arrangeDrop({
      sourceUrl: null,
      brandWebsite: null,
    });

    await dispatcher().broadcastDrop(drop.id);

    const en = telegram.textFor(EN_CHANNEL)!;
    expect(en).not.toContain('Buy from');
    expect(en).not.toContain('Visit the brand');
    expect(en).not.toContain('Read the coverage');
    expect(en).toContain('Neptune IV');
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

  describe('backfill', () => {
    /** Only ever look at the drops this test created. */
    const mine = (result: BackfillResult, ids: string[]): BackfillCandidate[] =>
      result.candidates.filter((c) => ids.includes(c.dropId));

    it('sends nothing unless the caller confirms', async () => {
      const { drop } = await arrangeDrop();

      const result = await dispatcher().backfill({ limit: 50 });

      expect(result.dryRun).toBe(true);
      expect(telegram.sent).toHaveLength(0);
      expect(await broadcastsFor(drop.id)).toHaveLength(0);
      // But it still shows exactly what would go out, in both languages.
      const [candidate] = mine(result, [drop.id]);
      expect(candidate.pendingLocales.sort()).toEqual(['en', 'uk']);
      expect(candidate.messages).toHaveLength(2);
      expect(candidate.messages[0].text).toContain('Neptune IV');
    });

    it('posts the pending drops once confirmed', async () => {
      const { drop } = await arrangeDrop();

      const result = await dispatcher().backfill({
        limit: 50,
        confirm: true,
        delayMs: 0,
      });

      expect(result.dryRun).toBe(false);
      expect(mine(result, [drop.id])).toHaveLength(1);
      const rows = await broadcastsFor(drop.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'sent')).toBe(true);
    });

    it('will not repost a drop the backfill already sent', async () => {
      const { drop } = await arrangeDrop();
      const service = dispatcher();
      await service.backfill({ limit: 50, confirm: true, delayMs: 0 });
      const before = telegram.sent.length;

      const second = await service.backfill({ limit: 50, confirm: true, delayMs: 0 });

      expect(mine(second, [drop.id])).toHaveLength(0);
      expect(telegram.sent).toHaveLength(before);
    });

    it('skips a drop the live path already broadcast', async () => {
      // The whole point of routing backfill through the same claim: a drop
      // announced at detection time must not be announced again later.
      const { drop } = await arrangeDrop();
      const service = dispatcher();
      await service.broadcastDrop(drop.id);

      const result = await service.backfill({ limit: 50, confirm: true, delayMs: 0 });

      expect(mine(result, [drop.id])).toHaveLength(0);
      expect(telegram.sent).toHaveLength(2);
    });

    it('catches a newly added channel up without repeating the others', async () => {
      // The migration case: two channels are current, a third language is
      // added later and must receive the backlog on its own.
      const { drop, brand } = await arrangeDrop();
      await dispatcher().backfill({ limit: 50, confirm: true, delayMs: 0 });
      telegram.sent = [];

      const widened = dispatcher(configure({ uk: '@crownwatch_ua_v2' }));
      const result = await widened.backfill({ limit: 50, confirm: true, delayMs: 0 });

      const [candidate] = mine(result, [drop.id]);
      expect(candidate.pendingLocales).toEqual(['uk']);
      // Only the new channel hears about it. Other tests in this file left
      // their own drops pending, so scope this to the brand created here.
      const ours = telegram.sent.filter((s) => s.text.includes(brand.name));
      expect(ours.map((s) => s.chatId)).toEqual(['@crownwatch_ua_v2']);
    });

    it('never offers a drop that is not published', async () => {
      const { drop } = await arrangeDrop();
      await prisma.drop.update({
        where: { id: drop.id },
        data: { moderationStatus: 'pending', publishedAt: null },
      });

      const result = await dispatcher().backfill({ limit: 50 });

      expect(mine(result, [drop.id])).toHaveLength(0);
    });

    it('works the backlog oldest first, so the channel reads in order', async () => {
      const older = await arrangeDrop({ title: 'Older Watch' });
      const newer = await arrangeDrop({ title: 'Newer Watch' });
      await prisma.drop.update({
        where: { id: older.drop.id },
        data: { publishedAt: new Date('2020-01-01') },
      });
      await prisma.drop.update({
        where: { id: newer.drop.id },
        data: { publishedAt: new Date('2020-06-01') },
      });

      const result = await dispatcher().backfill({ limit: 50 });

      const ours = mine(result, [older.drop.id, newer.drop.id]);
      expect(ours.map((c) => c.title)).toEqual(['Older Watch', 'Newer Watch']);
    });

    it('honours the limit and clamps an absurd one', async () => {
      await arrangeDrop();
      await arrangeDrop();

      const one = await dispatcher().backfill({ limit: 1 });
      expect(one.candidates).toHaveLength(1);
      expect(one.limit).toBe(1);

      const clamped = await dispatcher().backfill({ limit: 100_000 });
      expect(clamped.limit).toBe(50);
    });

    it('skips the backfill entirely when Telegram is not configured', async () => {
      await arrangeDrop();

      const result = await dispatcher(configure({ botToken: undefined }))
        .backfill({ limit: 50, confirm: true });

      expect(result.status).toBe('skipped');
      expect(result.reason).toMatch(/TELEGRAM_BOT_TOKEN/);
      expect(telegram.sent).toHaveLength(0);
    });

    it('keeps going when one drop fails to post', async () => {
      const { drop } = await arrangeDrop();
      telegram.broken.add(UK_CHANNEL);

      const result = await dispatcher().backfill({
        limit: 50,
        confirm: true,
        delayMs: 0,
      });

      expect(result.status).toBe('dispatched');
      const rows = await broadcastsFor(drop.id);
      expect(rows.find((r) => r.locale === 'uk')?.status).toBe('failed');
      expect(rows.find((r) => r.locale === 'en')?.status).toBe('sent');
    });
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
