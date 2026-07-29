export interface AppConfig {
  nodeEnv: string;
  port: number;
  webOrigin: string | undefined;
  adminToken: string | undefined;
  database: { url: string | undefined };
  redis: { url: string | undefined };
  rss: {
    pollCron: string;
    pollOnBoot: boolean;
    userAgent: string;
    requestTimeoutMs: number;
  };
  siteWatch: {
    /** Identifies the bot honestly to every store it touches. */
    userAgent: string;
    requestTimeoutMs: number;
    pollCron: string;
    pollOnBoot: boolean;
    /** Pause between stores within one run, so a poll is polite as a whole. */
    pollDelayMs: number;
  };
  anthropic: {
    apiKey: string | undefined;
    model: string;
    maxItemsPerRun: number;
  };
  digest: {
    resendApiKey: string | undefined;
    from: string;
    publicWebUrl: string;
    publicApiUrl: string;
  };
  telegram: {
    botToken: string | undefined;
    /** One public broadcast channel per language. */
    channels: { uk: string | undefined; en: string | undefined };
    requestTimeoutMs: number;
    /** Pause between drops during a backfill, to stay under Telegram's limits. */
    backfillDelayMs: number;
    /** Pause between queued drops when several are approved in quick succession. */
    dispatchGapMs: number;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3333', 10),
  webOrigin: process.env.WEB_ORIGIN,
  adminToken: process.env.ADMIN_TOKEN || undefined,
  database: { url: process.env.DATABASE_URL },
  redis: { url: process.env.REDIS_URL },
  rss: {
    pollCron: process.env.RSS_POLL_CRON ?? '0 */15 * * * *',
    pollOnBoot: (process.env.RSS_POLL_ON_BOOT ?? 'false').toLowerCase() === 'true',
    userAgent:
      process.env.RSS_USER_AGENT ??
      'CrownWatchBot/0.1 (+https://crown-watch.example; Tier1 RSS ingestion)',
    requestTimeoutMs: parseInt(process.env.RSS_TIMEOUT_MS ?? '20000', 10),
  },
  siteWatch: {
    // Names the bot and points at a page a shop owner can read. These stores
    // are the subject of the product: being blocked by them would end it, so
    // the UA says who we are and how to reach us rather than impersonating a
    // browser.
    userAgent:
      process.env.SITE_WATCH_USER_AGENT ??
      'CrownWatchBot/0.1 (+https://crownswatch.org/about-the-bot; Tier4 store watch)',
    requestTimeoutMs: parseInt(process.env.SITE_WATCH_TIMEOUT_MS ?? '20000', 10),
    // Stores change far less often than a news feed, and each poll is a request
    // to somebody else's shop — hourly is plenty for a restock radar.
    pollCron: process.env.SITE_WATCH_POLL_CRON ?? '0 5 * * * *',
    pollOnBoot:
      (process.env.SITE_WATCH_POLL_ON_BOOT ?? 'false').toLowerCase() === 'true',
    pollDelayMs: parseInt(process.env.SITE_WATCH_POLL_DELAY_MS ?? '2000', 10),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    // Haiku by default for the recurring extraction (~5x cheaper; quality is
    // sufficient for this well-scoped task). Set ANTHROPIC_MODEL to
    // claude-opus-4-8 to trade cost for maximum extraction quality.
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
    maxItemsPerRun: parseInt(process.env.EXTRACTION_MAX_ITEMS ?? '25', 10),
  },
  digest: {
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.DIGEST_FROM ?? 'Crown Watch <onboarding@resend.dev>',
    publicWebUrl: (
      process.env.PUBLIC_WEB_URL ?? 'https://crownswatch.org'
    ).replace(/\/$/, ''),
    // Render injects RENDER_EXTERNAL_URL with the service's own public URL.
    publicApiUrl: (
      process.env.PUBLIC_API_URL ??
      process.env.RENDER_EXTERNAL_URL ??
      'http://localhost:3333'
    ).replace(/\/$/, ''),
  },
  telegram: {
    // Absent credentials or channels are a supported state: dispatch is skipped
    // with a warning and ingestion still succeeds, matching how extraction and
    // the digest sender degrade without their keys.
    botToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    channels: {
      // The locale is `uk` — ISO 639-1 for Ukrainian — but `UA` is the country
      // code, reads as "Ukraine" rather than "United Kingdom", and is what
      // people actually type. Both spellings are accepted; UA wins if both are
      // set. Silently ignoring TELEGRAM_CHANNEL_UA would leave the Ukrainian
      // channel unconfigured with no error anywhere, which is exactly the kind
      // of failure this whole path is built to avoid.
      uk:
        process.env.TELEGRAM_CHANNEL_UA ||
        process.env.TELEGRAM_CHANNEL_UK ||
        undefined,
      en: process.env.TELEGRAM_CHANNEL_EN || undefined,
    },
    requestTimeoutMs: parseInt(process.env.TELEGRAM_TIMEOUT_MS ?? '15000', 10),
    // Telegram throttles bursts to a channel at roughly 20 messages a minute.
    backfillDelayMs: parseInt(
      process.env.TELEGRAM_BACKFILL_DELAY_MS ?? '3000',
      10,
    ),
    // A reviewer clearing the moderation queue approves drops far faster than
    // Telegram will accept them, and a rejected send is never retried, so the
    // queue is drained one drop at a time with this gap between them.
    dispatchGapMs: parseInt(process.env.TELEGRAM_DISPATCH_GAP_MS ?? '3000', 10),
  },
});
