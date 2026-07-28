import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FetchResult {
  status: number;
  body: string;
  /**
   * `Retry-After` from a 429 or 503, in seconds, when the store sent one.
   * Carried on the result rather than parsed upstream so backoff can honour an
   * explicit request instead of guessing at one.
   */
  retryAfterSeconds?: number | null;
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

/**
 * `Retry-After` is either a delay in seconds or an HTTP date. Anything else —
 * absent, malformed, already past — means we were not told, not "retry now".
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  const seconds = Math.ceil((asDate - now.getTime()) / 1000);
  return seconds > 0 ? seconds : null;
}

@Injectable()
export class HttpSiteFetcher extends SiteFetcher {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async fetch(url: string): Promise<FetchResult> {
    const timeoutMs =
      this.config.get<number>('siteWatch.requestTimeoutMs') ?? 20000;
    const userAgent =
      this.config.get<string>('siteWatch.userAgent') ?? 'CrownWatchBot/0.1';

    const res = await fetch(url, {
      // The bot names itself and links somewhere a shop owner can reach a
      // human. Being blocked by the stores this product watches would end the
      // product, so identifying honestly is a feature, not a formality.
      headers: { 'User-Agent': userAgent, Accept: 'application/json, text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      status: res.status,
      body: await res.text(),
      retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')),
    };
  }
}
