import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BroadcastStatus, Prisma } from '@prisma/client';
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

export type BroadcastOutcome = 'sent' | 'skipped' | 'failed';

/** One configured destination: a language and the channel it posts to. */
export interface BroadcastChannel {
  locale: AlertLocale;
  chatId: string;
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
export class AlertDispatchService {
  private readonly logger = new Logger(AlertDispatchService.name);

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
        select: {
          id: true,
          title: true,
          type: true,
          priceLow: true,
          currency: true,
          sourceUrl: true,
          brand: { select: { name: true, slug: true } },
        },
      });
      if (!drop) {
        result.status = 'error';
        result.reason = `drop ${dropId} not found`;
        this.logger.error(result.reason);
        return result;
      }

      const alert: DropAlert = {
        brandName: drop.brand.name,
        brandSlug: drop.brand.slug,
        title: drop.title,
        type: drop.type,
        price: this.price(drop.priceLow),
        currency: drop.currency,
        productUrl: drop.sourceUrl,
      };
      const webUrl = this.config.get<string>('digest.publicWebUrl')!;

      for (const channel of channels) {
        const outcome = await this.broadcastToChannel(
          drop.id,
          channel,
          alert,
          webUrl,
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
    alert: DropAlert,
    webUrl: string,
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

    const text = renderDropAlert(channel.locale, alert, webUrl);

    try {
      const { messageId } = await this.telegram.send({
        chatId: channel.chatId,
        text,
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

  /** Prisma Decimal → plain number; how it reads is `messages.ts`'s business. */
  private price(value: Prisma.Decimal | null): number | null {
    if (value === null) return null;
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
}
