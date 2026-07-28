import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAllowed, parseRobots, RobotsRules } from './robots';
import { SiteFetcher } from './site-fetcher';

/** How long a fetched robots.txt is trusted before we ask again. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  rules: RobotsRules;
  fetchedAt: number;
}

/**
 * Fetches and caches each store's robots.txt, and answers whether a URL may be
 * fetched.
 *
 * Cached per origin because a poll of twenty brands must not become forty
 * requests, and because a store's directives do not change between two polls
 * minutes apart. A store that cannot serve a robots.txt is treated as having no
 * restrictions — that is the convention, and refusing to crawl on a 500 would
 * let one flaky file silence a brand indefinitely.
 */
@Injectable()
export class RobotsService {
  private readonly logger = new Logger(RobotsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetcher: SiteFetcher,
    private readonly config: ConfigService,
  ) {}

  private userAgent(): string {
    return (
      this.config.get<string>('siteWatch.userAgent') ?? 'CrownWatchBot/0.1'
    );
  }

  /** May we fetch this URL? Never throws — an unreadable robots.txt allows. */
  async allows(url: string): Promise<boolean> {
    const rules = await this.rulesFor(url);
    if (!rules) return true;
    try {
      return isAllowed(rules, new URL(url).pathname);
    } catch {
      return true;
    }
  }

  /** The crawl-delay this site asks for, in seconds, if it asks for one. */
  async crawlDelay(url: string): Promise<number | null> {
    const rules = await this.rulesFor(url);
    return rules?.crawlDelay ?? null;
  }

  private async rulesFor(url: string): Promise<RobotsRules | null> {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return null;
    }

    const cached = this.cache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rules;
    }

    let rules: RobotsRules = { disallow: [], allow: [], crawlDelay: null };
    try {
      const res = await this.fetcher.fetch(`${origin}/robots.txt`);
      // 4xx means "no robots.txt" — everything is allowed. A 5xx is the site
      // being broken rather than restrictive, and is treated the same way here
      // rather than blocking the brand until it recovers.
      if (res.status >= 200 && res.status < 300) {
        rules = parseRobots(res.body, this.userAgent());
      }
    } catch (err) {
      this.logger.warn(
        `robots.txt unreachable for ${origin}: ${err instanceof Error ? err.message : err}`,
      );
    }

    this.cache.set(origin, { rules, fetchedAt: Date.now() });
    return rules;
  }

  /** Drops the cache — used by tests and by an operator forcing a re-read. */
  clearCache(): void {
    this.cache.clear();
  }
}
