import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SourceHealth, SourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { rssContentHash } from './content-hash';
import { RssService } from './rss.service';

export interface SourcePollResult {
  sourceId: string;
  name: string | null;
  endpoint: string;
  status: 'ok' | 'error';
  fetched: number;
  inserted: number;
  skipped: number;
  error?: string;
}

export interface PollRunResult {
  startedAt: string;
  finishedAt: string;
  sourceCount: number;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  sources: SourcePollResult[];
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rss: RssService,
  ) {}

  /** Poll every configured RSS source and land new items in the DB. */
  async pollAllRssSources(): Promise<PollRunResult> {
    const startedAt = new Date();
    const sources = await this.prisma.source.findMany({
      where: { type: SourceType.rss },
      orderBy: { createdAt: 'asc' },
    });
    this.logger.log(`Polling ${sources.length} RSS source(s)`);

    const results: SourcePollResult[] = [];
    for (const source of sources) {
      results.push(await this.pollRssSource(source.id));
    }

    const run: PollRunResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      sourceCount: sources.length,
      totalFetched: results.reduce((acc, r) => acc + r.fetched, 0),
      totalInserted: results.reduce((acc, r) => acc + r.inserted, 0),
      totalSkipped: results.reduce((acc, r) => acc + r.skipped, 0),
      sources: results,
    };
    this.logger.log(
      `RSS poll complete: ${run.totalInserted} new / ${run.totalFetched} fetched across ${run.sourceCount} source(s)`,
    );
    return run;
  }

  /**
   * Poll a single RSS source: fetch → hash → dedup → land in
   * raw_ingestion_events (processed = false). Never throws; failures are
   * recorded on the source's health_status and returned in the result.
   */
  async pollRssSource(sourceId: string): Promise<SourcePollResult> {
    const source = await this.prisma.source.findUniqueOrThrow({
      where: { id: sourceId },
    });
    const result: SourcePollResult = {
      sourceId: source.id,
      name: source.name,
      endpoint: source.endpoint,
      status: 'ok',
      fetched: 0,
      inserted: 0,
      skipped: 0,
    };

    try {
      const items = await this.rss.fetchItems(source.endpoint);
      result.fetched = items.length;

      // Dedup within the batch (feeds occasionally repeat items), then rely on
      // the (source_id, content_hash) unique constraint to dedup across polls.
      const seen = new Set<string>();
      const rows: Prisma.RawIngestionEventCreateManyInput[] = [];
      for (const item of items) {
        const contentHash = rssContentHash(item);
        if (seen.has(contentHash)) continue;
        seen.add(contentHash);
        rows.push({
          sourceId: source.id,
          contentHash,
          rawPayload: item.raw as Prisma.InputJsonValue,
          processed: false,
        });
      }

      const { count } = await this.prisma.rawIngestionEvent.createMany({
        data: rows,
        skipDuplicates: true,
      });
      result.inserted = count;
      result.skipped = result.fetched - count;

      await this.prisma.source.update({
        where: { id: source.id },
        data: { lastPolledAt: new Date(), healthStatus: SourceHealth.healthy },
      });
      this.logger.log(
        `[${source.name ?? source.endpoint}] fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.status = 'error';
      result.error = message;
      await this.prisma.source.update({
        where: { id: source.id },
        data: { lastPolledAt: new Date(), healthStatus: SourceHealth.error },
      });
      this.logger.error(
        `[${source.name ?? source.endpoint}] poll failed: ${message}`,
      );
    }

    return result;
  }
}
