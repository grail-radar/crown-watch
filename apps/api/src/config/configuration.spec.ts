/**
 * Config tests — pure, no I/O.
 *
 * These exist for the settings where getting the name wrong fails silently:
 * an unrecognised channel variable leaves that channel unconfigured, and the
 * only symptom is a channel that never receives anything.
 */
import configuration from './configuration';

describe('telegram channels', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  function withEnv(vars: Record<string, string | undefined>) {
    for (const key of ['TELEGRAM_CHANNEL_UA', 'TELEGRAM_CHANNEL_UK', 'TELEGRAM_CHANNEL_EN']) {
      delete process.env[key];
    }
    Object.assign(process.env, vars);
    return configuration().telegram.channels;
  }

  it('reads the Ukrainian channel from TELEGRAM_CHANNEL_UA', () => {
    // `ua` is the country code people reach for, even though the locale is `uk`.
    expect(withEnv({ TELEGRAM_CHANNEL_UA: '@crownwatch_ua' }).uk).toBe(
      '@crownwatch_ua',
    );
  });

  it('still reads the older TELEGRAM_CHANNEL_UK spelling', () => {
    expect(withEnv({ TELEGRAM_CHANNEL_UK: '@legacy_ua' }).uk).toBe('@legacy_ua');
  });

  it('prefers UA when both spellings are set', () => {
    const channels = withEnv({
      TELEGRAM_CHANNEL_UA: '@correct',
      TELEGRAM_CHANNEL_UK: '@stale',
    });

    expect(channels.uk).toBe('@correct');
  });

  it('leaves the channel unset when neither is given', () => {
    expect(withEnv({ TELEGRAM_CHANNEL_EN: '@crownwatch_en' }).uk).toBeUndefined();
  });

  it('treats an empty value as unset rather than as a channel named ""', () => {
    expect(withEnv({ TELEGRAM_CHANNEL_UA: '' }).uk).toBeUndefined();
  });
});

describe('the site-watch flood threshold', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads SITE_WATCH_MAX_CHANGES_PER_POLL', () => {
    process.env.SITE_WATCH_MAX_CHANGES_PER_POLL = '40';

    expect(configuration().siteWatch.maxChangesPerPoll).toBe(40);
  });

  it('has a default, so the wall stands in a deployment that never set it', () => {
    delete process.env.SITE_WATCH_MAX_CHANGES_PER_POLL;

    expect(configuration().siteWatch.maxChangesPerPoll).toBeGreaterThan(0);
  });
});

describe('telegram partner groups', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads partner groups from TELEGRAM_GROUPS', () => {
    process.env.TELEGRAM_GROUPS = 'uk:-1001234567890:42';

    expect(configuration().telegram.groups).toEqual([
      {
        locale: 'uk',
        chatId: '-1001234567890',
        messageThreadId: '42',
        key: '-1001234567890:42',
      },
    ]);
  });

  it('has no groups when the variable is unset', () => {
    delete process.env.TELEGRAM_GROUPS;

    expect(configuration().telegram.groups).toEqual([]);
  });

  it('refuses to start on an entry it cannot read', () => {
    // Louder than the channels above deliberately: a channel we own that goes
    // quiet is noticed within a day, a partner community's topic is not.
    process.env.TELEGRAM_GROUPS = 'uk:-1001234567890:general';

    expect(() => configuration()).toThrow(/TELEGRAM_GROUPS/);
  });
});
