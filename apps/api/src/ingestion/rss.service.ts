import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Parser from 'rss-parser';

/** A feed item normalized down to the fields the ingestion pipeline needs. */
export interface NormalizedRssItem {
  guid: string | null;
  link: string | null;
  title: string | null;
  isoDate: string | null;
  /** The full parsed item, stored verbatim in raw_ingestion_events.raw_payload. */
  raw: Record<string, unknown>;
}

@Injectable()
export class RssService {
  private readonly logger = new Logger(RssService.name);
  private readonly parser: Parser;

  constructor(private readonly config: ConfigService) {
    this.parser = new Parser({
      timeout: this.config.get<number>('rss.requestTimeoutMs') ?? 20000,
      headers: {
        'User-Agent':
          this.config.get<string>('rss.userAgent') ?? 'CrownWatchBot/0.1',
      },
    });
  }

  /** Fetch and normalize all items from a single feed URL. */
  async fetchItems(url: string): Promise<NormalizedRssItem[]> {
    const feed = await this.parser.parseURL(url);
    const items = feed.items ?? [];
    this.logger.debug(`Fetched ${items.length} item(s) from ${url}`);
    return items.map((item) => ({
      guid: item.guid ?? null,
      link: item.link ?? null,
      title: item.title ?? null,
      isoDate: item.isoDate ?? item.pubDate ?? null,
      raw: item as Record<string, unknown>,
    }));
  }
}
