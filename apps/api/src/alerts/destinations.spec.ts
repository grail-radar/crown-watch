/**
 * Destination parsing — pure, no I/O.
 *
 * These matter for the same reason `configuration.spec.ts` does: a destination
 * that fails to parse would otherwise be a partner community that quietly never
 * receives a drop, with no symptom on our side at all.
 */
import { destinationKey, parseGroupDestinations } from './destinations';

describe('parseGroupDestinations', () => {
  it('reads a group topic as a chat plus the topic within it', () => {
    expect(parseGroupDestinations('uk:-1001234567890:42')).toEqual([
      {
        locale: 'uk',
        chatId: '-1001234567890',
        messageThreadId: '42',
        key: '-1001234567890:42',
      },
    ]);
  });

  it('reads a group with no topics as a chat on its own', () => {
    // Telegram rejects a message_thread_id sent to a chat that has no topics,
    // so "no topic given" has to stay genuinely absent rather than become 0.
    const [destination] = parseGroupDestinations('en:@somegroup');

    expect(destination.messageThreadId).toBeUndefined();
    expect(destination.key).toBe('@somegroup');
  });

  it('carries several destinations, in any language', () => {
    const parsed = parseGroupDestinations(
      'uk:-1001234567890:42, en:-1009876543210:7',
    );

    expect(parsed.map((d) => [d.locale, d.key])).toEqual([
      ['uk', '-1001234567890:42'],
      ['en', '-1009876543210:7'],
    ]);
  });

  it('treats an unset or empty value as no groups', () => {
    for (const raw of [undefined, '', '   ', ',,']) {
      expect(parseGroupDestinations(raw)).toEqual([]);
    }
  });

  it('keeps two topics of one supergroup apart', () => {
    // They share a chat id. If the key did not carry the topic, the first post
    // would claim both and the second topic would never receive anything.
    const [first, second] = parseGroupDestinations('uk:-100123:42,uk:-100123:9');

    expect(first.key).not.toBe(second.key);
  });

  it.each([
    ['-1001234567890:42', 'no language'],
    ['de:-1001234567890:42', 'a language we do not broadcast in'],
    ['uk::42', 'an empty chat id'],
    ['uk:-1001234567890:general', 'a topic that is not a number'],
    ['uk:-1001234567890:42:extra', 'a trailing part'],
  ])('refuses to start on %s (%s)', (entry) => {
    expect(() => parseGroupDestinations(entry)).toThrow(/TELEGRAM_GROUPS/);
  });

  it('names the offending entry, not just the variable', () => {
    // The operator is reading a Render deploy log with one line of context.
    expect(() =>
      parseGroupDestinations('uk:-100123:42,en:oops:oops'),
    ).toThrow(/en:oops:oops/);
  });
});

describe('destinationKey', () => {
  it('is the bare chat id when there is no topic', () => {
    // Load-bearing: every claim written before topics existed used the chat id
    // alone, and those channels must keep matching their own history.
    expect(destinationKey('@crownwatch_ua')).toBe('@crownwatch_ua');
  });
});
