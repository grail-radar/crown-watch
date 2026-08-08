import { Injectable, Logger } from '@nestjs/common';
import { ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Takes drops off the public feed that should never have been announced.
 *
 * **Retracts rather than deletes, and the distinction is the whole design.**
 * A `drop_broadcasts` row is the only record that a message was sent, and
 * ADR-0002 spends it to make "at most once, ever" true. Deleting a drop
 * cascades those rows away — which would make the drop a backfill candidate
 * again the moment it was recreated, and destroy the audit trail either way.
 * Unpublishing keeps every row: the drop stops being public, stops being a
 * backfill candidate, and remains available to anyone asking what happened.
 *
 * Written for the 2026-08-07 incident, where a test run against production
 * overwrote four stores' snapshots and the next poll published 372 drops. It is
 * deliberately general — a window and a set of brands — because the next
 * accident will not have the same shape.
 */

export interface RetractionRequest {
  /** Inclusive lower bound on `publishedAt`. */
  from: Date;
  /** Inclusive upper bound on `publishedAt`. */
  to: Date;
  /** Narrows to specific brands. Omit to consider every brand. */
  brandIds?: string[];
  /** Actually apply it. Omitted or false is a dry run that changes nothing. */
  confirm?: boolean;
}

export interface RetractionCandidate {
  id: string;
  brandName: string;
  title: string;
  type: string;
  publishedAt: string | null;
  sourceUrl: string | null;
  /** Messages already sent for this drop, which retraction leaves untouched. */
  broadcasts: number;
}

export interface RetractionResult {
  dryRun: boolean;
  from: string;
  to: string;
  candidateCount: number;
  retracted: number;
  /** Broadcast rows across the whole set — asserted unchanged after applying. */
  broadcastRows: number;
  candidates: RetractionCandidate[];
}

@Injectable()
export class DropRetractionService {
  private readonly logger = new Logger(DropRetractionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async retract(request: RetractionRequest): Promise<RetractionResult> {
    const { from, to, brandIds, confirm } = request;

    if (!(from instanceof Date) || !(to instanceof Date) || from >= to) {
      throw new Error(
        `Refusing a window that is not forwards in time: ${from?.toISOString?.() ?? from} → ${to?.toISOString?.() ?? to}`,
      );
    }

    const where: Prisma.DropWhereInput = {
      publishedAt: { gte: from, lte: to, not: null },
      moderationStatus: ModerationStatus.approved,
      ...(brandIds?.length ? { brandId: { in: brandIds } } : {}),
    };

    const found = await this.prisma.drop.findMany({
      where,
      orderBy: { publishedAt: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        publishedAt: true,
        sourceUrl: true,
        brand: { select: { name: true } },
        _count: { select: { broadcasts: true } },
      },
    });

    // A mistyped window is far likelier than a genuinely empty one, and
    // "0 retracted" reads like success. Refuse instead.
    if (found.length === 0) {
      throw new Error(
        `Refusing to proceed: no drops are published between ${from.toISOString()} and ${to.toISOString()}. Check the window.`,
      );
    }

    const candidates: RetractionCandidate[] = found.map((drop) => ({
      id: drop.id,
      brandName: drop.brand.name,
      title: drop.title,
      type: drop.type,
      publishedAt: drop.publishedAt?.toISOString() ?? null,
      sourceUrl: drop.sourceUrl,
      broadcasts: drop._count.broadcasts,
    }));

    const broadcastRows = candidates.reduce((n, c) => n + c.broadcasts, 0);
    const result: RetractionResult = {
      dryRun: confirm !== true,
      from: from.toISOString(),
      to: to.toISOString(),
      candidateCount: candidates.length,
      retracted: 0,
      broadcastRows,
      candidates,
    };

    if (result.dryRun) {
      this.logger.log(
        `Dry run: ${candidates.length} drop(s) would be retracted, preserving ${broadcastRows} broadcast record(s).`,
      );
      return result;
    }

    const ids = candidates.map((c) => c.id);

    // Both fields, deliberately. Clearing `publishedAt` is what hides it from
    // the feed and from backfill; `rejected` is what stops a future moderation
    // pass reading an approved-but-unpublished drop as something to fix.
    const updated = await this.prisma.drop.updateMany({
      where: { id: { in: ids } },
      data: { publishedAt: null, moderationStatus: ModerationStatus.rejected },
    });
    result.retracted = updated.count;

    // Prove the promise rather than assert it in a comment: the rows that
    // record what was already sent must all still be there.
    const survivingBroadcasts = await this.prisma.dropBroadcast.count({
      where: { dropId: { in: ids } },
    });
    if (survivingBroadcasts !== broadcastRows) {
      throw new Error(
        `Retraction destroyed broadcast history: expected ${broadcastRows} rows, found ${survivingBroadcasts}. Investigate before running anything else.`,
      );
    }

    this.logger.log(
      `Retracted ${result.retracted} drop(s); ${survivingBroadcasts} broadcast record(s) intact.`,
    );
    return result;
  }
}
