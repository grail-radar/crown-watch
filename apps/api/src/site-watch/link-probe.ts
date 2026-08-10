import { Injectable, Logger } from '@nestjs/common';
import { LinkVerdict, verdictFor } from './link-liveness';
import { RobotsService } from './robots.service';
import { SiteFetcher } from './site-fetcher';

/**
 * The most links one poll will check, however many candidates it has.
 *
 * A hard ceiling rather than a consequence of the flood guard. The guard caps a
 * scheduled poll at ten changes, but `release=true` waives it — and an operator
 * releasing a held source is exactly the moment a hundred candidates arrive at
 * once. "Bounded" has to mean bounded on every path, not on the ordinary one.
 *
 * Sits just above the flood guard's default so a normal poll is never sampled.
 */
export const MAX_LINK_CHECKS_PER_POLL = 12;

/**
 * Asks a store whether a product page it told us about actually exists.
 *
 * Goes through the same fetch seam and the same robots.txt guard as a real
 * poll, for the same reason {@link StoreProbe} does: a check that ignored a
 * store's directives would be exactly the discourtesy this watcher is built to
 * avoid. robots.txt answers are cached per origin, so vetting three releases
 * from one store costs one lookup.
 *
 * **Never throws, and fails open.** Anything short of the store saying "no such
 * thing" comes back `unverified`, which leaves the candidate publishable. This
 * is the call `RobotsService` already makes for an unreadable robots.txt, and
 * for the same reason: one flaky moment must not be able to silence a brand.
 */
@Injectable()
export class LinkProbe {
  private readonly logger = new Logger(LinkProbe.name);

  constructor(
    private readonly fetcher: SiteFetcher,
    private readonly robots: RobotsService,
  ) {}

  /**
   * Check each URL in turn, paced by `delayMs` — the same knob that paces the
   * run between stores, passed in rather than read from config so a caller
   * deliberately polling slower gets slower checks too.
   *
   * Anything past {@link MAX_LINK_CHECKS_PER_POLL} is not asked about and comes
   * back `unverified`, which publishes. Sampling that fails open is the only
   * safe way to be bounded: the alternative — checking everything — is the
   * request storm this cap exists to prevent.
   */
  async check(urls: string[], delayMs: number): Promise<Map<string, LinkVerdict>> {
    const verdicts = new Map<string, LinkVerdict>();
    for (const url of urls) {
      if (verdicts.has(url)) continue;
      verdicts.set(
        url,
        verdicts.size >= MAX_LINK_CHECKS_PER_POLL
          ? 'unverified'
          : await this.checkOne(url, delayMs),
      );
    }
    return verdicts;
  }

  private async checkOne(url: string, delayMs: number): Promise<LinkVerdict> {
    try {
      // Asked before fetching, never after: a disallowed path must not be
      // requested at all, which is the whole point of the directive. Not being
      // allowed to look is not evidence that the product is gone.
      if (!(await this.robots.allows(url))) return 'unverified';
      if (delayMs > 0) await this.pause(delayMs);
      const { status } = await this.fetcher.fetch(url);
      return verdictFor(status);
    } catch (err) {
      // A timeout, a DNS failure, a refused connection. Our problem, not the
      // product's — and a poll must not fail because a product page did.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not check ${url}: ${message}`);
      return 'unverified';
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
