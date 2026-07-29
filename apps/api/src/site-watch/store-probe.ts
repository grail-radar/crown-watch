import { Injectable, Logger } from '@nestjs/common';
import { shopifyProductsJson } from './adapters';
import { RobotsService } from './robots.service';
import { SiteFetcher } from './site-fetcher';

/** Where a structured product feed lives, when a store has one. */
const FEED_PATH = '/products.json?limit=250';

/** Pause between hosts, so a batch does not hammer a shared platform edge. */
const DEFAULT_PROBE_DELAY_MS = 2000;

/** Titles shown back to the operator as evidence the feed is real. */
const SAMPLE_SIZE = 3;

/**
 * What the probe learned. Kept distinct because the operator's next action
 * differs for each — and conflating them wastes their afternoon:
 *
 * `structured_feed`  — register it with the structured adapter.
 * `needs_selectors`  — the store has no feed; write selectors against its HTML.
 * `retry_later`      — the store pushed back. It may well have a feed; we do
 *                      not know yet, and writing selectors for it would be work
 *                      thrown away.
 * `forbidden`        — robots.txt says no. Respect it.
 * `unreachable`      — no answer at all.
 */
export type StoreProbeOutcome =
  | 'structured_feed'
  | 'needs_selectors'
  | 'retry_later'
  | 'forbidden'
  | 'unreachable';

export interface StoreProbeResult {
  /** As the operator wrote it, so they can match rows to their own list. */
  domain: string;
  /** The URL to register as the source's endpoint, if this store is usable. */
  endpoint: string;
  outcome: StoreProbeOutcome;
  /** Which adapter to register with; null when the probe cannot yet tell. */
  adapter: 'shopify_products_json' | 'html_selectors' | null;
  /**
   * true only when a structured feed was found *and* it actually contained
   * products. Anything else needs selectors, a retry, or a human.
   */
  usable: boolean;
  productCount: number;
  /** A few product titles, so an operator can see it read the right store. */
  sample: string[];
  /** What happened, in one line. */
  detail: string;
}

/**
 * Sorts candidate brands into "can be watched, and how", so growing coverage is
 * an afternoon rather than a release.
 *
 * Goes through the same fetch seam and the same robots.txt guard as a real
 * poll: a probe that ignored a store's directives would be exactly the
 * discourtesy the watcher is built to avoid, and would tell the operator a
 * store is watchable when it is not.
 *
 * The interesting case is a store that answers 200 with something that is not a
 * feed — a redirect page, a lander, an error rendered as HTML. Status codes
 * cannot be trusted here, so a feed only counts when the adapter actually parses
 * products out of it.
 */
@Injectable()
export class StoreProbe {
  private readonly logger = new Logger(StoreProbe.name);

  constructor(
    private readonly fetcher: SiteFetcher,
    private readonly robots: RobotsService,
  ) {}

  /**
   * Probe each domain in turn. One failure never stops the batch.
   *
   * Paced between hosts. Probing a list as fast as the network allows is the
   * same discourtesy the poller is careful to avoid, and it is self-defeating:
   * an unpaced run of nine brands had four answer `429` in a row, which reads
   * as "no feed" to anyone skimming the output. Slow enough to be polite is
   * also the only way the answers are worth having.
   */
  async probe(
    domains: string[],
    options: { delayMs?: number } = {},
  ): Promise<StoreProbeResult[]> {
    const delayMs = options.delayMs ?? DEFAULT_PROBE_DELAY_MS;
    const results: StoreProbeResult[] = [];

    for (const [index, domain] of domains.entries()) {
      if (index > 0 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      results.push(await this.probeOne(domain));
    }
    return results;
  }

  private async probeOne(domain: string): Promise<StoreProbeResult> {
    const origin = this.originOf(domain);
    const endpoint = `${origin}${FEED_PATH}`;
    const result: StoreProbeResult = {
      domain,
      endpoint,
      outcome: 'needs_selectors',
      adapter: 'html_selectors',
      usable: false,
      productCount: 0,
      sample: [],
      detail: '',
    };

    try {
      if (!(await this.robots.allows(endpoint))) {
        result.outcome = 'forbidden';
        result.adapter = null;
        result.detail = 'robots.txt disallows the product feed path';
        return result;
      }

      const response = await this.fetcher.fetch(endpoint);

      // Pushing back is not the same as having no feed. Reporting a rate limit
      // as "needs selectors" would send an operator off to write selectors for
      // a store that may well have a perfectly good feed behind the throttle.
      if (response.status === 429 || response.status === 503) {
        result.outcome = 'retry_later';
        result.adapter = null;
        result.detail =
          `store is rate limiting us (HTTP ${response.status})` +
          (response.retryAfterSeconds
            ? `; asked to wait ${response.retryAfterSeconds}s`
            : '') +
          ' — probe again later, do not assume it has no feed';
        return result;
      }

      if (response.status < 200 || response.status >= 300) {
        result.detail = `no product feed (HTTP ${response.status}) — needs selectors`;
        return result;
      }

      // Parsed, not sniffed. A store answering 200 with a lander page is the
      // case this exists to catch, and only the adapter can tell the difference.
      let products;
      try {
        products = shopifyProductsJson(response.body, { adapter: '' }, endpoint);
      } catch (err) {
        result.detail = `HTTP 200 but not a product feed (${
          err instanceof Error ? err.message : err
        }) — needs selectors`;
        return result;
      }

      result.productCount = products.length;
      result.sample = products.slice(0, SAMPLE_SIZE).map((p) => p.title);

      if (products.length === 0) {
        // The poller would reject this on every run anyway: an empty catalogue
        // is treated as a fault, never as truth.
        result.detail = 'product feed is empty — nothing to watch';
        return result;
      }

      result.outcome = 'structured_feed';
      result.adapter = 'shopify_products_json';
      result.usable = true;
      result.detail = `structured feed with ${products.length} product(s)`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.outcome = 'unreachable';
      result.adapter = null;
      result.detail = `unreachable: ${message}`;
      this.logger.warn(`[${domain}] ${message}`);
    }

    return result;
  }

  /** Accepts `brand.com`, `https://brand.com` or `https://brand.com/`. */
  private originOf(domain: string): string {
    const trimmed = domain.trim().replace(/\/+$/, '');
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).origin;
  }
}
