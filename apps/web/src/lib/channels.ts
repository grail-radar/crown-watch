/**
 * The public Telegram broadcast channels — one per language.
 *
 * Defined once and reused by the header, the footer and the release note, so a
 * renamed channel is a one-line change rather than a hunt through the markup.
 * These mirror TELEGRAM_CHANNEL_UA / TELEGRAM_CHANNEL_EN on the API side.
 */
export interface TelegramChannel {
  /** BCP 47 code — `uk` is Ukrainian (the country code is `ua`). */
  locale: 'en' | 'uk';
  /** Written in the language it broadcasts in. */
  label: string;
  handle: string;
  url: string;
}

export const TELEGRAM_CHANNELS: readonly TelegramChannel[] = [
  {
    locale: 'en',
    label: 'English',
    handle: '@crownwatch_en',
    url: 'https://t.me/crownwatch_en',
  },
  {
    locale: 'uk',
    label: 'Українська',
    handle: '@crownwatch_ua',
    url: 'https://t.me/crownwatch_ua',
  },
];
