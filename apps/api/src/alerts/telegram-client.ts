import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendRequest {
  /** Channel identifier — either `@channelname` or a numeric chat id. */
  chatId: string;
  /** Message body, already rendered as Telegram-flavoured HTML. */
  text: string;
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

  async send({ chatId, text }: TelegramSendRequest): Promise<TelegramSendResult> {
    const token = this.config.get<string>('telegram.botToken');
    if (!token) {
      // The dispatcher checks configuration before it ever gets here; reaching
      // this point means a wiring mistake, not a missing-credentials run.
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const timeoutMs = this.config.get<number>('telegram.requestTimeoutMs') ?? 15000;

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        // The alert is the link; Telegram's own preview card would double it up
        // and push the next alert off the screen.
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    } | null;

    if (!res.ok || !body?.ok) {
      const detail = body?.description ?? `HTTP ${res.status}`;
      throw new Error(`Telegram sendMessage failed: ${detail}`);
    }

    return {
      messageId:
        body.result?.message_id === undefined
          ? null
          : String(body.result.message_id),
    };
  }
}
