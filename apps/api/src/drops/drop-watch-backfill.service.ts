import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** One Drop the backfill can name a Watch for. */
export interface DropWatchAssignment {
  dropId: string;
  title: string;
  brandName: string;
  sourceUrl: string;
  watchId: string;
  watchName: string;
}

export interface DropWatchBackfillResult {
  dryRun: boolean;
  /**
   * Every Drop with no Watch, whether or not one is derivable — pending and
   * rejected ones included. A Drop sitting in the moderation queue is one an
   * operator may still approve, and it should be correct when they do.
   */
  withoutWatch: number;
  /** Of those, the ones a Variant URL identifies a Watch for. */
  assignments: DropWatchAssignment[];
  /** Rows actually written; 0 on a dry run. */
  assigned: number;
  /**
   * Drops left alone because nothing identifies their Watch — an RSS-sourced
   * Drop, or a store product that no longer exists. Expected, not a failure.
   */
  unresolved: number;
  broadcastRowsBefore: number;
  broadcastRowsAfter: number;
}

/**
 * Give existing Drops the Watch they are about.
 *
 * **Assigns; never merges, never deletes.** The three YEMA Drops from
 * 2026-08-06 stay three rows and gain one shared `watch_id`. Collapsing them
 * into one would cascade their `drop_broadcasts` rows, and those rows are the
 * only evidence that those messages were sent — destroying them would make the
 * watch a backfill candidate all over again and re-announce it to followers who
 * have already seen it twice (ADR-0002, ADR-0003).
 *
 * The link is the **product URL**: a Drop's `source_url` is the store page it
 * was detected from, and a Variant is keyed on exactly that URL. Nothing is
 * inferred from titles — a title match would be a guess, and a wrong `watch_id`
 * puts an announcement on some other model's page.
 */
@Injectable()
export class DropWatchBackfillService {
  private readonly logger = new Logger(DropWatchBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  async backfill(
    options: { confirm?: boolean } = {},
  ): Promise<DropWatchBackfillResult> {
    const dryRun = options.confirm !== true;
    const broadcastRowsBefore = await this.prisma.dropBroadcast.count();

    const drops = await this.prisma.drop.findMany({
      where: { watchId: null },
      select: {
        id: true,
        title: true,
        brandId: true,
        sourceUrl: true,
        brand: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const urls = drops
      .map((d) => d.sourceUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);

    const variants = await this.prisma.watchVariant.findMany({
      where: { productUrl: { in: urls } },
      select: {
        productUrl: true,
        watch: { select: { id: true, name: true, brandId: true } },
      },
    });
    const watchByUrl = new Map(variants.map((v) => [v.productUrl, v.watch]));

    const assignments: DropWatchAssignment[] = [];
    for (const drop of drops) {
      if (!drop.sourceUrl) continue;
      const watch = watchByUrl.get(drop.sourceUrl);
      if (!watch) continue;
      // A Variant URL belonging to a different brand's Watch means the two
      // disagree about who sells this product. Skipping is the safe read: a
      // wrong assignment is worse than an absent one, and it is silent.
      if (watch.brandId !== drop.brandId) {
        this.logger.warn(
          `Drop ${drop.id} and watch ${watch.id} disagree about the brand — left alone`,
        );
        continue;
      }
      assignments.push({
        dropId: drop.id,
        title: drop.title,
        brandName: drop.brand.name,
        sourceUrl: drop.sourceUrl,
        watchId: watch.id,
        watchName: watch.name,
      });
    }

    let assigned = 0;
    if (!dryRun) {
      // One update per Drop rather than a grouped `updateMany` per Watch: the
      // set is small, it runs once, and a per-row write is what makes a partial
      // failure leave correct rows behind instead of an ambiguous half-batch.
      for (const assignment of assignments) {
        await this.prisma.drop.update({
          where: { id: assignment.dropId },
          data: { watchId: assignment.watchId },
        });
        assigned += 1;
      }
    }

    const broadcastRowsAfter = await this.prisma.dropBroadcast.count();
    if (broadcastRowsAfter !== broadcastRowsBefore) {
      // Cannot happen from the writes above, which touch one nullable column.
      // Checked anyway, because the failure it guards against is unrecoverable
      // and silent: the evidence a message was sent is gone, and the next
      // backfill re-announces it.
      throw new Error(
        `Broadcast records changed during the backfill: ${broadcastRowsBefore} → ${broadcastRowsAfter}. ` +
          'This should be impossible; do not run a Telegram backfill until it is understood.',
      );
    }

    return {
      dryRun,
      withoutWatch: drops.length,
      assignments,
      assigned,
      unresolved: drops.length - assignments.length,
      broadcastRowsBefore,
      broadcastRowsAfter,
    };
  }
}
