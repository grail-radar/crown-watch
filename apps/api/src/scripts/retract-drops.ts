/**
 * Take drops off the public feed that should never have been announced.
 *
 * Dry run by default — prints every drop it would retract and changes nothing:
 *
 *   pnpm --filter @crown-watch/api retract:drops -- \
 *     --from=2026-08-07T12:31:00Z --to=2026-08-07T13:39:00Z
 *
 * Add --confirm to apply. Read the dry run first.
 *
 * **This retracts; it does not delete.** The drops stay in the database,
 * unpublished, and every `drop_broadcasts` row survives — those rows are the
 * only record that a message was sent, and destroying them is what would turn
 * the next backfill into a second incident (ADR-0002).
 *
 * Written for the 2026-08-07 incident: a test run against production overwrote
 * four stores' snapshots, and the next poll published 372 drops that were
 * already-existing catalogue, not releases.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DropRetractionService } from '../drops/drop-retraction.service';
import { databaseHost } from '../prisma/local-database';
import { flag, requireDate } from './args';

async function main(): Promise<void> {
  const logger = new Logger('retract:drops');
  const from = requireDate('from');
  const to = requireDate('to');
  const confirm = flag('confirm');

  // Says out loud which database is about to be changed. This script is meant
  // to be pointed at production, so the one thing it must never do is leave
  // the operator guessing which one they hit.
  logger.log(
    `Database: ${databaseHost(process.env.DATABASE_URL) ?? '(none configured)'}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(DropRetractionService).retract({
      from,
      to,
      confirm,
    });

    const byBrand = new Map<string, number>();
    for (const c of result.candidates) {
      byBrand.set(c.brandName, (byBrand.get(c.brandName) ?? 0) + 1);
    }

    process.stdout.write(`\nWindow: ${result.from} → ${result.to}\n`);
    process.stdout.write(`Drops in scope: ${result.candidateCount}\n`);
    process.stdout.write(
      `Broadcast records to be preserved: ${result.broadcastRows}\n\n`,
    );
    for (const [brand, count] of [...byBrand].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(count).padStart(4)}  ${brand}\n`);
    }

    process.stdout.write('\nFirst few:\n');
    for (const c of result.candidates.slice(0, 5)) {
      process.stdout.write(
        `  ${c.publishedAt}  ${c.brandName} — ${c.title}\n    ${c.sourceUrl ?? '(no url)'}\n`,
      );
    }

    if (result.dryRun) {
      process.stdout.write(
        '\nDry run — nothing changed. Re-run with --confirm to apply.\n',
      );
    } else {
      process.stdout.write(
        `\nRetracted ${result.retracted} drop(s). ${result.broadcastRows} broadcast record(s) intact.\n`,
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
