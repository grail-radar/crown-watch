import { Injectable, Logger } from '@nestjs/common';
import { BroadcastStatus, ModerationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DELETE_BATCH_LIMIT, TelegramClient } from './telegram-client';

/**
 * Deletes the Telegram posts belonging to drops that have since been retracted.
 *
 * The second half of a retraction. Taking a drop off the site is a database
 * change; taking it out of a channel is not, because a channel is somebody
 * else's copy of what we said. This closes the gap for the one window Telegram
 * allows — **48 hours** — after which the posts are permanent whatever we do.
 *
 * It works because #40 retracted rather than deleted: `drop_broadcasts` kept
 * every row, and each row carries Telegram's own `message_id`. Had the drops
 * been deleted, those ids would have gone with them and the only way to clean a
 * channel would have been by hand, 280 posts at a time.
 *
 * **The `drop_broadcasts` rows are never removed here.** They are what makes
 * "at most once, ever" true (ADR-0002), and a deleted post is still a post that
 * was sent — every follower already got the notification. Keeping the row also
 * means this is safe to re-run.
 */

export interface PurgeRequest {
  /** Actually delete. Omitted or false reports and changes nothing. */
  confirm?: boolean;
  /** Only posts sent at or after this time. */
  since?: Date;
  /** Only posts sent at or before this time. */
  until?: Date;
}

export interface PurgeChannelReport {
  chatId: string;
  posts: number;
  deleted: number;
  failed: number;
  /** Why a post could not be deleted, first occurrence only. */
  error?: string;
  /** A few of the ids that would not delete, so they can be looked up. */
  failedIds: string[];
}

/** Enough failing ids to recognise a pattern, not enough to flood a terminal. */
const FAILED_ID_SAMPLE = 5;

export interface PurgeResult {
  dryRun: boolean;
  /** Posts matched across every channel. */
  posts: number;
  deleted: number;
  failed: number;
  channels: PurgeChannelReport[];
}

@Injectable()
export class BroadcastPurgeService {
  private readonly logger = new Logger(BroadcastPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramClient,
  ) {}

  async purge(request: PurgeRequest = {}): Promise<PurgeResult> {
    const { confirm, since, until } = request;

    const rows = await this.prisma.dropBroadcast.findMany({
      where: {
        // Only posts that actually went out, and only for drops that have been
        // retracted. A drop rejected by moderation was never published, so it
        // has no broadcasts — this cannot reach a legitimately rejected drop.
        status: BroadcastStatus.sent,
        messageId: { not: null },
        drop: {
          moderationStatus: ModerationStatus.rejected,
          publishedAt: null,
        },
        ...(since || until
          ? { sentAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
          : {}),
      },
      orderBy: { sentAt: 'asc' },
      select: { id: true, chatId: true, messageId: true },
    });

    const byChannel = new Map<string, string[]>();
    for (const row of rows) {
      // The channel key can carry a forum topic; Telegram's delete takes the
      // chat, so strip anything after the chat id.
      const chatId = row.chatId.includes(':')
        ? row.chatId.slice(0, row.chatId.lastIndexOf(':'))
        : row.chatId;
      byChannel.set(chatId, [...(byChannel.get(chatId) ?? []), row.messageId!]);
    }

    const result: PurgeResult = {
      dryRun: confirm !== true,
      posts: rows.length,
      deleted: 0,
      failed: 0,
      channels: [...byChannel].map(([chatId, ids]) => ({
        chatId,
        posts: ids.length,
        deleted: 0,
        failed: 0,
        failedIds: [],
      })),
    };

    if (result.dryRun) {
      this.logger.log(
        `Dry run: ${result.posts} post(s) across ${result.channels.length} channel(s) would be deleted.`,
      );
      return result;
    }

    for (const report of result.channels) {
      const ids = byChannel.get(report.chatId)!;

      for (let i = 0; i < ids.length; i += DELETE_BATCH_LIMIT) {
        const batch = ids.slice(i, i + DELETE_BATCH_LIMIT);
        const outcome = await this.telegram.deleteMany({
          chatId: report.chatId,
          messageIds: batch,
        });

        if (outcome.ok) {
          report.deleted += batch.length;
          continue;
        }

        // Telegram's documentation says unusable ids are skipped, and that is
        // true only of ids it cannot *find*. One id it can find but refuses to
        // delete fails the entire call — so a single bad id would otherwise
        // take 99 real posts down with it. Retry the batch one at a time.
        this.logger.warn(
          `Batch of ${batch.length} in ${report.chatId} refused (${outcome.detail}); retrying individually.`,
        );

        for (const messageId of batch) {
          const single = await this.telegram.deleteMany({
            chatId: report.chatId,
            messageIds: [messageId],
          });

          if (single.ok) {
            report.deleted += 1;
          } else {
            report.failed += 1;
            report.error ??= single.detail;
            if (report.failedIds.length < FAILED_ID_SAMPLE) {
              report.failedIds.push(messageId);
            }
          }
        }
      }

      result.deleted += report.deleted;
      result.failed += report.failed;
    }

    this.logger.log(
      `Deleted ${result.deleted} post(s), ${result.failed} failed. drop_broadcasts rows left intact.`,
    );
    return result;
  }
}
