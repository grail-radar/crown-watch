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

  /** Batches passed to deleteMany, in order, so a test can assert on pacing. */
  deleted: Array<{ chatId: string; messageIds: string[] }> = [];

  /** Channels whose deletions should fail, by chat id. */
  undeletable = new Set<string>();

  /**
   * Individual message ids Telegram will refuse.
   *
   * Modelled on the real thing rather than on the documentation: an id it
   * cannot *find* is skipped, but one it can find and refuses to delete fails
   * the whole call. That is what took 99 real posts down with one bad id in
   * production, so the double has to reproduce it.
   */
  undeletableIds = new Set<string>();

  async deleteMany({
    chatId,
    messageIds,
  }: {
    chatId: string;
    messageIds: string[];
  }): Promise<{ ok: boolean; detail?: string }> {
    if (this.undeletable.has(chatId)) {
      return { ok: false, detail: `cannot delete in ${chatId}` };
    }
    if (messageIds.some((id) => this.undeletableIds.has(id))) {
      return { ok: false, detail: 'Bad Request: message can\'t be deleted' };
    }
    this.deleted.push({ chatId, messageIds });
    return { ok: true };
  }

  /** Every message id this double was asked to delete, across batches. */
  get deletedIds(): string[] {
    return this.deleted.flatMap((d) => d.messageIds);
  }

  reset(): void {
    this.sent = [];
    this.deleted = [];
    this.broken.clear();
    this.undeletable.clear();
    this.undeletableIds.clear();
    this.onSend = null;
  }
}

/** Same rule the dispatcher claims by, so a test names channels its way. */
function keyOf(request: TelegramSendRequest): string {
  return destinationKey(request.chatId, request.messageThreadId ?? undefined);
}
