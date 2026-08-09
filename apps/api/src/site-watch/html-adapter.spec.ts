/**
 * The HTML-selector adapter, driven against a captured store listing page.
 *
 * HTML is far noisier than a product feed, so most of these tests are about
 * what must NOT come out: the bar for this adapter is that it never
 * manufactures a drop from an unrelated page change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdapterError, getAdapter, htmlSelectors, parseWatchConfig, WatchConfig } from './adapters';
import { hashSnapshot, normalizeSnapshot } from './snapshot';
import { diffWatches } from './watch-events';

/** These pages are one brand's store; grouping is scoped to the brand. */
const BRAND = 'northlake';

const PAGE = readFileSync(
  join(__dirname, '__fixtures__', 'store-listing.html'),
  'utf8',
);
const ENDPOINT = 'https://northlake.example/collections/all';

const CONFIG: WatchConfig = {
  adapter: 'html_selectors',
  selectors: {
    item: '.product-card',
    link: '.product-card__link',
    title: '.product-card__title',
    price: '.price',
    image: '.product-card__image',
    soldOut: '.badge--sold-out',
  },
};

const run = (body = PAGE, config = CONFIG) =>
  normalizeSnapshot(htmlSelectors(body, config, ENDPOINT));

describe('htmlSelectors adapter', () => {
  it('is reachable by name, so a brand is a config row not a code change', () => {
    expect(getAdapter('html_selectors')).toBe(htmlSelectors);
  });

  it('reads products out of a real listing page', () => {
    const products = run();

    expect(products).toHaveLength(3);
    expect(products.map((p) => p.title).sort()).toEqual([
      'Foundry Field',
      'Harbour Diver — Pacific Blue',
      'Meridian GMT',
    ]);
  });

  it('produces the same snapshot shape as the structured adapter', () => {
    // Diffing and alerting are shared, so the shape has to match exactly.
    const [product] = run().filter((p) => p.title === 'Foundry Field');

    expect(Object.keys(product).sort()).toEqual([
      'available',
      'currency',
      'imageUrl',
      'price',
      'title',
      'url',
    ]);
    expect(product).toMatchObject({
      url: 'https://northlake.example/products/foundry-field',
      price: 640,
      currency: 'EUR',
      imageUrl: 'https://northlake.example/cdn/shop/foundry-field_600x.jpg',
      available: true,
    });
  });

  it('strips tracking parameters, so a link is the same product each poll', () => {
    // The fixture's first card carries ?variant=…&ref=grid. Keeping the query
    // would make one watch look like a new product whenever the grid re-renders.
    const diver = run().find((p) => p.title.startsWith('Harbour'));

    expect(diver?.url).toBe('https://northlake.example/products/harbour-diver-blue');
  });

  it('collapses whitespace, so a reflowed template is not a title change', () => {
    // The fixture's first title is split across lines with a double space.
    const diver = run().find((p) => p.url.endsWith('harbour-diver-blue'));

    expect(diver?.title).toBe('Harbour Diver — Pacific Blue');
  });

  it('detects availability from the page', () => {
    const byTitle = Object.fromEntries(run().map((p) => [p.title, p.available]));

    expect(byTitle['Meridian GMT']).toBe(false); // carries the sold-out badge
    expect(byTitle['Foundry Field']).toBe(true);
  });

  it('reads a sold-out signal expressed as text rather than a class', () => {
    const products = run(PAGE, {
      ...CONFIG,
      selectors: { ...CONFIG.selectors!, soldOut: null, soldOutText: 'Sold out' },
    });

    expect(products.find((p) => p.title === 'Meridian GMT')?.available).toBe(false);
  });

  it('treats a store that never mentions stock as selling everything', () => {
    // Guessing "sold out" from silence would invent a restock for every
    // product the first time the page did say something.
    const products = run(PAGE, {
      ...CONFIG,
      selectors: { ...CONFIG.selectors!, soldOut: null },
    });

    expect(products.every((p) => p.available)).toBe(true);
  });

  it('ignores the navigation, footer and marketing links around the grid', () => {
    const urls = run().map((p) => p.url);

    expect(urls.every((u) => u.includes('/products/'))).toBe(true);
    expect(urls.some((u) => u.includes('/pages/'))).toBe(false);
  });

  describe('noise must never become a drop', () => {
    const snapshotOf = (body: string) => run(body);
    const baseline = () => snapshotOf(PAGE);

    it('says nothing when a marketing banner changes', () => {
      const edited = PAGE.replace(
        'Free shipping on orders over €200 — this week only',
        'Summer sale — 20% off everything until Sunday',
      );

      expect(hashSnapshot(snapshotOf(edited))).toBe(hashSnapshot(baseline()));
      expect(diffWatches(BRAND, baseline(), snapshotOf(edited))).toHaveLength(0);
    });

    it('says nothing when body copy is rewritten', () => {
      const edited = PAGE.replace(
        'Hand-assembled in small batches. Every reference is limited to 300 pieces.',
        'Assembled by hand in Glashütte. Each reference is a run of 250.',
      );

      expect(diffWatches(BRAND, baseline(), snapshotOf(edited))).toHaveLength(0);
    });

    it('says nothing when scripts or styles change', () => {
      // Analytics blobs change on nearly every request.
      const edited = PAGE.replace('a91f3c', 'ff0e12')
        .replace('1753700000', '1753799999')
        .replace('.product-card { display: grid; }', '.product-card{display:flex}');

      expect(hashSnapshot(snapshotOf(edited))).toBe(hashSnapshot(baseline()));
    });

    it('says nothing when the listing is reordered', () => {
      const cards = PAGE.match(/<li class="product-card">[\s\S]*?<\/li>/g)!;
      const reversed = PAGE.replace(
        cards.join('\n\n        '),
        [...cards].reverse().join('\n\n        '),
      );

      expect(hashSnapshot(snapshotOf(reversed))).toBe(hashSnapshot(baseline()));
      expect(diffWatches(BRAND, baseline(), snapshotOf(reversed))).toHaveLength(0);
    });

    it('says nothing when only a price moves', () => {
      const edited = PAGE.replace('€ 640.00', '€ 690.00');

      expect(diffWatches(BRAND, baseline(), snapshotOf(edited))).toHaveLength(0);
    });

    it('says nothing when a product sells out', () => {
      const edited = PAGE.replace(
        '<span class="price">€ 640.00</span>',
        '<span class="price">€ 640.00</span>\n          <span class="badge badge--sold-out">Sold out</span>',
      );

      expect(diffWatches(BRAND, baseline(), snapshotOf(edited))).toHaveLength(0);
    });
  });

  it('reports a genuinely new product link as a new release', () => {
    const edited = PAGE.replace(
      '</ul>',
      `<li class="product-card">
         <a class="product-card__link" href="/products/northlake-chronograph">
           <img class="product-card__image" src="/cdn/shop/chrono_600x.jpg" alt="Chronograph" />
           <h3 class="product-card__title">Northlake Chronograph</h3>
         </a>
         <span class="price">€ 1,890.00</span>
       </li></ul>`,
    );

    const changes = diffWatches(BRAND, run(), run(edited));

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_watch');
    expect(changes[0].identity.name).toBe('Northlake Chronograph');
    expect(changes[0].lead).toMatchObject({
      url: 'https://northlake.example/products/northlake-chronograph',
      price: 1890,
    });
  });

  it('reports a sold-out product coming back as a restock', () => {
    const soldOut = run();
    const backInStock = run(
      PAGE.replace('<span class="badge badge--sold-out">Sold out</span>', ''),
    );

    const changes = diffWatches(BRAND, soldOut, backInStock);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('restock');
    expect(changes[0].identity.name).toBe('Meridian GMT');
  });

  it('returns nothing when the page structure changes under it', () => {
    // The caller turns an empty result into an unhealthy source rather than
    // treating it as "the brand delisted everything" — proven in the service
    // tests. Here we only assert the adapter reports the emptiness honestly.
    const products = run(PAGE, {
      ...CONFIG,
      selectors: { ...CONFIG.selectors!, item: '.redesigned-card' },
    });

    expect(products).toHaveLength(0);
  });

  it('refuses a configuration with no item selector', () => {
    expect(() => htmlSelectors(PAGE, { adapter: 'html_selectors' }, ENDPOINT)).toThrow(
      AdapterError,
    );
  });

  it('keeps selectors through config parsing, and drops empty ones', () => {
    const parsed = parseWatchConfig({
      adapter: 'html_selectors',
      selectors: { item: '.card', title: '  ', price: '.price' },
    });

    expect(parsed.selectors).toMatchObject({
      item: '.card',
      title: null,
      price: '.price',
    });
  });
});
