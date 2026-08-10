/**
 * Where a drop alert is posted.
 *
 * Until now that was always one channel per language, and a channel is fully
 * described by its `@handle`. A partner community is not: it is a supergroup
 * whose watch news lives in one forum topic, and posting to the group without
 * naming the topic drops the message into General — the wrong room, in a room
 * that cannot unsend (ADR-0002). So a destination is a chat *and* optionally a
 * topic within it.
 *
 * Parsing lives here rather than in the dispatcher so a typo in the environment
 * fails at boot instead of leaving a destination silently unconfigured, which
 * `configuration.spec.ts` names as the failure mode worth spending code on.
 */
import { ALERT_LOCALES, AlertLocale } from './messages';

/**
 * One place a drop is announced.
 *
 * Still called a *channel*: ADR-0002 already uses the word for "somewhere a
 * broadcast is claimed against", and its `(drop, channel)` rule is exactly what
 * a group topic has to obey too. Only the shape widened.
 */
export interface BroadcastChannel {
  locale: AlertLocale;
  /** Telegram's own chat identifier — `@channel` or a numeric chat id. */
  chatId: string;
  /**
   * Forum topic within a supergroup. Absent for a channel or a group that has
   * topics turned off, where Telegram wants no thread at all.
   */
  messageThreadId?: string;
  /**
   * How this destination is identified in `drop_broadcasts.chat_id`, and so
   * what decides whether a drop has already been posted here.
   *
   * Equal to `chatId` for a plain chat, which is what keeps every claim written
   * before topics existed still matching its channel. A topic appends `:topic`,
   * making two topics in one supergroup distinct destinations rather than one
   * that mysteriously only ever receives half the drops.
   */
  key: string;
}

/** The claim key for a chat/topic pair — the same string the operator writes. */
export function destinationKey(
  chatId: string,
  messageThreadId?: string,
): string {
  return messageThreadId ? `${chatId}:${messageThreadId}` : chatId;
}

/**
 * Parse `TELEGRAM_GROUPS`: comma-separated `locale:chatId[:topicId]` entries.
 *
 *   uk:-1001234567890:42          the watch-news topic of one Ukrainian group
 *   uk:-1001234567890:42,en:@foo  several destinations, any language
 *
 * A list rather than a variable per language: a language has exactly one
 * channel of ours, but there is no limit on how many partner communities carry
 * the feed, and they are added and dropped by agreement rather than by release.
 *
 * Throws on anything it cannot read. A partner group that receives nothing
 * because of a mistyped id is invisible from our side — the group's members
 * simply never see a drop and nobody here is told — so this is deliberately the
 * one part of Telegram configuration that refuses to start rather than degrade.
 */
/**
 * Just enough of `ConfigService` to answer "where do we post".
 *
 * Structural, so this module keeps knowing nothing about Nest — `ConfigService`
 * satisfies it without being imported.
 */
export interface ChannelConfig {
  get<T>(key: string): T | undefined;
}

/**
 * Everywhere a Drop is announced: our own Channel per language, plus any
 * partner community configured through `TELEGRAM_GROUPS`.
 *
 * Ours come first, so the Channel we control is the first to have a Drop and a
 * partner group never carries something our own followers have not seen.
 *
 * Lives here rather than on the dispatcher because it is not a dispatch
 * decision — it is what `destinations.ts` is for, and two callers now need the
 * same answer. `BroadcastClaimSweepService` refuses to delete a claim against a
 * live Channel, and that guard is only worth anything if it reads the list from
 * the same place the dispatcher does.
 */
export function configuredChannels(config: ChannelConfig): BroadcastChannel[] {
  const own = ALERT_LOCALES.flatMap((locale) => {
    const chatId = config.get<string>(`telegram.channels.${locale}`);
    // The key is the bare chat id, which is what every claim written before
    // partner groups existed used — those Channels keep their own history.
    return chatId ? [{ locale, chatId, key: destinationKey(chatId) }] : [];
  });

  const groups = config.get<BroadcastChannel[]>('telegram.groups') ?? [];

  return [...own, ...groups];
}

export function parseGroupDestinations(
  raw: string | undefined,
): BroadcastChannel[] {
  if (!raw?.trim()) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseEntry(entry, raw));
}

function parseEntry(entry: string, raw: string): BroadcastChannel {
  const invalid = (why: string) =>
    new Error(
      `TELEGRAM_GROUPS entry "${entry}" is not usable: ${why}. ` +
        `Expected locale:chatId[:topicId], e.g. uk:-1001234567890:42 (got "${raw}").`,
    );

  // Chat ids are numeric or `@handle`, and topic ids are numeric, so neither
  // can contain a colon — splitting on it is unambiguous.
  const parts = entry.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw invalid('it has the wrong number of colon-separated parts');
  }

  const [locale, chatId, topicId] = parts.map((part) => part.trim());

  if (!isAlertLocale(locale)) {
    throw invalid(
      `"${locale}" is not a language we broadcast in (${ALERT_LOCALES.join(', ')})`,
    );
  }
  if (!chatId) throw invalid('the chat id is empty');
  if (topicId !== undefined && !/^\d+$/.test(topicId)) {
    throw invalid(`"${topicId}" is not a topic id — Telegram's are whole numbers`);
  }

  return {
    locale,
    chatId,
    ...(topicId ? { messageThreadId: topicId } : {}),
    key: destinationKey(chatId, topicId),
  };
}

function isAlertLocale(value: string): value is AlertLocale {
  return (ALERT_LOCALES as readonly string[]).includes(value);
}
