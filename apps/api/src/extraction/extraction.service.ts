import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DropType,
  Prisma,
  RawIngestionEvent,
} from '@prisma/client';
import { DropWriterService } from '../drops/drop-writer.service';
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
    private readonly drops: DropWriterService,
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
        create: {
          name: brandName,
          slug,
          country: this.toText(result.brand_country, 60),
          website: this.toUrl(result.brand_website),
          foundedYearEst: this.toYear(result.brand_founded_year),
        },
      });

      // Backfill metadata on brands discovered before we captured these fields
      // (never overwrite a value we already have).
      const patch: Prisma.BrandUpdateInput = {};
      if (!brand.country && this.toText(result.brand_country, 60)) {
        patch.country = this.toText(result.brand_country, 60);
      }
      if (!brand.website && this.toUrl(result.brand_website)) {
        patch.website = this.toUrl(result.brand_website);
      }
      if (!brand.foundedYearEst && this.toYear(result.brand_founded_year)) {
        patch.foundedYearEst = this.toYear(result.brand_founded_year);
      }
      if (Object.keys(patch).length > 0) {
        await tx.brand.update({ where: { id: brand.id }, data: patch });
      }

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
          // Extraction always queues for human review (CONTEXT.md §5).
          await this.drops.create(
            {
              brandId: brand.id,
              title: result.model_title?.trim() || `${brandName} — ${dropType}`,
              type: dropType,
              priceLow: result.price_low,
              priceHigh: result.price_high,
              currency: result.currency,
              eventDate: this.toDate(result.event_date),
              promisedShipDate: this.toDate(result.promised_ship_date),
              imageUrl: media.imageUrl,
              sourceUrl: media.sourceUrl,
              sourceEventId: rawEvent.id,
              confidenceScore: this.clampConfidence(result.confidence),
              publish: false,
            },
            tx,
          );
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

  private toDate(value: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private clampConfidence(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  private toText(value: string | null, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  }

  private toUrl(value: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(trimmed) ? trimmed : null;
  }

  private toYear(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const year = Math.trunc(value);
    const currentYear = new Date().getFullYear();
    return year >= 1800 && year <= currentYear ? year : null;
  }

  /**
   * Fill missing country / website / founded-year on existing brands via a
   * small tool-use lookup per brand. Only touches fields that are null.
   */
  async enrichBrands(limit = 40): Promise<{
    enabled: boolean;
    considered: number;
    updated: number;
    errors: number;
  }> {
    const out = {
      enabled: this.anthropic.isEnabled(),
      considered: 0,
      updated: 0,
      errors: 0,
    };
    if (!out.enabled) return out;

    const brands = await this.prisma.brand.findMany({
      where: {
        OR: [{ country: null }, { website: null }, { foundedYearEst: null }],
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        name: true,
        country: true,
        website: true,
        foundedYearEst: true,
      },
    });
    out.considered = brands.length;

    for (const brand of brands) {
      try {
        const details = await this.anthropic.enrichBrand(brand.name);
        if (!details) continue;
        const patch: Prisma.BrandUpdateInput = {};
        if (!brand.country && this.toText(details.country, 60)) {
          patch.country = this.toText(details.country, 60);
        }
        if (!brand.website && this.toUrl(details.website)) {
          patch.website = this.toUrl(details.website);
        }
        if (!brand.foundedYearEst && this.toYear(details.founded_year)) {
          patch.foundedYearEst = this.toYear(details.founded_year);
        }
        if (Object.keys(patch).length > 0) {
          await this.prisma.brand.update({
            where: { id: brand.id },
            data: patch,
          });
          out.updated += 1;
        }
      } catch (err) {
        out.errors += 1;
        this.logger.error(
          `Brand enrichment failed for ${brand.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    this.logger.log(
      `Brand enrichment: considered=${out.considered} updated=${out.updated} errors=${out.errors}`,
    );
    return out;
  }
}
