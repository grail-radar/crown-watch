/**
 * Backfill the Telegram channels with drops already published on the site.
 *
 * Dry run by default — prints every message it would post and sends nothing:
 *
 *   pnpm --filter @crown-watch/api backfill:telegram
 *   pnpm --filter @crown-watch/api backfill:telegram -- --limit=25
 *
 * Add --confirm to actually post. Read the dry run first: a channel cannot
 * unsend, and its followers get a notification per message.
 *
 *   pnpm --filter @crown-watch/api backfill:telegram -- --confirm --limit=5
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AlertDispatchService } from '../alerts/alert-dispatch.service';
import { AppModule } from '../app.module';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): number | undefined {
  const raw = process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')[1];
  const parsed = raw === undefined ? NaN : parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const logger = new Logger('backfill:telegram');
  const confirm = flag('confirm');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const alerts = app.get(AlertDispatchService);
    const result = await alerts.backfill({ confirm, limit: option('limit') });

    for (const candidate of result.candidates) {
      const when = candidate.publishedAt?.slice(0, 10) ?? 'unpublished';
      logger.log(
        `${when}  ${candidate.brandName} — ${candidate.title}  → ${candidate.pendingLocales.join(', ')}`,
      );
      if (!confirm) {
        for (const message of candidate.messages) {
          process.stdout.write(`\n--- ${message.locale} (${message.channel}) ---\n`);
          process.stdout.write(`${message.text}\n`);
        }
        process.stdout.write('\n');
      }
    }

    if (result.status !== 'dispatched') {
      logger.warn(`${result.status}: ${result.reason ?? 'no reason given'}`);
    } else if (result.dryRun) {
      logger.log(
        `Dry run: ${result.candidateCount} drop(s) pending. Re-run with --confirm to post.`,
      );
    } else {
      logger.log(
        `Posted ${result.sentCount} message(s) across ${result.candidateCount} drop(s).`,
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
    console.error(err);
    process.exit(1);
  });
