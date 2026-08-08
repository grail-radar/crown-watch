import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendRequest {
  /** Channel identifier — either `@channelname` or a numeric chat id. */
  chatId: string;
  /** Message body, already rendered as Telegram-flavoured HTML. */
  text: string;
  /** Drop photo, when we have one. Posted as an image with the text beneath. */
  imageUrl?: string | null;
  /**
   * Forum topic to post into, for a supergroup that has topics.
   *
   * Omitting it in a forum does not fail — the message lands in General, which
   * in a partner community is somebody else's front room and cannot be unsent.
   * Passing one to a chat *without* topics is the error Telegram does reject.
   */
  messageThreadId?: string | null;
}

export interface TelegramSendResult {
  /** Telegram's id for the posted message, kept for provenance. */
  messageId: string | null;
}

/**
 * The single outbound I/O seam for broadcasting.
 *
 * Everything above it — templating, deduplication, persistence — is pure or
 * database-only, so the whole dispatch path can be driven in tests by a
 * capturing double, with no network access. Mirrors `SiteFetcher` on the
 * inbound side.
 */
/**
 * Removing posts, in batches.
 *
 * Telegram will only delete a message for up to 48 hours after it was sent, so
 * this is a narrow window for correcting a mistake — not a general edit
 * facility. And it removes the post, never the notification: anyone who already
 * saw it has seen it (ADR-0002).
 */
export interface TelegramDeleteRequest {
  chatId: string;
  /** Telegram's own ids. The API takes at most 100 per call. */
  messageIds: string[];
}

export interface TelegramDeleteResult {
  ok: boolean;
  /** Why the call failed, when it did. */
  detail?: string;
}

/** Telegram's own cap on `deleteMessages`. */
export const DELETE_BATCH_LIMIT = 100;

export abstract class TelegramClient {
  abstract send(request: TelegramSendRequest): Promise<TelegramSendResult>;

  /**
   * Delete up to `DELETE_BATCH_LIMIT` messages in one call. Messages that
   * cannot be found or deleted are skipped by Telegram rather than failing the
   * batch, so a re-run is safe.
   */
  abstract deleteMany(
    request: TelegramDeleteRequest,
  ): Promise<TelegramDeleteResult>;
}

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Telegram caps a photo caption at 1024 characters, against 4096 for a plain
 * message. A drop alert is far shorter than either, but a pathological title
 * would otherwise be rejected outright — so an over-long alert posts as text
 * rather than not at all.
 */
const CAPTION_LIMIT = 1024;

export interface TelegramCall {
  method: 'sendMessage' | 'sendPhoto' | 'deleteMessages';
  body: Record<string, unknown>;
}

/**
 * Which Bot API method to call, and with what.
 *
 * Pure, so the photo-versus-text decision is testable without touching the
 * network — the rest of this file is I/O and is deliberately not unit-tested.
 */
export function buildSendCall({
  chatId,
  text,
  imageUrl,
  messageThreadId,
}: TelegramSendRequest): TelegramCall {
  // Spread rather than always present: Telegram rejects `message_thread_id` on
  // a chat with no topics, so a channel post must carry no such key at all.
  const thread = messageThreadId ? { message_thread_id: messageThreadId } : {};

  if (imageUrl && text.length <= CAPTION_LIMIT) {
    return {
      method: 'sendPhoto',
      body: {
        chat_id: chatId,
        ...thread,
        photo: imageUrl,
        caption: text,
        parse_mode: 'HTML',
      },
    };
  }

  return {
    method: 'sendMessage',
    body: {
      chat_id: chatId,
      ...thread,
      text,
      parse_mode: 'HTML',
      // The alert is the link; Telegram's own preview card would double it up
      // and push the next alert off the screen.
      link_preview_options: { is_disabled: true },
    },
  };
}

/**
 * `CONTEXT.md` §3 names a bot library (grammY, node-telegram-bot-api) for this
 * integration. We post with `fetch` instead, matching `DigestSenderService`,
 * which calls Resend's HTTP API directly rather than pulling in its SDK.
 *
 * Broadcasting uses exactly one Bot API method and receives no updates, so a
 * library would add a dependency and a webhook/polling runtime to wrap a single
 * POST — against §6's "start entirely on free/self-hosted tiers, add per source
 * only once that source proves it needs one". Revisit if the bot ever has to
 * *receive* anything (per-user subscriptions, /start onboarding), where a
 * library earns its keep.
 */

@Injectable()
export class HttpTelegramClient extends TelegramClient {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(request: TelegramSendRequest): Promise<TelegramSendResult> {
    const token = this.config.get<string>('telegram.botToken');
    if (!token) {
      // The dispatcher checks configuration before it ever gets here; reaching
      // this point means a wiring mistake, not a missing-credentials run.
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const timeoutMs = this.config.get<number>('telegram.requestTimeoutMs') ?? 15000;
    const call = buildSendCall(request);

    const attempt = await this.post(token, call, timeoutMs);
    if (attempt.ok) return { messageId: attempt.messageId };

    // Telegram fetches the photo itself, so a dead CDN link, a hotlink block or
    // an oversized image fails the whole post. An HTTP response saying no is
    // proof nothing was published, so re-sending as text cannot duplicate — and
    // an alert with no picture beats no alert. A network error is NOT proof of
    // that, and deliberately falls through to the throw below.
    if (call.method === 'sendPhoto') {
      const textOnly = await this.post(
        token,
        buildSendCall({ ...request, imageUrl: null }),
        timeoutMs,
      );
      if (textOnly.ok) return { messageId: textOnly.messageId };
    }

    throw new Error(`Telegram ${call.method} failed: ${attempt.detail}`);
  }

  async deleteMany({
    chatId,
    messageIds,
  }: TelegramDeleteRequest): Promise<TelegramDeleteResult> {
    const token = this.config.get<string>('telegram.botToken');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    if (messageIds.length === 0) return { ok: true };
    if (messageIds.length > DELETE_BATCH_LIMIT) {
      // Batching is the caller's job, and silently truncating would leave posts
      // behind while reporting success.
      throw new Error(
        `deleteMany takes at most ${DELETE_BATCH_LIMIT} ids, got ${messageIds.length}`,
      );
    }

    const timeoutMs = this.config.get<number>('telegram.requestTimeoutMs') ?? 15000;
    const result = await this.post(
      token,
      {
        method: 'deleteMessages',
        body: {
          chat_id: chatId,
          // Telegram wants numbers here; ours are stored as strings.
          message_ids: messageIds.map((id) => Number(id)),
        },
      },
      timeoutMs,
    );

    return result.ok ? { ok: true } : { ok: false, detail: result.detail };
  }

  private async post(
    token: string,
    call: TelegramCall,
    timeoutMs: number,
  ): Promise<
    | { ok: true; messageId: string | null }
    | { ok: false; detail: string }
  > {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${call.method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    } | null;

    if (!res.ok || !body?.ok) {
      return { ok: false, detail: body?.description ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      messageId:
        body.result?.message_id === undefined
          ? null
          : String(body.result.message_id),
    };
  }
}
