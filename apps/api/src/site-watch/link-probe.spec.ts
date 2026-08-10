/**
 * The politeness and the bound, without a database.
 *
 * The verdict table itself lives in `link-liveness.spec.ts`. What is asserted
 * here is everything around it: that a disallowed path is never requested, that
 * a broken store cannot break a poll, and that no single poll can turn into a
 * request storm at somebody else's shop.
 */
import { ConfigService } from '@nestjs/config';
import { LinkProbe, MAX_LINK_CHECKS_PER_POLL } from './link-probe';
import { RobotsService } from './robots.service';
import { FetchResult, SiteFetcher } from './site-fetcher';

class StubFetcher extends SiteFetcher {
  calls: string[] = [];
  status = new Map<string, number>();
  throwFor = new Set<string>();
  robotsTxt = '';

  async fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    if (url.endsWith('/robots.txt')) {
      return { status: this.robotsTxt ? 200 : 404, body: this.robotsTxt };
    }
    if (this.throwFor.has(url)) throw new Error('connect ETIMEDOUT');
    return { status: this.status.get(url) ?? 200, body: '<html></html>' };
  }

  /** Requests that actually hit a product page. */
  get productCalls(): string[] {
    return this.calls.filter((u) => !u.endsWith('/robots.txt'));
  }
}

const url = (n: number) => `https://brand.example/products/ref-${n}`;

describe('LinkProbe', () => {
  let fetcher: StubFetcher;
  let robots: RobotsService;
  let probe: LinkProbe;

  beforeEach(() => {
    fetcher = new StubFetcher();
    robots = new RobotsService(
      fetcher,
      new ConfigService({ siteWatch: { userAgent: 'CrownWatchBot/0.1' } }),
    );
    probe = new LinkProbe(fetcher, robots);
  });

  it('reports what the store said about each page', async () => {
    fetcher.status.set(url(2), 404);

    const verdicts = await probe.check([url(1), url(2)], 0);

    expect(verdicts.get(url(1))).toBe('live');
    expect(verdicts.get(url(2))).toBe('gone');
  });

  it('does not request a path robots.txt forbids, and says it does not know', async () => {
    fetcher.robotsTxt = 'User-agent: *\nDisallow: /products/';

    const verdicts = await probe.check([url(1)], 0);

    expect(fetcher.productCalls).toEqual([]);
    expect(verdicts.get(url(1))).toBe('unverified');
  });

  it('asks each store about its rules once, however many links it checks', async () => {
    await probe.check([url(1), url(2), url(3)], 0);

    const robotsLookups = fetcher.calls.filter((u) => u.endsWith('/robots.txt'));
    expect(robotsLookups).toHaveLength(1);
  });

  it('survives a store that will not answer at all', async () => {
    fetcher.throwFor.add(url(1));

    const verdicts = await probe.check([url(1), url(2)], 0);

    expect(verdicts.get(url(1))).toBe('unverified');
    // And the rest of the batch is unaffected.
    expect(verdicts.get(url(2))).toBe('live');
  });

  it('asks about one URL once, however many candidates share it', async () => {
    await probe.check([url(1), url(1), url(1)], 0);

    expect(fetcher.productCalls).toEqual([url(1)]);
  });

  describe('the bound', () => {
    it('stops asking after the cap and publishes the rest unchecked', async () => {
      // The release path waives the flood guard, so "bounded" cannot lean on
      // it. A hundred released candidates must not become a hundred requests.
      const urls = Array.from({ length: 100 }, (_, i) => url(i));

      const verdicts = await probe.check(urls, 0);

      expect(fetcher.productCalls).toHaveLength(MAX_LINK_CHECKS_PER_POLL);
      expect(verdicts.size).toBe(100);
      // Everything past the cap fails open — unchecked is not evidence.
      expect(verdicts.get(url(99))).toBe('unverified');
    });

    it('leaves an ordinary poll entirely unsampled', async () => {
      // The flood guard refuses above ten changes, so a scheduled poll never
      // reaches the cap and every candidate is genuinely checked.
      const urls = Array.from({ length: 10 }, (_, i) => url(i));
      fetcher.status.set(url(9), 404);

      const verdicts = await probe.check(urls, 0);

      expect(fetcher.productCalls).toHaveLength(10);
      expect(verdicts.get(url(9))).toBe('gone');
    });
  });

  describe('pacing', () => {
    it('waits between requests by the delay it is given', async () => {
      const started = Date.now();

      await probe.check([url(1), url(2)], 30);

      expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    });

    it('does not wait when told not to', async () => {
      const started = Date.now();

      await probe.check([url(1), url(2)], 0);

      expect(Date.now() - started).toBeLessThan(50);
    });
  });
});
