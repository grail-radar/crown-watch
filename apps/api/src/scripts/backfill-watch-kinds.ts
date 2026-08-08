/**
 * Classify the Watches recorded before there was such a thing as a kind.
 *
 * Dry run by default — prints every reclassification it would make and changes
 * nothing:
 *
 *   pnpm --filter @crown-watch/api backfill:watch-kinds
 *
 * Add --confirm to apply. Read the dry run first.
 *
 * Every row predating this defaulted to `watch`. Until they say otherwise, the
 * accessory Drops already on the public feed cannot be found (ADR-0006).
 *
 * **It never touches `kind_override`.** A Watch an operator has ruled on keeps
 * that ruling.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { databaseHost } from '../prisma/local-database';
import { WatchKindBackfillService } from '../site-watch/watch-kind-backfill.service';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const logger = new Logger('backfill:watch-kinds');
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
    const result = await app.get(WatchKindBackfillService).backfill({ confirm });

    const toAccessory = result.changes.filter((c) => c.to === 'accessory');
    const toWatch = result.changes.filter((c) => c.to === 'watch');

    process.stdout.write(`\nWatches examined: ${result.examined}\n`);
    process.stdout.write(`Becoming accessories: ${toAccessory.length}\n`);
    process.stdout.write(`Becoming watches: ${toWatch.length}\n`);
    process.stdout.write(`Left to the operator's ruling: ${result.overridden}\n`);
    process.stdout.write(
      `Drops already announced about those accessories: ${result.accessoryDrops}\n\n`,
    );

    // Noisiest first: a reclassified Watch carrying Drops is one that reached
    // the Channels, and those are what the cleanup ticket retracts.
    for (const change of [...toAccessory].sort((a, b) => b.drops - a.drops)) {
      const drops = change.drops > 0 ? `  (${change.drops} drop(s))` : '';
      process.stdout.write(
        `  accessory  ${change.brandName} — ${change.name}${drops}\n`,
      );
    }
    for (const change of toWatch) {
      process.stdout.write(`  watch      ${change.brandName} — ${change.name}\n`);
    }

    if (result.dryRun) {
      process.stdout.write(
        '\nDry run — nothing changed. Re-run with --confirm to apply.\n',
      );
    } else {
      process.stdout.write(`\nReclassified ${result.updated} watch(es).\n`);
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
