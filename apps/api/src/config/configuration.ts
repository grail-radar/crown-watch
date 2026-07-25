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
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    maxItemsPerRun: parseInt(process.env.EXTRACTION_MAX_ITEMS ?? '25', 10),
  },
  digest: {
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.DIGEST_FROM ?? 'Crown Watch <onboarding@resend.dev>',
    publicWebUrl: (
      process.env.PUBLIC_WEB_URL ?? 'https://crown-watch-web.vercel.app'
    ).replace(/\/$/, ''),
    // Render injects RENDER_EXTERNAL_URL with the service's own public URL.
    publicApiUrl: (
      process.env.PUBLIC_API_URL ??
      process.env.RENDER_EXTERNAL_URL ??
      'http://localhost:3333'
    ).replace(/\/$/, ''),
  },
});
