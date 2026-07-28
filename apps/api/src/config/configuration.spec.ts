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
