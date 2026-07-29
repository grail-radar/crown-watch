/**
 * Sorting candidate brands into "can be watched, and how".
 *
 * Driven entirely through the fetch seam over captured payloads — no network.
 * The case that matters most is the deceptive one: a store answering 200 with a
 * page rather than a feed. Trusting the status code there would have an operator
 * register a source that can never produce a drop.
 */
import { ConfigService } from '@nestjs/config';
import { FetchResult, SiteFetcher } from './site-fetcher';
import { RobotsService } from './robots.service';
import { StoreProbe } from './store-probe';

/** Serves a canned response per URL, and records what was asked for. */
class ScriptedFetcher extends SiteFetcher {
  responses = new Map<string, FetchResult>();
  calls: string[] = [];
  /** URLs that should throw, standing in for an unreachable host. */
  unreachable = new Set<string>();

  async fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    for (const dead of this.unreachable) {
      if (url.includes(dead)) throw new Error('connect ETIMEDOUT');
    }
    return this.responses.get(url) ?? { status: 404, body: 'not found' };
  }

  feed(origin: string, products: Array<{ handle: string; title: string }>) {
    this.responses.set(`${origin}/products.json?limit=250`, {
      status: 200,
      body: JSON.stringify({
        products: products.map((p) => ({
          handle: p.handle,
          title: p.title,
          variants: [{ available: true, price: '500.00' }],
          images: [],
        })),
      }),
    });
  }

  html(origin: string, status = 200, body = '<html><body>a shop</body></html>') {
    this.responses.set(`${origin}/products.json?limit=250`, { status, body });
  }
}

const UA = 'CrownWatchBot/0.1 (+https://crownswatch.org/about-the-bot)';

describe('StoreProbe', () => {
  let fetcher: ScriptedFetcher;
  let probe: StoreProbe;

  beforeEach(() => {
    fetcher = new ScriptedFetcher();
    const config = new ConfigService({ siteWatch: { userAgent: UA } });
    probe = new StoreProbe(fetcher, new RobotsService(fetcher, config));
  });

  it('reports a structured feed as usable, with what it saw', async () => {
    fetcher.feed('https://yema.com', [
      { handle: 'superman-heritage', title: 'Superman Heritage' },
      { handle: 'worldtime-gmt', title: 'Worldtime GMT' },
    ]);

    const [result] = await probe.probe(['yema.com'], { delayMs: 0 });

    expect(result.outcome).toBe('structured_feed');
    expect(result.usable).toBe(true);
    expect(result.adapter).toBe('shopify_products_json');
    expect(result.productCount).toBe(2);
    expect(result.sample).toContain('Superman Heritage');
  });

  it('reports a store with no product endpoint as needing selectors', async () => {
    fetcher.html('https://baltic-watches.com', 404, 'Not Found');

    const [result] = await probe.probe(['baltic-watches.com'], { delayMs: 0 });

    expect(result.outcome).toBe('needs_selectors');
    expect(result.adapter).toBe('html_selectors');
    expect(result.usable).toBe(false);
    expect(result.detail).toMatch(/404|no product feed/i);
  });

  it('does not mistake a 200 that is not a feed for a working feed', async () => {
    // Observed in discovery: the endpoint answers 200 with a redirect page.
    fetcher.html(
      'https://lorier.com',
      200,
      '<!DOCTYPE html><html><head><script>window.location.href="/lander"</script></head></html>',
    );

    const [result] = await probe.probe(['lorier.com'], { delayMs: 0 });

    expect(result.usable).toBe(false);
    expect(result.adapter).toBe('html_selectors');
    expect(result.productCount).toBe(0);
    expect(result.detail).toMatch(/not a product feed|200/i);
  });

  it('treats a feed with an empty product list as unusable', async () => {
    // Valid JSON, zero products: nothing to watch, and the empty-catalogue
    // guard would reject it on every poll anyway.
    fetcher.feed('https://empty.example', []);

    const [result] = await probe.probe(['empty.example'], { delayMs: 0 });

    expect(result.usable).toBe(false);
    expect(result.productCount).toBe(0);
  });

  it('does not mistake a rate-limited store for one with no feed', async () => {
    // Observed live: a real brand answered 429. Calling that "needs selectors"
    // would send an operator off to write selectors against a store that may
    // have a perfectly good feed behind the throttle.
    fetcher.responses.set('https://serica.example/products.json?limit=250', {
      status: 429,
      body: 'slow down',
      retryAfterSeconds: 120,
    });

    const [result] = await probe.probe(['serica.example'], { delayMs: 0 });

    expect(result.outcome).toBe('retry_later');
    expect(result.adapter).toBeNull();
    expect(result.usable).toBe(false);
    expect(result.detail).toMatch(/rate limiting/i);
    expect(result.detail).toContain('120');
  });

  it('reports an unreachable store without failing the rest of the batch', async () => {
    fetcher.feed('https://yema.com', [{ handle: 'a', title: 'A' }]);
    fetcher.unreachable.add('offline.example');

    const results = await probe.probe(['offline.example', 'yema.com'], { delayMs: 0 });

    expect(results).toHaveLength(2);
    const offline = results.find((r) => r.domain === 'offline.example')!;
    expect(offline.outcome).toBe('unreachable');
    expect(offline.usable).toBe(false);
    expect(offline.detail).toMatch(/ETIMEDOUT|unreachable/i);
    expect(results.find((r) => r.domain === 'yema.com')!.usable).toBe(true);
  });

  it('probes several brands in one go', async () => {
    fetcher.feed('https://a.example', [{ handle: 'x', title: 'X' }]);
    fetcher.html('https://b.example', 404);
    fetcher.feed('https://c.example', [{ handle: 'y', title: 'Y' }]);

    const results = await probe.probe(['a.example', 'b.example', 'c.example'], { delayMs: 0 });

    expect(results.map((r) => r.domain)).toEqual([
      'a.example',
      'b.example',
      'c.example',
    ]);
    expect(results.filter((r) => r.usable)).toHaveLength(2);
  });

  it('accepts a domain however an operator happens to write it', async () => {
    fetcher.feed('https://yema.com', [{ handle: 'a', title: 'A' }]);

    for (const written of ['yema.com', 'https://yema.com', 'https://yema.com/']) {
      const [result] = await probe.probe([written], { delayMs: 0 });
      expect(result.usable).toBe(true);
    }
  });

  it('does not probe a path the store forbids', async () => {
    fetcher.responses.set('https://polite.example/robots.txt', {
      status: 200,
      body: 'User-agent: *\nDisallow: /products.json',
    });
    fetcher.feed('https://polite.example', [{ handle: 'a', title: 'A' }]);

    const [result] = await probe.probe(['polite.example'], { delayMs: 0 });

    expect(result.outcome).toBe('forbidden');
    expect(result.usable).toBe(false);
    expect(result.detail).toMatch(/robots/i);
    // The point of the directive: the request is never made.
    expect(fetcher.calls).not.toContain('https://polite.example/products.json?limit=250');
  });

  it('reports the endpoint an operator should register', async () => {
    fetcher.feed('https://yema.com', [{ handle: 'a', title: 'A' }]);

    const [result] = await probe.probe(['yema.com'], { delayMs: 0 });

    expect(result.endpoint).toBe('https://yema.com/products.json?limit=250');
  });
});
