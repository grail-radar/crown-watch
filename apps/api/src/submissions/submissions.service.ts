import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SourceHealth, SourceType } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { ExtractionService } from '../extraction/extraction.service';
import { ExtractionResult } from '../extraction/extraction.types';
import { PrismaService } from '../prisma/prisma.service';

const SUBMISSIONS_ENDPOINT = 'community://submissions';
const DROP_TYPES = new Set([
  'kickstarter_launch',
  'waitlist_open',
  'restock',
  'pre_order',
]);

export interface SubmissionInput {
  brand_name?: unknown;
  title?: unknown;
  url?: unknown;
  type?: unknown;
  price?: unknown;
  currency?: unknown;
  note?: unknown;
}

/**
 * Community "submit a drop" (CONTEXT.md §7.5). Submissions flow through the
 * exact same pipeline as automated ingestion: a raw event lands in the manual
 * source, a brand is upserted, and a PENDING drop enters the moderation queue.
 * Nothing is published without human approval.
 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ExtractionService,
  ) {}

  private str(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, max) : null;
  }

  async submit(input: SubmissionInput): Promise<{ ok: true }> {
    const brandName = this.str(input.brand_name, 80);
    const title = this.str(input.title, 140);
    if (!brandName || brandName.length < 2) {
      throw new BadRequestException('Please provide the brand name.');
    }
    if (!title || title.length < 2) {
      throw new BadRequestException('Please provide the watch / drop name.');
    }

    const rawUrl = this.str(input.url, 500);
    const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    if (rawUrl && !url) {
      throw new BadRequestException('The link must start with http(s)://');
    }

    const rawType = this.str(input.type, 40);
    const type = rawType && DROP_TYPES.has(rawType) ? rawType : 'pre_order';

    const priceRaw = this.str(input.price, 20);
    const price = priceRaw ? Number(priceRaw.replace(/[^\d.]/g, '')) : NaN;
    const currencyRaw = this.str(input.currency, 3);
    const currency =
      currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw)
        ? currencyRaw.toUpperCase()
        : null;

    const note = this.str(input.note, 500);

    // Land the submission in the shared manual source (auditable raw event).
    const source = await this.prisma.source.upsert({
      where: {
        type_endpoint: {
          type: SourceType.manual,
          endpoint: SUBMISSIONS_ENDPOINT,
        },
      },
      update: {},
      create: {
        type: SourceType.manual,
        name: 'Community submissions',
        endpoint: SUBMISSIONS_ENDPOINT,
        healthStatus: SourceHealth.healthy,
      },
    });

    const payload = {
      title: `${brandName} — ${title}`,
      link: url,
      submittedType: type,
      note,
      submittedAt: new Date().toISOString(),
    };
    const contentHash = createHash('sha256')
      .update(`submission:${randomUUID()}`)
      .digest('hex');
    const rawEvent = await this.prisma.rawIngestionEvent.create({
      data: {
        sourceId: source.id,
        contentHash,
        rawPayload: payload,
        processed: false,
      },
    });

    // Reuse the extraction persistence path: brand upsert + PENDING drop.
    const synthetic: ExtractionResult = {
      is_watch_related: true,
      is_independent_microbrand: true,
      is_drop_event: true,
      brand_name: brandName,
      model_title: title,
      drop_type: type as ExtractionResult['drop_type'],
      price_low: Number.isFinite(price) && price > 0 ? price : null,
      price_high: null,
      currency,
      event_date: null,
      promised_ship_date: null,
      // Brand metadata is filled by the enrichment pass, not by submitters.
      brand_country: null,
      brand_website: null,
      brand_founded_year: null,
      // Community-sourced: middling confidence; moderation is the gate anyway.
      confidence: 0.5,
    };
    await this.extraction.persistExtraction(rawEvent, synthetic);

    this.logger.log(`Community submission queued: ${brandName} — ${title}`);
    return { ok: true };
  }
}
