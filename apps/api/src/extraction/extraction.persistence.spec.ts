/**
 * Persistence tests for the extraction write path.
 *
 * These drive the real ExtractionService against a real Postgres — the same
 * arrange / act / assert / clean-up shape as the `extract-verify` script, which
 * this replaces. The Anthropic client is never involved: `persistExtraction`
 * takes an already-formed extraction result, so no API key is needed and the
 * tests are deterministic.
 *
 * Requires a database (docker-compose locally, a service container in CI).
 */
import { ConfigService } from '@nestjs/config';
import { SourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from './anthropic.service';
import { ExtractionService } from './extraction.service';
import { ExtractionResult } from './extraction.types';

const result = (over: Partial<ExtractionResult> = {}): ExtractionResult => ({
  is_watch_related: true,
  is_independent_microbrand: true,
  is_drop_event: true,
  brand_name: 'Test Microbrand',
  model_title: 'The Prototype',
  drop_type: 'pre_order',
  price_low: 499,
  price_high: 549,
  currency: 'usd',
  event_date: '2026-09-01',
  promised_ship_date: '2026-12-01',
  brand_country: 'France',
  brand_website: 'https://example.com',
  brand_founded_year: 2016,
  confidence: 0.9,
  ...over,
});

describe('ExtractionService persistence', () => {
  let prisma: PrismaService;
  let service: ExtractionService;
  const createdSourceIds: string[] = [];
  const createdBrandSlugs: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const config = new ConfigService({ anthropic: { maxItemsPerRun: 25 } });
    // Extraction is never called on this path; only persistence is exercised.
    service = new ExtractionService(
      prisma,
      new AnthropicService(config),
      config,
      new DropWriterService(prisma),
    );
  });

  afterAll(async () => {
    if (createdBrandSlugs.length) {
      await prisma.drop.deleteMany({
        where: { brand: { slug: { in: createdBrandSlugs } } },
      });
      await prisma.brand.deleteMany({ where: { slug: { in: createdBrandSlugs } } });
    }
    if (createdSourceIds.length) {
      await prisma.rawIngestionEvent.deleteMany({
        where: { sourceId: { in: createdSourceIds } },
      });
      await prisma.source.deleteMany({ where: { id: { in: createdSourceIds } } });
    }
    await prisma.$disconnect();
  });

  /** A throwaway source + unprocessed raw event, unique per test. */
  async function arrangeRawEvent(title = 'A new watch') {
    const tag = randomUUID();
    const source = await prisma.source.create({
      data: {
        type: SourceType.manual,
        name: 'jest fixture',
        endpoint: `test://${tag}`,
      },
    });
    createdSourceIds.push(source.id);
    return prisma.rawIngestionEvent.create({
      data: {
        sourceId: source.id,
        contentHash: tag,
        processed: false,
        rawPayload: { title, link: 'https://example.com/article' },
      },
    });
  }

  function uniqueBrand(prefix: string): string {
    const name = `${prefix} ${randomUUID().slice(0, 8)}`;
    createdBrandSlugs.push(
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    );
    return name;
  }

  it('creates the brand and a pending drop, and marks the event processed', async () => {
    const rawEvent = await arrangeRawEvent();
    const brandName = uniqueBrand('Persist Co');

    const outcome = await service.persistExtraction(
      rawEvent,
      result({ brand_name: brandName }),
    );

    expect(outcome).toEqual({
      brandUpserted: true,
      dropCreated: true,
      skipped: false,
    });

    const drop = await prisma.drop.findFirst({
      where: { sourceEventId: rawEvent.id },
      include: { brand: true },
    });
    expect(drop?.brand.name).toBe(brandName);
    expect(drop?.title).toBe('The Prototype');
    expect(drop?.type).toBe('pre_order');
    // Nothing reaches the public feed without moderation (CONTEXT.md §5).
    expect(drop?.moderationStatus).toBe('pending');
    expect(drop?.publishedAt).toBeNull();
    expect(drop?.currency).toBe('USD');
    expect(Number(drop?.priceLow)).toBe(499);
    expect(drop?.promisedShipDate).not.toBeNull();

    const reloaded = await prisma.rawIngestionEvent.findUnique({
      where: { id: rawEvent.id },
    });
    expect(reloaded?.processed).toBe(true);
  });

  it('records brand metadata on first sight', async () => {
    const rawEvent = await arrangeRawEvent();
    const brandName = uniqueBrand('Metadata Co');

    await service.persistExtraction(rawEvent, result({ brand_name: brandName }));

    const brand = await prisma.brand.findFirst({ where: { name: brandName } });
    expect(brand?.country).toBe('France');
    expect(brand?.website).toBe('https://example.com');
    expect(brand?.foundedYearEst).toBe(2016);
    expect(brand?.status).toBe('watchlist');
  });

  it('skips established majors instead of listing them as microbrands', async () => {
    const rawEvent = await arrangeRawEvent('Rolex announces something');

    const outcome = await service.persistExtraction(
      rawEvent,
      result({ is_independent_microbrand: false, brand_name: 'Rolex' }),
    );

    expect(outcome.skipped).toBe(true);
    expect(outcome.brandUpserted).toBe(false);
    expect(
      await prisma.drop.count({ where: { sourceEventId: rawEvent.id } }),
    ).toBe(0);
    // Still consumed, so it is never reconsidered.
    const reloaded = await prisma.rawIngestionEvent.findUnique({
      where: { id: rawEvent.id },
    });
    expect(reloaded?.processed).toBe(true);
  });

  it('records a brand without a drop when the article is not a drop event', async () => {
    const rawEvent = await arrangeRawEvent('A review, not a launch');
    const brandName = uniqueBrand('Review Only Co');

    const outcome = await service.persistExtraction(
      rawEvent,
      result({ brand_name: brandName, is_drop_event: false, drop_type: null }),
    );

    expect(outcome.brandUpserted).toBe(true);
    expect(outcome.dropCreated).toBe(false);
    expect(await prisma.brand.count({ where: { name: brandName } })).toBe(1);
  });

  it('does not create a second drop for the same raw event', async () => {
    const rawEvent = await arrangeRawEvent();
    const brandName = uniqueBrand('Idempotent Co');

    await service.persistExtraction(rawEvent, result({ brand_name: brandName }));
    const second = await service.persistExtraction(
      rawEvent,
      result({ brand_name: brandName }),
    );

    expect(second.dropCreated).toBe(false);
    expect(
      await prisma.drop.count({ where: { sourceEventId: rawEvent.id } }),
    ).toBe(1);
  });

  it('rejects an implausible website and founding year rather than storing them', async () => {
    const rawEvent = await arrangeRawEvent();
    const brandName = uniqueBrand('Bad Metadata Co');

    await service.persistExtraction(
      rawEvent,
      result({
        brand_name: brandName,
        brand_website: 'not-a-url',
        brand_founded_year: 3000,
      }),
    );

    const brand = await prisma.brand.findFirst({ where: { name: brandName } });
    expect(brand?.website).toBeNull();
    expect(brand?.foundedYearEst).toBeNull();
  });
});
