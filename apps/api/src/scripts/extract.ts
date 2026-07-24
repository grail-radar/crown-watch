/**
 * Standalone extraction runner.
 *
 * Boots a headless Nest context, runs one extraction pass over unprocessed
 * raw_ingestion_events, prints a JSON summary, and exits.
 *
 *   pnpm --filter @crown-watch/api extract
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExtractionService } from '../extraction/extraction.service';

async function main(): Promise<void> {
  const logger = new Logger('extract');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const extraction = app.get(ExtractionService);
    const result = await extraction.runExtraction();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.enabled) {
      logger.warn('Set ANTHROPIC_API_KEY to enable extraction.');
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
