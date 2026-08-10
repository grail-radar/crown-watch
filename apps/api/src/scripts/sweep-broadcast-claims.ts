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
 *
 * This is tidying, not a fix. `purge:broadcasts` never trips over those rows:
 * it selects only claims whose Drop is `rejected` and unpublished, and these
 * point at live, published Drops. What they cost is that every broadcast count
 * includes them.
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
import { flag, options } from './args';

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

    // Printed before anything else: an empty list here would mean the guard
    // that stops this touching a live Channel had nothing to compare against.
    // The service refuses outright in that case, but an operator should be able
    // to see what it believes is live rather than trust that it looked.
    process.stdout.write(
      `\nChannels currently posted to: ${result.liveChannels.join(', ')}\n\n`,
    );
    for (const chat of result.chats) {
      process.stdout.write(
        `  ${chat.chatId.padEnd(24)} ${chat.claims} claim(s), ` +
          `${chat.sent} marked sent, across ${chat.drops} drop(s)\n`,
      );
      for (const drop of chat.listed) {
        process.stdout.write(`      ${drop.id}  ${drop.brand} — ${drop.title}\n`);
      }
      if (chat.drops > chat.listed.length) {
        process.stdout.write(`      …and ${chat.drops - chat.listed.length} more\n`);
      }
    }

    // Problems go to stderr. An operator watching a deploy log usually sees
    // stderr and skims stdout, and a refusal that scrolled past unread is the
    // same as no refusal at all.
    if (result.refused.length > 0) {
      process.stderr.write('\nRefused, and nothing was swept:\n');
      for (const { chatId, reason } of result.refused) {
        process.stderr.write(`  ${chatId} — ${reason}\n`);
      }
      process.exitCode = 1;
      return;
    }

    if (result.unmatched.length > 0) {
      process.stderr.write(
        `\nNo claims at all against: ${result.unmatched.join(', ')}\n` +
          'Check the spelling — a chat id that matches nothing looks the same as a finished job.\n',
      );
      // Exit non-zero when *nothing* named was there. The line above says a typo
      // is indistinguishable from a finished job; exiting 0 would make that true
      // of the exit code too. A partial match still succeeds. So does a re-run
      // after a sweep that worked — it names a chat and finds it empty, which is
      // the same signal and deserves the same answer: look.
      if (result.unmatched.length === result.chats.length) process.exitCode = 1;
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

    // Worth reading twice. The broadcast count should fall by exactly what was
    // deleted, and nothing else should have moved at all.
    //
    // Not a proof: these counts do not share a transaction with the delete, so
    // a poll running at the same moment moves `drops` and `sources` for
    // entirely legitimate reasons. A difference means look, not panic.
    const swept = before.broadcasts - after.broadcasts;
    const collateral =
      after.drops !== before.drops ||
      after.brands !== before.brands ||
      after.sources !== before.sources ||
      swept !== result.deleted;
    if (collateral) {
      process.stderr.write(
        `\nCHECK: expected the broadcast count to fall by exactly ${result.deleted} ` +
          `and nothing else to move; it fell by ${swept}. A poll running at the same ` +
          'time explains a change in drops or sources. Anything else is worth ' +
          'understanding before running this again.\n',
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
