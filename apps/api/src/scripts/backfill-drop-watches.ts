/**
 * Give existing Drops the Watch they are about.
 *
 * Dry run by default — prints every assignment it would make and changes
 * nothing:
 *
 *   pnpm --filter @crown-watch/api backfill:drop-watches
 *
 * Add --confirm to apply. Read the dry run first.
 *
 * **This assigns; it never merges and never deletes.** The three YEMA Drops
 * from 2026-08-06 stay three rows and gain one shared `watch_id`. Collapsing
 * them would cascade their `drop_broadcasts` rows — the only evidence those
 * messages were sent — and make the watch a backfill candidate all over again
 * (ADR-0002, ADR-0003).
 *
 * A Drop with no `source_url`, or one whose store product no longer exists, is
 * left with a null `watch_id`. That is the expected outcome for anything read
 * out of a publication's prose, not a failure.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DropWatchBackfillService } from '../drops/drop-watch-backfill.service';
import { databaseHost } from '../prisma/local-database';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const logger = new Logger('backfill:drop-watches');
  const confirm = flag('confirm');

  // Says out loud which database is about to be changed. This script is meant
  // to be pointed at production, so the one thing it must never do is leave the
  // operator guessing which one they hit.
  logger.log(
    `Database: ${databaseHost(process.env.DATABASE_URL) ?? '(none configured)'}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(DropWatchBackfillService).backfill({ confirm });

    const byWatch = new Map<string, number>();
    for (const a of result.assignments) {
      const label = `${a.brandName} — ${a.watchName}`;
      byWatch.set(label, (byWatch.get(label) ?? 0) + 1);
    }

    process.stdout.write(`\nDrops with no watch: ${result.withoutWatch}\n`);
    process.stdout.write(`Assignable: ${result.assignments.length}\n`);
    process.stdout.write(
      `Left alone (no store product to match): ${result.unresolved}\n`,
    );
    process.stdout.write(
      `Broadcast records to be preserved: ${result.broadcastRowsBefore}\n\n`,
    );

    // Sorted by how many Drops collapse onto one Watch, because that count is
    // the thing worth eyeballing: a watch claiming dozens is a grouping bug,
    // not a busy model.
    for (const [watch, count] of [...byWatch].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(count).padStart(4)}  ${watch}\n`);
    }

    if (result.dryRun) {
      process.stdout.write(
        '\nDry run — nothing changed. Re-run with --confirm to apply.\n',
      );
    } else {
      process.stdout.write(
        `\nAssigned ${result.assigned} drop(s). ` +
          `${result.broadcastRowsAfter} broadcast record(s) intact.\n`,
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
