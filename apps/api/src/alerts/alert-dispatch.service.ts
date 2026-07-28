import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BroadcastStatus,
  ModerationStatus,
  Prisma,
  SourceType,
} from '@prisma/client';
import { purchaseLinkFor } from '../drops/purchase-link';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALERT_LOCALES,
  AlertLocale,
  DropAlert,
  renderDropAlert,
} from './messages';
import { TelegramClient } from './telegram-client';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/** Everything a message is built from — one definition, both entry points. */
const DROP_FIELDS = {
  id: true,
  title: true,
  type: true,
  priceLow: true,
  currency: true,
  sourceUrl: true,
  imageUrl: true,
  publishedAt: true,
  brand: { select: { name: true, slug: true, website: true } },
  // Decides what the link is called: a site-watch drop's sourceUrl is the
  // brand's own product page, everything else is a publication's article.
  sourceEvent: { select: { source: { select: { type: true } } } },
} as const;

type DropRecord = Prisma.DropGetPayload<{ select: typeof DROP_FIELDS }>;

/**
 * Backfill defaults. Deliberately small: a backfill posts to public channels,
 * so the damage from getting it wrong scales with how many it sends at once.
 * Run it repeatedly to work through a backlog rather than raising the cap.
 */
const DEFAULT_BACKFILL_LIMIT = 10;
const MAX_BACKFILL_LIMIT = 50;

/**
 * Gap between queued drops. Telegram throttles bursts to a channel at roughly
 * twenty messages a minute, and each drop is one message per channel.
 */
const DEFAULT_DISPATCH_GAP_MS = 3000;

export type BroadcastOutcome = 'sent' | 'skipped' | 'failed';

/** One configured destination: a language and the channel it posts to. */
export interface BroadcastChannel {
  locale: AlertLocale;
  chatId: string;
}

/** Everything one drop contributes to a post, shared across its channels. */
interface BroadcastPayload {
  alert: DropAlert;
  imageUrl: string | null;
  webUrl: string;
}

export interface ChannelBroadcastResult extends BroadcastChannel {
  outcome: BroadcastOutcome;
  /** Why a broadcast was skipped or failed — absent when it was sent. */
  reason?: string;
}

/**
 * `dispatched` — channels were attempted; see `channels` for what each did.
 * `skipped`    — nothing was attempted because dispatch is not configured.
 * `error`      — nothing was attempted because something went wrong first.
 *
 * The last two are kept apart deliberately: an unconfigured bot is a supported
 * state, a failed lookup is a fault, and an operator reading a poll report
 * needs to tell them apart.
 */
export type DispatchStatus = 'dispatched' | 'skipped' | 'error';

export interface DropBroadcastResult {
  dropId: string;
  status: DispatchStatus;
  reason?: string;
  /** Channels that actually received the message. */
  sentCount: number;
  channels: ChannelBroadcastResult[];
}

export interface BackfillOptions {
  /** How many drops to work through. Clamped to MAX_BACKFILL_LIMIT. */
  limit?: number;
  /**
   * Actually post. Omitted or false = a dry run that renders every message and
   * sends nothing. Opt-in rather than opt-out: unlike a single drop alert, a
   * backfill's blast radius is the whole backlog, and a channel cannot unsend.
   */
  confirm?: boolean;
  /** Pause between drops, keeping under Telegram's per-channel rate limit. */
  delayMs?: number;
}

/** One drop the backfill would post, and where it has not yet been seen. */
export interface BackfillCandidate {
  dropId: string;
  brandName: string;
  title: string;
  publishedAt: string | null;
  pendingLocales: AlertLocale[];
  /** The exact messages, so a dry run can be read before anything is sent. */
  messages: Array<{ locale: AlertLocale; chatId: string; text: string }>;
}

export interface BackfillResult {
  status: DispatchStatus;
  reason?: string;
  /** true when nothing was sent because `confirm` was not passed. */
  dryRun: boolean;
  limit: number;
  candidateCount: number;
  sentCount: number;
  candidates: BackfillCandidate[];
}

/**
 * Broadcasts published drops to the public Telegram channels — one per
 * language.
 *
 * Three rules shape this service:
 *
 *  - **Once only.** A `drop_broadcasts` row is claimed *before* the send, so a
 *    duplicate attempt loses the race on the unique index and stops. A channel
 *    that repeats itself gets muted, so at-most-once beats at-least-once here:
 *    a crash between claiming and sending loses that one message rather than
 *    risking a repeat.
 *  - **Never fails the caller.** Ingestion succeeding must not depend on
 *    Telegram being up, and one channel being down must not silence the other,
 *    so every failure is caught, logged and reported rather than thrown.
 *  - **Degrades on missing credentials**, matching how extraction and the
 *    digest sender behave without their keys.
 */
@Injectable()
export class AlertDispatchService implements OnApplicationShutdown {
  private readonly logger = new Logger(AlertDispatchService.name);

  /**
   * Drops waiting to be announced, oldest first.
   *
   * In process, deliberately. CONTEXT.md §3 intends Redis + BullMQ for
   * notification dispatch; like the cron schedulers, this is the lightweight
   * interim until that exists. It is honest for the job because the queue never
   * holds a claim — see `enqueueBroadcast`.
   *
   * Named `queued` rather than `pending`: `pending` is a defined term in the
   * glossary for both a drop awaiting moderation and a broadcast awaiting an
   * outcome, and this is neither.
   */
  private readonly queued: string[] = [];
  /** The in-flight drain, or null when the queue is idle. */
  private draining: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramClient,
  ) {}

  /** The configured channel per locale, omitting any that is not set. */
  private channels(): BroadcastChannel[] {
    return ALERT_LOCALES.flatMap((locale) => {
      const chatId = this.config.get<string>(`telegram.channels.${locale}`);
      return chatId ? [{ locale, chatId }] : [];
    });
  }

  /**
   * Announce a drop without making the caller wait for Telegram.
   *
   * Returns immediately. Queued drops are sent one at a time with a gap between
   * them, because the caller is a person working through a queue: approving a
   * dozen drops is two dozen messages, Telegram throttles bursts per channel,
   * and under ADR-0002 a rejected send is recorded and never retried. Sending
   * them all at once would not merely be slow — it would lose those alerts for
   * good.
   *
   * A drop is claimed only when its turn comes, so a process that dies with
   * work still queued leaves no claim behind — the drop stays a backfill
   * candidate rather than being silently marked as delivered (ADR-0002).
   */
  enqueueBroadcast(dropId: string): void {
    this.queued.push(dropId);
    if (!this.draining) {
      this.draining = this.drain()
        // drain awaits only broadcastDrop, which never throws, but an unhandled
        // rejection here would take down the API process for an alert.
        .catch((err) => {
          this.logger.error(
            `Broadcast queue stopped: ${err instanceof Error ? err.message : err}`,
          );
        })
        .finally(() => {
          this.draining = null;
        });
    }
  }

  /** Resolves once the queue is empty. */
  async whenIdle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /**
   * Finish announcing what is already queued before the process goes away.
   *
   * Without this, a deploy landing while a reviewer works through the queue
   * would discard the remaining announcements. They would still be recoverable
   * by a backfill, but only once a human noticed — so draining here is what
   * keeps that a theoretical hole rather than a routine one. A hard kill still
   * skips it, which is why nothing is claimed until it is sent.
   */
  async onApplicationShutdown(): Promise<void> {
    if (!this.draining && this.queued.length === 0) return;
    this.logger.log(
      `Shutting down with ${this.queued.length} drop(s) still to announce`,
    );
    await this.whenIdle();
  }

  private async drain(): Promise<void> {
    const gapMs =
      this.config.get<number>('telegram.dispatchGapMs') ?? DEFAULT_DISPATCH_GAP_MS;

    while (this.queued.length > 0) {
      const dropId = this.queued.shift()!;
      // broadcastDrop never throws, so one bad drop cannot stall the queue.
      await this.broadcastDrop(dropId);
      if (this.queued.length > 0 && gapMs > 0) await this.pause(gapMs);
    }
  }

  /**
   * Broadcast one drop to every configured channel.
   *
   * Never throws: the result says what happened per channel.
   */
  async broadcastDrop(dropId: string): Promise<DropBroadcastResult> {
    const result: DropBroadcastResult = {
      dropId,
      status: 'dispatched',
      sentCount: 0,
      channels: [],
    };

    try {
      const token = this.config.get<string>('telegram.botToken');
      const channels = this.channels();

      if (!token || channels.length === 0) {
        result.status = 'skipped';
        result.reason = !token
          ? 'TELEGRAM_BOT_TOKEN not configured — dispatch skipped'
          : 'no Telegram channels configured — dispatch skipped';
        this.logger.warn(result.reason);
        return result;
      }

      const drop = await this.prisma.drop.findUnique({
        where: { id: dropId },
        select: DROP_FIELDS,
      });
      if (!drop) {
        result.status = 'error';
        result.reason = `drop ${dropId} not found`;
        this.logger.error(result.reason);
        return result;
      }

      const payload: BroadcastPayload = {
        alert: this.toAlert(drop),
        imageUrl: drop.imageUrl,
        webUrl: this.webUrl(),
      };

      for (const channel of channels) {
        const outcome = await this.broadcastToChannel(
          drop.id,
          channel,
          payload,
        );
        result.channels.push(outcome);
        if (outcome.outcome === 'sent') result.sentCount += 1;
      }
    } catch (err) {
      // A drop reaching nobody is bad; a drop failing to be ingested is worse.
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      result.reason = message;
      this.logger.error(`Broadcast of drop ${dropId} failed: ${message}`);
    }

    return result;
  }

  private async broadcastToChannel(
    dropId: string,
    channel: BroadcastChannel,
    payload: BroadcastPayload,
  ): Promise<ChannelBroadcastResult> {
    const base = { locale: channel.locale, chatId: channel.chatId };

    // Claim first. Whoever wins the insert owns the send; everyone else — a
    // concurrent run, a re-run, a retry after a restart — sees the row and
    // stops here.
    let claimId: string;
    try {
      const claim = await this.prisma.dropBroadcast.create({
        data: {
          dropId,
          chatId: channel.chatId,
          locale: channel.locale,
          status: BroadcastStatus.pending,
        },
        select: { id: true },
      });
      claimId = claim.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_VIOLATION
      ) {
        return { ...base, outcome: 'skipped', reason: 'already broadcast' };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not claim broadcast of ${dropId}: ${message}`);
      return { ...base, outcome: 'failed', reason: message };
    }

    const text = renderDropAlert(channel.locale, payload.alert, payload.webUrl);

    try {
      const { messageId } = await this.telegram.send({
        chatId: channel.chatId,
        text,
        imageUrl: payload.imageUrl,
      });
      await this.prisma.dropBroadcast.update({
        where: { id: claimId },
        data: {
          status: BroadcastStatus.sent,
          messageId,
          sentAt: new Date(),
        },
      });
      return { ...base, outcome: 'sent' };
    } catch (err) {
      // One channel being down must not silence the other, so this is recorded
      // and returned rather than thrown. The claim row stays: we cannot tell a
      // message that never arrived from one that arrived before the connection
      // dropped, and a duplicate post is the more expensive mistake.
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.dropBroadcast
        .update({
          where: { id: claimId },
          data: { status: BroadcastStatus.failed, error: message },
        })
        .catch(() => undefined);
      this.logger.error(
        `Broadcast to ${channel.locale} channel failed for drop ${dropId}: ${message}`,
      );
      return { ...base, outcome: 'failed', reason: message };
    }
  }

  /**
   * Post drops that are already live on the site but have never reached a
   * channel — a new channel being wired up, a backlog published before
   * broadcasting existed, or drops whose alert was lost to a run that died
   * (ADR-0002).
   *
   * Safe to re-run: every send still goes through `broadcastDrop`, so the
   * `(drop_id, chat_id)` claim decides what actually goes out. This only picks
   * *which* drops to offer it. Candidates are chosen per channel, so adding a
   * third language backfills that channel without re-posting to the two that
   * are already caught up.
   *
   * Oldest first, so a channel reads in the order things actually happened.
   *
   * Never throws.
   */
  async backfill(options: BackfillOptions = {}): Promise<BackfillResult> {
    const limit = Math.max(
      1,
      Math.min(options.limit ?? DEFAULT_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT),
    );
    const dryRun = options.confirm !== true;
    const result: BackfillResult = {
      status: 'dispatched',
      dryRun,
      limit,
      candidateCount: 0,
      sentCount: 0,
      candidates: [],
    };

    try {
      const token = this.config.get<string>('telegram.botToken');
      const channels = this.channels();
      if (!token || channels.length === 0) {
        result.status = 'skipped';
        result.reason = !token
          ? 'TELEGRAM_BOT_TOKEN not configured — backfill skipped'
          : 'no Telegram channels configured — backfill skipped';
        this.logger.warn(result.reason);
        return result;
      }

      const pending = await this.backfillCandidates(channels, limit);
      result.candidateCount = pending.length;
      const webUrl = this.webUrl();

      for (const { drop, locales } of pending) {
        const alert = this.toAlert(drop);
        result.candidates.push({
          dropId: drop.id,
          brandName: drop.brand.name,
          title: drop.title,
          publishedAt: drop.publishedAt?.toISOString() ?? null,
          pendingLocales: locales.map((c) => c.locale),
          messages: locales.map((c) => ({
            locale: c.locale,
            chatId: c.chatId,
            text: renderDropAlert(c.locale, alert, webUrl),
          })),
        });
      }

      if (dryRun) {
        result.reason = `dry run — ${result.candidateCount} drop(s) would be posted; pass confirm to send`;
        this.logger.log(result.reason);
        return result;
      }

      const delayMs =
        options.delayMs ?? this.config.get<number>('telegram.backfillDelayMs') ?? 3000;

      for (const [index, { drop }] of pending.entries()) {
        // Telegram throttles per channel, and a backfill is the one path that
        // posts in bursts. Pace it rather than discovering the limit in prod.
        if (index > 0 && delayMs > 0) await this.pause(delayMs);
        const sent = await this.broadcastDrop(drop.id);
        result.sentCount += sent.sentCount;
      }

      this.logger.log(
        `Backfill posted ${result.sentCount} message(s) across ${result.candidateCount} drop(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      result.reason = message;
      this.logger.error(`Backfill failed: ${message}`);
    }

    return result;
  }

  /**
   * Published drops each channel has never been offered, oldest first.
   *
   * Asked per channel rather than once overall: a drop already on the English
   * channel is still a candidate for a Ukrainian channel added later. A drop
   * whose send *failed* holds a claim row and so is correctly not a candidate —
   * failures are not retried (ADR-0002).
   */
  private async backfillCandidates(channels: BroadcastChannel[], limit: number) {
    const byDrop = new Map<
      string,
      { drop: DropRecord; locales: BroadcastChannel[] }
    >();

    for (const channel of channels) {
      const drops = await this.prisma.drop.findMany({
        where: {
          moderationStatus: ModerationStatus.approved,
          publishedAt: { not: null },
          broadcasts: { none: { chatId: channel.chatId } },
        },
        orderBy: { publishedAt: 'asc' },
        take: limit,
        select: DROP_FIELDS,
      });
      for (const drop of drops) {
        const entry = byDrop.get(drop.id) ?? { drop, locales: [] };
        entry.locales.push(channel);
        byDrop.set(drop.id, entry);
      }
    }

    return [...byDrop.values()]
      .sort(
        (a, b) =>
          (a.drop.publishedAt?.getTime() ?? 0) -
          (b.drop.publishedAt?.getTime() ?? 0),
      )
      .slice(0, limit);
  }

  private toAlert(drop: DropRecord): DropAlert {
    const isFromStore =
      drop.sourceEvent?.source.type === SourceType.site_watch;
    return {
      brandName: drop.brand.name,
      brandSlug: drop.brand.slug,
      title: drop.title,
      type: drop.type,
      price: this.price(drop.priceLow),
      currency: drop.currency,
      // Asked, not decided here: the website answers from the same rule, so the
      // two surfaces cannot classify one drop differently — which is exactly how
      // "Buy from the brand" once ended up over a magazine link.
      purchase: purchaseLinkFor({
        sourceType: drop.sourceEvent?.source.type,
        sourceUrl: drop.sourceUrl,
        brandWebsite: drop.brand.website,
      }),
      // Only a drop that came from a publication has coverage. A site-watch
      // drop's link is its product page, and it is already the purchase link.
      coverageUrl: isFromStore ? null : drop.sourceUrl,
    };
  }

  private webUrl(): string {
    return this.config.get<string>('digest.publicWebUrl')!;
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Prisma Decimal → plain number; how it reads is `messages.ts`'s business. */
  private price(value: Prisma.Decimal | null): number | null {
    if (value === null) return null;
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
}
