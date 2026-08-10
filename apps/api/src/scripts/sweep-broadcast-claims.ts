/**
 * Delete `drop_broadcasts` rows claimed against a Channel that never existed.
 *
 * Dry run by default — prints what it would delete and changes nothing:
 *
 *   pnpm --filter @crown-watch/api sweep:claims -- --chat=@crownwatch_ua_v2
 *
 * Add --confirm to apply. Read the dry run first.
 *
 * **This deletes the rows that make "at most once, ever" true (ADR-0002),** and
 * that is only ever correct where the claim records a message that was never
 * sent. Written for #48: on 2026-08-07 the tests ran against production and
 * `@crownwatch_ua_v2` — a chat that exists only in a spec — took 30 claims.
 * `purge:broadcasts` fails on them with "chat not found" on every run.
 *
 * A chat id the dispatcher currently posts to is refused outright, so this
 * cannot be pointed at a live Channel by accident.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BroadcastClaimSweepService } from '../alerts/broadcast-claim-sweep.service';
import { AppModule } from '../app.module';
import { databaseHost } from '../prisma/local-database';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Repeatable: --chat=a --chat=b. */
function options(name: string): string[] {
  return process.argv
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.split('=').slice(1).join('='));
}

async function main(): Promise<void> {
  const logger = new Logger('sweep:claims');
  const chatIds = options('chat');
  const confirm = flag('confirm');

  if (chatIds.length === 0) {
    throw new Error(
      'Name the chat(s) to sweep, e.g. --chat=@crownwatch_ua_v2. ' +
        'There is deliberately no "all" — see ADR-0002.',
    );
  }

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
    const result = await app
      .get(BroadcastClaimSweepService)
      .sweep({ chatIds, confirm });

    process.stdout.write('\n');
    for (const channel of result.channels) {
      process.stdout.write(
        `  ${channel.chatId.padEnd(24)} ${channel.claims} claim(s), ` +
          `${channel.sent} marked sent, across ${channel.drops} drop(s)\n`,
      );
      for (const drop of channel.sample) {
        process.stdout.write(`      ${drop.brand} — ${drop.title}\n`);
      }
      if (channel.drops > channel.sample.length) {
        process.stdout.write(
          `      …and ${channel.drops - channel.sample.length} more\n`,
        );
      }
    }

    if (result.unmatched.length > 0) {
      process.stdout.write(
        `\nNo claims at all against: ${result.unmatched.join(', ')}\n` +
          'Check the spelling — a chat id that matches nothing looks the same as a finished job.\n',
      );
    }

    if (result.refused.length > 0) {
      process.stdout.write('\nRefused, and nothing was swept:\n');
      for (const { chatId, reason } of result.refused) {
        process.stdout.write(`  ${chatId} — ${reason}\n`);
      }
      process.exitCode = 1;
      return;
    }

    const { before, after } = result.counts;
    if (!result.confirmed) {
      process.stdout.write('\nDry run — nothing deleted. Re-run with --confirm.\n');
      return;
    }

    process.stdout.write(
      `\nDeleted ${result.deleted} broadcast claim(s).\n` +
        `  drops       ${before.drops} → ${after.drops}\n` +
        `  brands      ${before.brands} → ${after.brands}\n` +
        `  sources     ${before.sources} → ${after.sources}\n` +
        `  broadcasts  ${before.broadcasts} → ${after.broadcasts}\n`,
    );

    // The one line worth reading twice. Everything except the broadcast count
    // must be unchanged; if it is not, something reached further than it was
    // asked to and that is worth knowing before the terminal scrolls.
    const collateral =
      after.drops !== before.drops ||
      after.brands !== before.brands ||
      after.sources !== before.sources;
    if (collateral) {
      process.stdout.write(
        '\nWARNING: something other than broadcast claims changed. Investigate before running this again.\n',
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
