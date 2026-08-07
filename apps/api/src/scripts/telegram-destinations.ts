/**
 * Find and verify the chats a drop alert is posted to.
 *
 *   pnpm --filter @crown-watch/api telegram:destinations
 *   pnpm --filter @crown-watch/api telegram:destinations -- --discover
 *   pnpm --filter @crown-watch/api telegram:destinations -- --send-test
 *
 * Read-only by default: it reports what `TELEGRAM_CHANNEL_*` and
 * `TELEGRAM_GROUPS` currently point at and whether the bot may post there.
 *
 * `--discover` lists the chats and forum topics the bot has recently seen, so a
 * numeric supergroup id and topic id can be read off rather than guessed. Note
 * that Telegram's default privacy mode means a bot in a group is only told
 * about messages aimed at it — post `/start@yourbot` *inside the topic* and the
 * update carrying that command names both ids.
 *
 * `--send-test` posts a plain message to every configured destination and then
 * deletes it. It is the only way to prove a topic id is right, because the Bot
 * API offers no way to read a forum's topics — but it does briefly notify a
 * real group, so it is opt-in.
 *
 * Never prints the token.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import {
  BroadcastChannel,
  destinationKey,
  parseGroupDestinations,
} from '../alerts/destinations';

// Same order as ConfigModule uses: the app-local env wins over the repo root.
loadEnv({ path: '.env' });
loadEnv({ path: '../../.env' });

const TELEGRAM_API = 'https://api.telegram.org';
const logger = new Logger('telegram:destinations');

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
}

interface TelegramUpdate {
  message?: {
    message_id: number;
    message_thread_id?: number;
    is_topic_message?: boolean;
    chat: TelegramChat;
    text?: string;
    reply_to_message?: { forum_topic_created?: { name: string } };
  };
}

/**
 * One Bot API call. Returns `null` rather than throwing when Telegram says no,
 * because "the bot is not in that chat" is an ordinary answer here — it is what
 * the script exists to report.
 */
async function call<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<{ ok: true; result: T } | { ok: false; detail: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const parsed = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: T;
    } | null;

    if (!parsed?.ok) {
      return { ok: false, detail: parsed?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: parsed.result as T };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Everywhere the dispatcher would post, read from the same environment. */
function configuredChannels(): BroadcastChannel[] {
  const own: BroadcastChannel[] = (
    [
      ['uk', process.env.TELEGRAM_CHANNEL_UA || process.env.TELEGRAM_CHANNEL_UK],
      ['en', process.env.TELEGRAM_CHANNEL_EN],
    ] as const
  ).flatMap(([locale, chatId]) =>
    chatId ? [{ locale, chatId, key: destinationKey(chatId) }] : [],
  );

  return [...own, ...parseGroupDestinations(process.env.TELEGRAM_GROUPS)];
}

async function report(token: string, botId: number, channel: BroadcastChannel) {
  const where = `${channel.locale}  ${channel.key}`;

  const chat = await call<TelegramChat>(token, 'getChat', {
    chat_id: channel.chatId,
  });
  if (!chat.ok) {
    logger.error(`${where}  UNREACHABLE — ${chat.detail}`);
    return;
  }

  const name = chat.result.title ?? chat.result.username ?? chat.result.id;
  const member = await call<{ status: string; can_post_messages?: boolean }>(
    token,
    'getChatMember',
    { chat_id: channel.chatId, user_id: botId },
  );

  const standing = member.ok
    ? member.result.status === 'administrator'
      ? `admin${member.result.can_post_messages === false ? ' (but may NOT post)' : ''}`
      : member.result.status
    : `unknown — ${member.detail}`;

  logger.log(`${where}  ${chat.result.type} "${name}"  bot is ${standing}`);

  if (channel.messageThreadId && !chat.result.is_forum) {
    logger.warn(
      `${where}  a topic is configured but this chat has no topics — Telegram will reject every post`,
    );
  }
  if (!channel.messageThreadId && chat.result.is_forum) {
    logger.warn(
      `${where}  this chat HAS topics and none is configured — posts would land in General`,
    );
  }
}

/**
 * Post and immediately delete. The Bot API cannot list a forum's topics, so an
 * accepted send is the only proof that a topic id is real and postable.
 */
async function sendTest(token: string, channel: BroadcastChannel) {
  const sent = await call<{ message_id: number }>(token, 'sendMessage', {
    chat_id: channel.chatId,
    ...(channel.messageThreadId
      ? { message_thread_id: channel.messageThreadId }
      : {}),
    text: 'Crown Watch — connection check. This message deletes itself.',
    disable_notification: true,
  });

  if (!sent.ok) {
    logger.error(`${channel.key}  test post REJECTED — ${sent.detail}`);
    return;
  }

  const removed = await call(token, 'deleteMessage', {
    chat_id: channel.chatId,
    message_id: sent.result.message_id,
  });
  logger.log(
    `${channel.key}  test post accepted and ${removed.ok ? 'deleted' : `LEFT IN PLACE — ${removed.detail}`}`,
  );
}

/** Chats and topics the bot has been told about but may not be configured. */
async function discover(token: string) {
  const updates = await call<TelegramUpdate[]>(token, 'getUpdates', {
    limit: 100,
    // Service messages included: being added to a group is one of them.
    allowed_updates: ['message', 'my_chat_member'],
  });

  if (!updates.ok) {
    logger.error(`Could not read updates — ${updates.detail}`);
    if (/webhook/i.test(updates.detail)) {
      logger.warn(
        'A webhook is set, which takes updates away from getUpdates. This bot only sends, so the webhook is probably stale.',
      );
    }
    return;
  }

  const seen = new Map<string, string>();
  for (const update of updates.result) {
    const message = update.message;
    if (!message) continue;
    const topic = message.is_topic_message ? message.message_thread_id : undefined;
    const key = destinationKey(String(message.chat.id), topic?.toString());
    const topicName =
      message.reply_to_message?.forum_topic_created?.name ?? 'topic';
    seen.set(
      key,
      `${message.chat.type} "${message.chat.title ?? message.chat.username ?? ''}"` +
        (topic ? ` → ${topicName} ${topic}` : ''),
    );
  }

  if (seen.size === 0) {
    logger.warn(
      'No recent updates. Post `/start@yourbot` inside the topic you want, then run this again — a bot only hears messages aimed at it.',
    );
    return;
  }

  logger.log('Chats seen recently (use the key as the TELEGRAM_GROUPS chat part):');
  for (const [key, description] of seen) {
    logger.log(`  ${key}  ${description}`);
  }
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN is not set in apps/api/.env');
    process.exitCode = 1;
    return;
  }

  const me = await call<{ id: number; username: string }>(token, 'getMe');
  if (!me.ok) {
    logger.error(`The token was rejected — ${me.detail}`);
    process.exitCode = 1;
    return;
  }
  logger.log(`Bot @${me.result.username}`);

  if (flag('discover')) {
    await discover(token);
    return;
  }

  const channels = configuredChannels();
  if (channels.length === 0) {
    logger.warn('Nothing configured — set TELEGRAM_CHANNEL_* or TELEGRAM_GROUPS.');
    return;
  }

  for (const channel of channels) await report(token, me.result.id, channel);

  if (flag('send-test')) {
    logger.warn('Posting a test message to every destination above.');
    for (const channel of channels) await sendTest(token, channel);
  } else {
    logger.log(
      'A topic id can only be proved by posting: re-run with --send-test to post and delete one message per destination.',
    );
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
