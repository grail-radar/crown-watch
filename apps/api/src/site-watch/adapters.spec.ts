import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdapterError,
  getAdapter,
  parseWatchConfig,
  shopifyProductsJson,
  storeBaseFrom,
  WatchConfig,
} from './adapters';

const ENDPOINT = 'https://yema.com/products.json?limit=5';
const CONFIG: WatchConfig = { adapter: 'shopify_products_json', currency: 'EUR' };

// A real response captured from a live Shopify storefront.
const fixture = readFileSync(
  resolve(__dirname, '..', '..', 'test', 'fixtures', 'yema-products.json'),
  'utf8',
);

describe('shopifyProductsJson against a real captured response', () => {
  const products = shopifyProductsJson(fixture, CONFIG, ENDPOINT);

  it('reads every product in the feed', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('builds an absolute product url from the store origin and handle', () => {
    for (const p of products) {
      expect(p.url).toMatch(/^https:\/\/yema\.com\/products\/[a-z0-9-]+$/i);
    }
  });

  it('carries title, price, currency and image through', () => {
    const withPrice = products.find((p) => p.price !== null);
    expect(withPrice).toBeDefined();
    expect(withPrice!.title.length).toBeGreaterThan(0);
    expect(withPrice!.currency).toBe('EUR');
    const withImage = products.find((p) => p.imageUrl !== null);
    expect(withImage?.imageUrl).toMatch(/^https?:\/\//);
  });

  it('produces stable identities across repeated parses', () => {
    const again = shopifyProductsJson(fixture, CONFIG, ENDPOINT);
    expect(again.map((p) => p.url)).toEqual(products.map((p) => p.url));
  });
});

describe('shopifyProductsJson edge cases', () => {
  const parse = (obj: unknown) =>
    shopifyProductsJson(JSON.stringify(obj), CONFIG, ENDPOINT);

  it('treats a product as available when any variant is', () => {
    const [p] = parse({
      products: [
        {
          handle: 'diver',
          title: 'Diver',
          variants: [
            { available: false, price: '500.00' },
            { available: true, price: '520.00' },
          ],
        },
      ],
    });
    expect(p.available).toBe(true);
  });

  it('treats a product as unavailable when no variant is', () => {
    const [p] = parse({
      products: [
        {
          handle: 'diver',
          title: 'Diver',
          variants: [{ available: false, price: '500.00' }],
        },
      ],
    });
    expect(p.available).toBe(false);
  });

  it('takes the lowest variant price', () => {
    const [p] = parse({
      products: [
        {
          handle: 'diver',
          title: 'Diver',
          variants: [
            { available: true, price: '900.00' },
            { available: true, price: '750.00' },
          ],
        },
      ],
    });
    expect(p.price).toBe(750);
  });

  it('skips products missing a handle or title rather than inventing one', () => {
    expect(
      parse({ products: [{ title: 'No handle' }, { handle: 'no-title' }] }),
    ).toHaveLength(0);
  });

  it('ignores non-http image sources', () => {
    const [p] = parse({
      products: [
        {
          handle: 'diver',
          title: 'Diver',
          variants: [],
          images: [{ src: '//cdn.example/x.jpg' }, { src: 'https://cdn.example/y.jpg' }],
        },
      ],
    });
    expect(p.imageUrl).toBe('https://cdn.example/y.jpg');
  });

  it('rejects a non-JSON body', () => {
    expect(() => shopifyProductsJson('<html>nope</html>', CONFIG, ENDPOINT)).toThrow(
      AdapterError,
    );
  });

  it('rejects JSON without a products array', () => {
    expect(() => parse({ items: [] })).toThrow(AdapterError);
  });

  it('returns nothing for an empty catalogue rather than throwing', () => {
    expect(parse({ products: [] })).toEqual([]);
  });
});

describe('configuration', () => {
  it('derives the store base from the endpoint origin', () => {
    expect(storeBaseFrom('https://brand.example/products.json?x=1', CONFIG)).toBe(
      'https://brand.example',
    );
  });

  it('prefers an explicit product url base', () => {
    expect(
      storeBaseFrom('https://api.brand.example/products.json', {
        ...CONFIG,
        productUrlBase: 'https://shop.brand.example/',
      }),
    ).toBe('https://shop.brand.example');
  });

  it('resolves a known adapter and rejects an unknown one', () => {
    expect(getAdapter('shopify_products_json')).toBe(shopifyProductsJson);
    expect(() => getAdapter('nope')).toThrow(AdapterError);
  });

  it('requires an adapter name in the source config', () => {
    expect(() => parseWatchConfig({})).toThrow(AdapterError);
    expect(() => parseWatchConfig(null)).toThrow(AdapterError);
    expect(parseWatchConfig({ adapter: 'shopify_products_json' }).adapter).toBe(
      'shopify_products_json',
    );
  });
});
