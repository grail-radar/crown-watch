import { Injectable } from '@nestjs/common';
import { WatchKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { classifyWatchKind } from './watch-kind';

export interface WatchKindChange {
  watchId: string;
  brandName: string;
  name: string;
  from: WatchKind;
  to: WatchKind;
  /** Drops already published about this Watch — what the cleanup ticket acts on. */
  drops: number;
}

export interface WatchKindBackfillResult {
  dryRun: boolean;
  examined: number;
  changes: WatchKindChange[];
  updated: number;
  /** Watches an operator has already ruled on, which the rule must not touch. */
  overridden: number;
  /** Drops attached to Watches this run would call accessories. */
  accessoryDrops: number;
}

/**
 * Classify the Watches recorded before there was such a thing as a kind.
 *
 * They all defaulted to `watch`, so the accessory Drops already on the feed
 * cannot be found until this has run — and finding them is what the cleanup
 * ticket needs (ADR-0006). A poll would get there eventually, but only when a
 * brand's store next changed, and only for brands still being polled.
 *
 * **Never touches `kindOverride`.** A Watch an operator has ruled on keeps that
 * ruling.
 */
@Injectable()
export class WatchKindBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async backfill(
    options: { confirm?: boolean } = {},
  ): Promise<WatchKindBackfillResult> {
    const dryRun = options.confirm !== true;

    const watches = await this.prisma.watch.findMany({
      select: {
        id: true,
        name: true,
        kind: true,
        kindOverride: true,
        brand: { select: { name: true } },
        _count: { select: { drops: true } },
      },
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
    });

    const changes: WatchKindChange[] = [];
    let overridden = 0;

    for (const watch of watches) {
      if (watch.kindOverride !== null) {
        overridden += 1;
        continue;
      }
      const decided = classifyWatchKind(watch.name);
      if (decided === watch.kind) continue;
      changes.push({
        watchId: watch.id,
        brandName: watch.brand.name,
        name: watch.name,
        from: watch.kind,
        to: decided,
        drops: watch._count.drops,
      });
    }

    let updated = 0;
    if (!dryRun) {
      // Grouped by target kind: two statements rather than one per row, and the
      // set is bounded by the catalogue rather than by history.
      for (const kind of [WatchKind.accessory, WatchKind.watch]) {
        const ids = changes.filter((c) => c.to === kind).map((c) => c.watchId);
        if (ids.length === 0) continue;
        const { count } = await this.prisma.watch.updateMany({
          where: { id: { in: ids } },
          data: { kind },
        });
        updated += count;
      }
    }

    return {
      dryRun,
      examined: watches.length,
      changes,
      updated,
      overridden,
      accessoryDrops: changes
        .filter((c) => c.to === WatchKind.accessory)
        .reduce((n, c) => n + c.drops, 0),
    };
  }
}
