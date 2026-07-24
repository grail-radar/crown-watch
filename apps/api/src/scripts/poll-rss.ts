/**
 * Standalone Tier 1 RSS poll runner.
 *
 * Boots a headless Nest application context (no HTTP server), runs one full RSS
 * poll across all configured sources, prints a JSON summary, and exits. Used
 * for end-to-end verification and as a cron-friendly one-shot.
 *
 *   pnpm --filter @crown-watch/api ingest:rss
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

async function main(): Promise<void> {
  const logger = new Logger('ingest:rss');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const ingestion = app.get(IngestionService);
    const result = await ingestion.pollAllRssSources();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    logger.log(
      `Done: inserted=${result.totalInserted} skipped=${result.totalSkipped} fetched=${result.totalFetched}`,
    );
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
