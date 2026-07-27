import { Injectable, Logger } from '@nestjs/common';
import { DropType, Prisma, SourceHealth, SourceType } from '@prisma/client';
import { DropWriterService } from '../drops/drop-writer.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAdapter, parseWatchConfig } from './adapters';
import { SiteFetcher } from './site-fetcher';
import {
  diffSnapshots,
  hashSnapshot,
  normalizeSnapshot,
  ProductSnapshot,
  SnapshotChange,
} from './snapshot';

export interface SiteWatchSourceResult {
  sourceId: string;
  name: string | null;
  status: 'ok' | 'error';
  /** true when this poll produced a snapshot the store had not shown before */
  changed: boolean;
  /** true when this was the source's first ever snapshot */
  baseline: boolean;
  productCount: number;
  dropsCreated: number;
  error?: string;
}

export interface SiteWatchRunResult {
  startedAt: string;
  finishedAt: string;
  sourceCount: number;
  totalDropsCreated: number;
  sources: SiteWatchSourceResult[];
}

const PRISMA_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class SiteWatchService {
  private readonly logger = new Logger(SiteWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fetcher: SiteFetcher,
    private readonly drops: DropWriterService,
  ) {}

  /** Poll every configured Tier 4 source. One failure never stops the rest. */
  async pollAll(): Promise<SiteWatchRunResult> {
    const startedAt = new Date();
    const sources = await this.prisma.source.findMany({
      where: { type: SourceType.site_watch },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const results: SiteWatchSourceResult[] = [];
    for (const { id } of sources) {
      results.push(await this.pollSource(id));
    }

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      sourceCount: sources.length,
      totalDropsCreated: results.reduce((n, r) => n + r.dropsCreated, 0),
      sources: results,
    };
  }

  /**
   * Poll one store: fetch, normalise, and turn genuine catalogue changes into
   * published drops. Never throws — failures are recorded on the source's
   * health and returned in the result.
   */
  async pollSource(sourceId: string): Promise<SiteWatchSourceResult> {
    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
    });
    const result: SiteWatchSourceResult = {
      sourceId: source.id,
      name: source.name,
      status: 'ok',
      changed: false,
      baseline: false,
      productCount: 0,
      dropsCreated: 0,
    };

    try {
      if (!source.brandId) {
        throw new Error(
          'Site-watch source has no brand attached; a store belongs to exactly one brand.',
        );
      }

      const config = parseWatchConfig(source.watchConfig);
      const adapter = getAdapter(config.adapter);

      const response = await this.fetcher.fetch(source.endpoint);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Store responded ${response.status}`);
      }

      const products = normalizeSnapshot(
        adapter(response.body, config, source.endpoint),
      );
      result.productCount = products.length;

      // An empty catalogue is far more often a broken selector or a blocked
      // request than a brand delisting everything. Refuse to treat it as truth.
      if (products.length === 0) {
        throw new Error('Adapter produced no products; refusing to snapshot');
      }

      const previous = await this.previousSnapshot(source.id);
      const created = await this.storeSnapshot(source.id, products);
      if (!created) {
        await this.markHealth(source.id, SourceHealth.healthy);
        return result; // identical to a snapshot we already hold — nothing changed
      }
      result.changed = true;

      if (!previous) {
        // First sight of this store: remember it, announce nothing.
        result.baseline = true;
        await this.markHealth(source.id, SourceHealth.healthy);
        this.logger.log(
          `[${source.name ?? source.endpoint}] baseline recorded (${products.length} products)`,
        );
        return result;
      }

      const changes = diffSnapshots(previous, products);
      for (const change of changes) {
        await this.drops.create({
          brandId: source.brandId,
          title: change.product.title,
          type: this.dropType(change),
          priceLow: change.product.price,
          currency: change.product.currency,
          imageUrl: change.product.imageUrl,
          sourceUrl: change.product.url,
          sourceEventId: created.id,
          // A structural diff of the brand's own store — nothing was inferred.
          confidenceScore: 1,
          publish: true,
        });
        result.dropsCreated += 1;
      }

      await this.markHealth(source.id, SourceHealth.healthy);
      this.logger.log(
        `[${source.name ?? source.endpoint}] ${products.length} products, ${result.dropsCreated} drop(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      result.error = message;
      await this.markHealth(source.id, SourceHealth.error);
      this.logger.error(`[${source.name ?? source.endpoint}] ${message}`);
    }

    return result;
  }

  private dropType(change: SnapshotChange): DropType {
    return change.kind === 'restock' ? DropType.restock : DropType.pre_order;
  }

  /** The most recent snapshot held for this source, or null on first sight. */
  private async previousSnapshot(
    sourceId: string,
  ): Promise<ProductSnapshot[] | null> {
    const event = await this.prisma.rawIngestionEvent.findFirst({
      where: { sourceId },
      orderBy: { fetchedAt: 'desc' },
      select: { rawPayload: true },
    });
    if (!event) return null;
    const payload = event.rawPayload as unknown;
    return Array.isArray(payload) ? (payload as ProductSnapshot[]) : null;
  }

  /**
   * Persist the snapshot in the landing zone. Returns null when this exact
   * snapshot is already stored — the store has not changed since last time.
   */
  private async storeSnapshot(sourceId: string, products: ProductSnapshot[]) {
    try {
      return await this.prisma.rawIngestionEvent.create({
        data: {
          sourceId,
          contentHash: hashSnapshot(products),
          rawPayload: products as unknown as Prisma.InputJsonValue,
          // Site-watch needs no LLM pass; the snapshot is already structured.
          processed: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_UNIQUE_VIOLATION
      ) {
        return null;
      }
      throw err;
    }
  }

  private async markHealth(sourceId: string, healthStatus: SourceHealth) {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { lastPolledAt: new Date(), healthStatus },
    });
  }
}
