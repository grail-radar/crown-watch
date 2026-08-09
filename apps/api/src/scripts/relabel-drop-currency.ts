/**
 * Re-derive the currency on Drops the watcher already published.
 *
 * Dry run by default — prints every relabel it would make and changes nothing:
 *
 *   pnpm --filter @crown-watch/api relabel:drop-currency
 *
 * Add --confirm to apply. Read the dry run first.
 *
 * **Run this after #24 has deployed and every store has been polled once.** The
 * answer is read from each Watch's Variants, and those only carry what the
 * store actually printed once a poll has rewritten them. Running it earlier
 * would clear labels the next poll could have confirmed.
 *
 * Evidence, not a blanket wipe: a Watch whose priced Variants agree on one
 * currency keeps it (Baltic prints `€ 640.00`, so its Drops stay `EUR`), and one
 * whose Variants no longer say anything is cleared (every Shopify-fed store).
 * Drops about no Watch are left alone entirely — an RSS-extracted Drop's
 * currency came out of a publication's prose, not the registration label.
 *
 * Nothing else is touched: no price, no publication state, no broadcast row.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DropCurrencyRelabelService } from '../drops/drop-currency-relabel.service';
import { databaseHost } from '../prisma/local-database';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const logger = new Logger('relabel:drop-currency');
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
    const result = await app.get(DropCurrencyRelabelService).relabel({ confirm });

    const cleared = result.changes.filter((c) => c.to === null);
    const corrected = result.changes.filter((c) => c.to !== null);

    process.stdout.write(`\nDrops about a Watch: ${result.examined}\n`);
    process.stdout.write(`Losing a label we cannot stand behind: ${cleared.length}\n`);
    process.stdout.write(`Getting a corrected label: ${corrected.length}\n`);
    process.stdout.write(
      `Left alone (about no Watch — RSS): ${result.skippedWithoutWatch}\n\n`,
    );

    for (const change of result.changes) {
      const to = change.to ?? '(none)';
      process.stdout.write(
        `  ${change.from ?? '(none)'} → ${to}  ${change.brandName} — ${change.title}\n` +
          `      ${change.because}\n`,
      );
    }

    if (result.dryRun) {
      process.stdout.write(
        '\nDry run — nothing changed. Re-run with --confirm to apply.\n',
      );
    } else {
      process.stdout.write(`\nRelabelled ${result.updated} drop(s).\n`);
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
