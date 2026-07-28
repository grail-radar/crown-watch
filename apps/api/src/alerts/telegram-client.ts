import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendRequest {
  /** Channel identifier — either `@channelname` or a numeric chat id. */
  chatId: string;
  /** Message body, already rendered as Telegram-flavoured HTML. */
  text: string;
  /** Drop photo, when we have one. Posted as an image with the text beneath. */
  imageUrl?: string | null;
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
export abstract class TelegramClient {
  abstract send(request: TelegramSendRequest): Promise<TelegramSendResult>;
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
  method: 'sendMessage' | 'sendPhoto';
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
}: TelegramSendRequest): TelegramCall {
  if (imageUrl && text.length <= CAPTION_LIMIT) {
    return {
      method: 'sendPhoto',
      body: {
        chat_id: chatId,
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
