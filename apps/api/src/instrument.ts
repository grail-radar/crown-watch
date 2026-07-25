/**
 * Sentry initialisation. MUST be imported before anything else in main.ts so
 * the SDK can instrument Nest/HTTP before modules load.
 *
 * No-ops entirely when SENTRY_DSN is unset, so local dev and unconfigured
 * deployments behave exactly as before.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
    // Keep free-tier quota healthy: errors always, traces sampled lightly.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

export const sentryEnabled = Boolean(dsn);
