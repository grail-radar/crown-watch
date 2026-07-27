import { Injectable } from '@nestjs/common';
import { DropType, ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DropInput {
  brandId: string;
  title: string;
  type: DropType;
  priceLow?: number | null;
  priceHigh?: number | null;
  currency?: string | null;
  eventDate?: Date | null;
  promisedShipDate?: Date | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  sourceEventId?: string | null;
  confidenceScore?: number | null;
  /**
   * true  — publish immediately (Tier 4 site-watch: a structural diff of the
   *         brand's own store, so there is no extraction to misread)
   * false — queue for human moderation (anything an LLM read from prose)
   */
  publish?: boolean;
}

/**
 * The single place a drop row is created.
 *
 * Both ingestion paths go through here so the published-vs-pending rule lives
 * in one place: CONTEXT.md §5 keeps extraction behind moderation, while
 * site-watch signals publish on arrival.
 */
@Injectable()
export class DropWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: DropInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const publish = input.publish === true;
    const now = new Date();

    return client.drop.create({
      data: {
        brandId: input.brandId,
        title: input.title,
        type: input.type,
        priceLow: this.decimal(input.priceLow),
        priceHigh: this.decimal(input.priceHigh),
        currency: this.currency(input.currency),
        eventDate: input.eventDate ?? null,
        promisedShipDate: input.promisedShipDate ?? null,
        imageUrl: input.imageUrl ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceEventId: input.sourceEventId ?? null,
        confidenceScore: input.confidenceScore ?? null,
        moderationStatus: publish
          ? ModerationStatus.approved
          : ModerationStatus.pending,
        // Published without a human reviewer: reviewedAt stays null, which is
        // what distinguishes an auto-published drop from an approved one.
        publishedAt: publish ? now : null,
      },
    });
  }

  private decimal(value: number | null | undefined): Prisma.Decimal | null {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return null;
    }
    return new Prisma.Decimal(value);
  }

  private currency(value: string | null | undefined): string | null {
    return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value)
      ? value.toUpperCase()
      : null;
  }
}
