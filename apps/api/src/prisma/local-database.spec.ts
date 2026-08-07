/**
 * The guard that keeps a test run off a real database — pure, no I/O.
 *
 * Written as a table of cases because the interesting ones are all near-misses:
 * a connection string that *mentions* localhost somewhere is not a connection
 * to localhost, and that distinction is the whole point of the check.
 *
 * On 2026-08-07 a test run against production Neon overwrote four stores'
 * stored snapshots with fixture data. The next scheduled poll compared each
 * store's real catalogue against that fixture, concluded every product was new,
 * and published 372 drops to two public channels that cannot unsend.
 */
import globalSetup from '../../test/global-setup';
import { assertLocalDatabase, databaseHost, isLocalDatabase } from './local-database';

describe('isLocalDatabase', () => {
  it.each([
    'postgresql://crownwatch:crownwatch@localhost:5434/crownwatch?schema=public',
    'postgresql://user:pass@127.0.0.1:5432/db',
    'postgres://user:pass@localhost/db',
    'postgresql://user:pass@[::1]:5432/db',
  ])('accepts a local database (%s)', (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    'postgresql://u:p@ep-delicate-wildflower-pooler.eu-central-1.aws.neon.tech/db',
    'postgresql://u:p@db.example.com:5432/crownwatch',
    'postgresql://u:p@10.0.0.5:5432/db',
  ])('refuses a remote database (%s)', (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });

  it('is not fooled by "localhost" in the password', () => {
    // The near-miss that a substring check would wave through.
    expect(isLocalDatabase('postgresql://user:localhost@neon.tech/db')).toBe(false);
  });

  it('is not fooled by "localhost" in the database name', () => {
    expect(isLocalDatabase('postgresql://u:p@neon.tech:5432/localhost')).toBe(false);
  });

  it('is not fooled by "localhost" in a query parameter', () => {
    expect(
      isLocalDatabase('postgresql://u:p@neon.tech:5432/db?options=localhost'),
    ).toBe(false);
  });

  it('is not fooled by a hostname that merely ends in localhost', () => {
    expect(isLocalDatabase('postgresql://u:p@evil-localhost/db')).toBe(false);
    expect(isLocalDatabase('postgresql://u:p@localhost.evil.com/db')).toBe(false);
  });

  it('refuses a connection string it cannot parse', () => {
    // Unprovable is not the same as safe. If the host cannot be established,
    // the run must not proceed on the assumption that it is fine.
    expect(isLocalDatabase('not a url at all')).toBe(false);
    expect(isLocalDatabase('')).toBe(false);
  });
});

describe('databaseHost', () => {
  it('reports the host so a failure can name what it refused', () => {
    expect(
      databaseHost('postgresql://u:p@ep-wildflower-pooler.aws.neon.tech:5432/db'),
    ).toBe('ep-wildflower-pooler.aws.neon.tech');
  });

  it('reports nothing for a string it cannot parse', () => {
    expect(databaseHost('nonsense')).toBeNull();
  });
});

describe('assertLocalDatabase', () => {
  it('lets a local run through', () => {
    expect(() =>
      assertLocalDatabase('postgresql://u:p@localhost:5434/crownwatch'),
    ).not.toThrow();
  });

  it('allows a run with no database configured at all', () => {
    // Nothing to connect to is not a hazard, and pure specs should still run
    // in a checkout that has never had an .env.
    expect(() => assertLocalDatabase(undefined)).not.toThrow();
    expect(() => assertLocalDatabase('')).not.toThrow();
  });

  it('names the host it refused, so the cause is the first thing you read', () => {
    expect(() =>
      assertLocalDatabase('postgresql://u:p@ep-wildflower.aws.neon.tech/db'),
    ).toThrow(/ep-wildflower\.aws\.neon\.tech/);
  });

  it('never puts the credentials in the message', () => {
    // The failure goes to a terminal and, in CI, to a public build log.
    const url = 'postgresql://admin:s3cr3t-password@db.example.com/crownwatch';

    expect(() => assertLocalDatabase(url)).toThrow();
    try {
      assertLocalDatabase(url);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('s3cr3t-password');
      expect(message).not.toContain('admin');
      expect(message).toContain('db.example.com');
    }
  });

  it('says how to fix it', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@neon.tech/db')).toThrow(
      /DATABASE_URL/,
    );
  });
});

/**
 * The wiring, not just the rule.
 *
 * The pure checks above prove the *decision* is right; these prove the thing
 * Jest actually calls reaches that decision, reading the same environment
 * variable the specs will connect with. Without this, the guard could be
 * silently disconnected — a renamed export, a dropped `globalSetup` key — and
 * every test above would still pass.
 */
describe('the guard Jest runs before the suite', () => {
  const saved = process.env.DATABASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it('aborts the run when the database is remote', () => {
    // dotenv never overwrites an already-set variable, so this is exactly what
    // happens when someone's shell exports a production URL.
    process.env.DATABASE_URL =
      'postgresql://u:p@ep-not-a-real-host.aws.neon.tech:5432/crownwatch';

    expect(() => globalSetup()).toThrow(/ep-not-a-real-host\.aws\.neon\.tech/);
  });

  it('lets the run proceed against a local database', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5434/crownwatch';

    expect(() => globalSetup()).not.toThrow();
  });
});
