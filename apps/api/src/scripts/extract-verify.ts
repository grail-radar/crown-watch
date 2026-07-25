/**
 * Persistence smoke test for the extraction stage — no Anthropic API key needed.
 *
 * Feeds a canned extraction result through ExtractionService.persistExtraction
 * against a throwaway source + raw event, asserts a brand and a pending drop are
 * created and the event is marked processed, then cleans everything up.
 *
 *   pnpm --filter @crown-watch/api extract:verify
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExtractionService } from '../extraction/extraction.service';
import { ExtractionResult } from '../extraction/extraction.types';
import { PrismaService } from '../prisma/prisma.service';

async function main(): Promise<void> {
  const logger = new Logger('extract:verify');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const extraction = app.get(ExtractionService);

  const tag = `verify-${Date.now()}`;
  let ok = false;

  try {
    // Arrange — a throwaway source and one unprocessed raw event.
    const source = await prisma.source.create({
      data: { type: 'manual', name: 'extraction-verify', endpoint: `verify://${tag}` },
    });
    const rawEvent = await prisma.rawIngestionEvent.create({
      data: {
        sourceId: source.id,
        contentHash: tag,
        processed: false,
        rawPayload: {
          title: 'Verify Watch Co launches the Verifier on Kickstarter',
        },
      },
    });

    const canned: ExtractionResult = {
      is_watch_related: true,
      is_independent_microbrand: true,
      is_drop_event: true,
      brand_name: `Verify Watch Co ${tag}`,
      model_title: 'The Verifier',
      drop_type: 'kickstarter_launch',
      price_low: 299,
      price_high: 349,
      currency: 'USD',
      event_date: '2026-08-01',
      confidence: 0.92,
    };

    // Act
    const outcome = await extraction.persistExtraction(rawEvent, canned);

    // Assert
    const brand = await prisma.brand.findFirst({
      where: { name: canned.brand_name ?? undefined },
    });
    const drop = await prisma.drop.findFirst({
      where: { sourceEventId: rawEvent.id },
    });
    const reloaded = await prisma.rawIngestionEvent.findUnique({
      where: { id: rawEvent.id },
    });

    process.stdout.write(
      JSON.stringify(
        {
          outcome,
          brandCreated: !!brand,
          brandStatus: brand?.status ?? null,
          dropCreated: !!drop,
          dropType: drop?.type ?? null,
          dropModeration: drop?.moderationStatus ?? null,
          dropPrice: drop
            ? `${drop.priceLow}-${drop.priceHigh} ${drop.currency}`
            : null,
          dropConfidence: drop?.confidenceScore ?? null,
          eventProcessed: reloaded?.processed ?? null,
        },
        null,
        2,
      ) + '\n',
    );

    ok =
      outcome.brandUpserted &&
      outcome.dropCreated &&
      !!brand &&
      !!drop &&
      reloaded?.processed === true;

    // Cleanup — deleting the brand cascades its drops; deleting the source
    // cascades its raw events.
    if (brand) await prisma.brand.delete({ where: { id: brand.id } });
    await prisma.source.delete({ where: { id: source.id } });
  } finally {
    await app.close();
  }

  logger.warn(
    ok
      ? 'PERSIST VERIFY: OK (raw event -> brand + pending drop, event processed)'
      : 'PERSIST VERIFY: FAILED',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
