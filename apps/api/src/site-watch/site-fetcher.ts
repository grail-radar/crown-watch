import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FetchResult {
  status: number;
  body: string;
}

/**
 * The single inbound I/O seam for Tier 4.
 *
 * Everything above it — adapters, snapshotting, diffing, persistence — is pure
 * or database-only, so the whole pipeline can be driven from fixtures in tests
 * without touching the network.
 */
export abstract class SiteFetcher {
  abstract fetch(url: string): Promise<FetchResult>;
}

@Injectable()
export class HttpSiteFetcher extends SiteFetcher {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async fetch(url: string): Promise<FetchResult> {
    const timeoutMs = this.config.get<number>('rss.requestTimeoutMs') ?? 20000;
    const userAgent =
      this.config.get<string>('rss.userAgent') ?? 'CrownWatchBot/0.1';

    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json, text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  }
}
