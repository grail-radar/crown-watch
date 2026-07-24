export interface AppConfig {
  nodeEnv: string;
  port: number;
  webOrigin: string | undefined;
  database: { url: string | undefined };
  redis: { url: string | undefined };
  rss: {
    pollCron: string;
    pollOnBoot: boolean;
    userAgent: string;
    requestTimeoutMs: number;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3333', 10),
  webOrigin: process.env.WEB_ORIGIN,
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
});
