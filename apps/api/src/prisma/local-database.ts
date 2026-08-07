/**
 * Is this connection string pointing at a database it is safe to destroy?
 *
 * Exists because of a specific, expensive mistake. On 2026-08-07 the test suite
 * was run in a checkout whose `.env` carried the production Neon URL. The
 * site-watch specs wrote their fixture products over four real stores' stored
 * snapshots; an hour later the scheduled poll compared each store's genuine
 * catalogue against that fixture, decided every product was new, and published
 * 372 drops to two public channels that cannot unsend (ADR-0002).
 *
 * The obvious control — "don't point your .env at production" — is not
 * available. The main checkout *legitimately* holds production credentials, for
 * Prisma Studio, the backfill script and the Telegram tooling. So the guard has
 * to live somewhere it cannot be forgotten, and it has to be exact: a URL that
 * merely mentions localhost in a password, a database name or a query parameter
 * is not a connection to localhost.
 */

/**
 * Hosts that can only mean this machine.
 *
 * `0.0.0.0` is deliberately absent: as a connect target it usually resolves
 * locally, but it means "all interfaces" and is unusual enough in a connection
 * string that refusing it is the safer reading.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The host a connection string would actually connect to, or null when that
 * cannot be established.
 *
 * Parsed rather than pattern-matched. Every near-miss this guard exists to
 * catch — credentials, database names, query parameters — is something a
 * substring search would trip over and a parser will not.
 */
export function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}

/** True only when the connection string provably points at this machine. */
export function isLocalDatabase(url: string | undefined): boolean {
  const host = databaseHost(url);
  return host !== null && LOCAL_HOSTS.has(host.toLowerCase());
}

/**
 * Throw unless the database is local — or unset.
 *
 * An unset `DATABASE_URL` is allowed on purpose: there is nothing to connect
 * to, so there is nothing to damage, and pure specs should still run in a fresh
 * checkout that has never had an `.env`. A URL that cannot be parsed is *not*
 * allowed, because unprovable is not the same as safe.
 */
export function assertLocalDatabase(url: string | undefined): void {
  if (!url) return;
  if (isLocalDatabase(url)) return;

  // The host, never the URL: this message reaches a terminal and, in CI, a
  // public build log — and the string it is complaining about contains a
  // password.
  const host = databaseHost(url) ?? 'an address that could not be parsed';

  throw new Error(
    [
      `Refusing to run tests against ${host}.`,
      '',
      'The suite writes and deletes rows, and it overwrites site-watch',
      'snapshots — which is how 372 drops were once published to two public',
      'channels that cannot unsend.',
      '',
      'Point DATABASE_URL at a local database (localhost or 127.0.0.1) before',
      'running tests. In this repo that is `docker compose up -d`, then the',
      'DATABASE_URL in apps/api/.env.example.',
    ].join('\n'),
  );
}
