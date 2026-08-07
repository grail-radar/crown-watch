/**
 * Runs once, before Jest loads a single test file.
 *
 * `globalSetup` rather than `setupFiles`: this has to be able to stop the run,
 * and it has to do so before any spec has had the chance to open a connection.
 *
 * It reads DATABASE_URL exactly the way the tests will — dotenv over
 * `apps/api/.env`, with an already-set environment variable winning, which is
 * what `test/setup.ts` does per file and what the generated Prisma client reads
 * when a spec constructs `PrismaService`. Checking a different value from the
 * one that will actually be connected to would be worse than not checking.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { assertLocalDatabase } from '../src/prisma/local-database';

export default function globalSetup(): void {
  config({ path: resolve(__dirname, '..', '.env'), quiet: true });
  assertLocalDatabase(process.env.DATABASE_URL);
}
