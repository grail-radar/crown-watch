/**
 * Delete the Telegram posts belonging to drops that have been retracted.
 *
 * Dry run by default — reports what it would remove and touches nothing:
 *
 *   pnpm --filter @crown-watch/api purge:broadcasts
 *   pnpm --filter @crown-watch/api purge:broadcasts -- --since=2026-08-07T12:00:00Z
 *
 * Add --confirm to delete.
 *
 * **Telegram only allows a post to be deleted for 48 hours.** After that the
 * channel keeps it whatever we do, and this script will report every batch as
 * failed. It is a narrow window for correcting a mistake, not an edit facility.
 *
 * Deleting a post does not unsend the notification. Everyone who was going to
 * see it has seen it; this only stops it sitting in the channel's history.
 *
 * The `drop_broadcasts` rows are never removed — they are what makes
 * "at most once, ever" true (ADR-0002), and keeping them is also what makes
 * this safe to re-run.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BroadcastPurgeService } from '../alerts/broadcast-purge.service';
import { AppModule } from '../app.module';
import { databaseHost } from '../prisma/local-database';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function dateOption(name: string): Date | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--${name}="${raw}" is not a date I can read`);
  }
  return date;
}

async function main(): Promise<void> {
  const logger = new Logger('purge:broadcasts');
  const confirm = flag('confirm');

  logger.log(
    `Database: ${databaseHost(process.env.DATABASE_URL) ?? '(none configured)'}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app.get(BroadcastPurgeService).purge({
      confirm,
      since: dateOption('since'),
      until: dateOption('until'),
    });

    process.stdout.write(`\nPosts belonging to retracted drops: ${result.posts}\n\n`);
    for (const channel of result.channels) {
      const outcome = result.dryRun
        ? `${channel.posts} to delete`
        : `${channel.deleted} deleted, ${channel.failed} failed${channel.error ? ` — ${channel.error}` : ''}`;
      process.stdout.write(`  ${channel.chatId.padEnd(24)} ${outcome}\n`);
      if (channel.failedIds.length > 0) {
        process.stdout.write(
          `      message ids that would not delete: ${channel.failedIds.join(', ')}${channel.failed > channel.failedIds.length ? ', …' : ''}\n`,
        );
      }
    }

    if (result.dryRun) {
      process.stdout.write('\nDry run — nothing deleted. Re-run with --confirm.\n');
    } else {
      process.stdout.write(
        `\nDeleted ${result.deleted}, failed ${result.failed}. Broadcast records left intact.\n`,
      );
      if (result.failed > 0) {
        process.stdout.write(
          'Failures are usually the 48-hour limit: Telegram will not delete a post older than that.\n',
        );
      }
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
