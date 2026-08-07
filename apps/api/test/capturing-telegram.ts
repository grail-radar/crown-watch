import { destinationKey } from '../src/alerts/destinations';
import {
  TelegramClient,
  TelegramSendRequest,
  TelegramSendResult,
} from '../src/alerts/telegram-client';

/**
 * Stands in for Telegram in tests: records what would have been posted, and can
 * be told to fail a channel or to hold a send open.
 *
 * Lives outside `src` because it is test support — `tsconfig.build.json`
 * excludes `test`, so it never reaches the built output. Shared rather than
 * copied per spec so "what a message looks like" has one definition.
 */
export class CapturingTelegram extends TelegramClient {
  sent: TelegramSendRequest[] = [];

  /**
   * Channels that should throw instead of accepting a message, by key — the
   * chat id, or `chat:topic` for one topic of a supergroup. Naming the topic
   * lets a test break one room of a group without breaking the rest.
   */
  broken = new Set<string>();

  /**
   * Called at the start of every send, before the message is recorded. Lets a
   * test observe overlap or hold a send open, without patching over the seam.
   */
  onSend: ((request: TelegramSendRequest) => Promise<void> | void) | null = null;

  async send(request: TelegramSendRequest): Promise<TelegramSendResult> {
    await this.onSend?.(request);
    const key = keyOf(request);
    if (this.broken.has(key)) {
      throw new Error(`channel ${key} is unavailable`);
    }
    this.sent.push(request);
    return { messageId: String(this.sent.length) };
  }

  /** Every channel that received something, in the order they did. */
  get keys(): string[] {
    return this.sent.map(keyOf);
  }

  /** The message a given channel received, if any. */
  textFor(key: string): string | undefined {
    return this.sent.find((s) => keyOf(s) === key)?.text;
  }

  reset(): void {
    this.sent = [];
    this.broken.clear();
    this.onSend = null;
  }
}

/** Same rule the dispatcher claims by, so a test names channels its way. */
function keyOf(request: TelegramSendRequest): string {
  return destinationKey(request.chatId, request.messageThreadId ?? undefined);
}
