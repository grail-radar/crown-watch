import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DropType,
  ModerationStatus,
  Prisma,
  RawIngestionEvent,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from './anthropic.service';
import { ExtractionResult } from './extraction.types';
import { extractMediaFromPayload } from './media';
import { slugify } from './slug';

export interface PersistOutcome {
  brandUpserted: boolean;
  dropCreated: boolean;
  skipped: boolean;
}

export interface ExtractionRunResult {
  enabled: boolean;
  processed: number;
  brandsUpserted: number;
  dropsCreated: number;
  skipped: number;
  errors: number;
}

const DROP_TYPES = new Set<string>([
  'kickstarter_launch',
  'waitlist_open',
  'restock',
  'pre_order',
]);

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Process unprocessed raw_ingestion_events: extract structured facts via the
   * Anthropic API, discover/attach brands, and land candidate drops in the
   * moderation queue (moderation_status = pending). Nothing is published here.
   */
  async runExtraction(limit?: number): Promise<ExtractionRunResult> {
    const result: ExtractionRunResult = {
      enabled: this.anthropic.isEnabled(),
      processed: 0,
      brandsUpserted: 0,
      dropsCreated: 0,
      skipped: 0,
      errors: 0,
    };

    if (!result.enabled) {
      this.logger.warn('Extraction skipped: ANTHROPIC_API_KEY not configured.');
      return result;
    }

    const take =
      limit ?? this.config.get<number>('anthropic.maxItemsPerRun') ?? 25;
    const events = await this.prisma.rawIngestionEvent.findMany({
      where: { processed: false },
      orderBy: { fetchedAt: 'asc' },
      take,
    });
    this.logger.log(`Extracting from ${events.length} unprocessed event(s)`);

    for (const event of events) {
      try {
        const payload = event.rawPayload as Record<string, unknown> | null;
        const extraction = await this.anthropic.extract({
          title: (payload?.title as string) ?? null,
          snippet:
            (payload?.contentSnippet as string) ??
            (payload?.content as string) ??
            null,
          link: (payload?.link as string) ?? null,
        });

        if (!extraction) {
          // No structured output — leave unprocessed for a later retry.
          continue;
        }

        const outcome = await this.persistExtraction(event, extraction);
        result.processed += 1;
        if (outcome.brandUpserted) result.brandsUpserted += 1;
        if (outcome.dropCreated) result.dropsCreated += 1;
        if (outcome.skipped) result.skipped += 1;
      } catch (err) {
        result.errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Extraction failed for event ${event.id}: ${message}`);
      }
    }

    this.logger.log(
      `Extraction complete: processed=${result.processed} brands=${result.brandsUpserted} drops=${result.dropsCreated} skipped=${result.skipped} errors=${result.errors}`,
    );
    return result;
  }

  /**
   * Persist one extraction result. Idempotent per raw event: a drop is only
   * created once per source_event_id, and the event is always marked processed.
   * Kept public so it can be exercised without hitting the Anthropic API.
   */
  async persistExtraction(
    rawEvent: RawIngestionEvent,
    result: ExtractionResult,
  ): Promise<PersistOutcome> {
    // Only independent microbrands enter the directory — majors (Rolex, Seiko,
    // JLC…) and non-watch items are dropped (just marked processed).
    if (
      !result.is_watch_related ||
      !result.is_independent_microbrand ||
      !result.brand_name
    ) {
      await this.prisma.rawIngestionEvent.update({
        where: { id: rawEvent.id },
        data: { processed: true },
      });
      return { brandUpserted: false, dropCreated: false, skipped: true };
    }

    const brandName = result.brand_name.trim();
    const slug = slugify(brandName);

    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.upsert({
        where: { slug },
        update: {},
        create: { name: brandName, slug },
      });

      let dropCreated = false;
      const dropType = this.toDropType(result.drop_type);
      if (result.is_drop_event && dropType) {
        const existing = await tx.drop.findFirst({
          where: { sourceEventId: rawEvent.id },
          select: { id: true },
        });
        if (!existing) {
          const media = extractMediaFromPayload(
            rawEvent.rawPayload as Record<string, unknown> | null,
          );
          await tx.drop.create({
            data: {
              brandId: brand.id,
              title: result.model_title?.trim() || `${brandName} — ${dropType}`,
              type: dropType,
              priceLow: this.toDecimal(result.price_low),
              priceHigh: this.toDecimal(result.price_high),
              currency: this.toCurrency(result.currency),
              eventDate: this.toDate(result.event_date),
              imageUrl: media.imageUrl,
              sourceUrl: media.sourceUrl,
              sourceEventId: rawEvent.id,
              confidenceScore: this.clampConfidence(result.confidence),
              moderationStatus: ModerationStatus.pending,
            },
          });
          dropCreated = true;
        }
      }

      await tx.rawIngestionEvent.update({
        where: { id: rawEvent.id },
        data: { processed: true },
      });

      return { brandUpserted: true, dropCreated, skipped: false };
    });
  }

  private toDropType(value: string | null): DropType | null {
    return value && DROP_TYPES.has(value) ? (value as DropType) : null;
  }

  private toDecimal(value: number | null): Prisma.Decimal | null {
    if (value === null || Number.isNaN(value)) return null;
    return new Prisma.Decimal(value);
  }

  private toCurrency(value: string | null): string | null {
    return value && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
  }

  private toDate(value: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private clampConfidence(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }
}
