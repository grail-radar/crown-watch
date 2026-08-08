/**
 * Normalising and hashing a store's catalogue — the layer below the diff.
 *
 * What a change *means* is `watch-events.spec.ts`: it is decided in Watches,
 * not in products, so it does not live here.
 */
import { hashSnapshot, normalizeSnapshot, ProductSnapshot } from './snapshot';

const product = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  url: 'https://brand.example/products/a',
  title: 'Model A',
  price: 500,
  currency: 'EUR',
  imageUrl: null,
  available: true,
  ...over,
});

describe('normalizeSnapshot', () => {
  it('orders products so a reshuffled catalogue is not a change', () => {
    const a = product({ url: 'https://brand.example/products/a' });
    const b = product({ url: 'https://brand.example/products/b' });
    expect(hashSnapshot(normalizeSnapshot([a, b]))).toBe(
      hashSnapshot(normalizeSnapshot([b, a])),
    );
  });

  it('drops entries without a url', () => {
    expect(normalizeSnapshot([product({ url: '  ' })])).toHaveLength(0);
  });

  it('keeps the last state when a url appears twice', () => {
    const result = normalizeSnapshot([
      product({ available: false }),
      product({ available: true }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].available).toBe(true);
  });
});

describe('hashSnapshot', () => {
  it('changes when availability changes', () => {
    expect(hashSnapshot([product({ available: true })])).not.toBe(
      hashSnapshot([product({ available: false })]),
    );
  });

  it('is stable for identical input', () => {
    expect(hashSnapshot([product()])).toBe(hashSnapshot([product()]));
  });

  it('ignores object key order, so a snapshot survives a jsonb round trip', () => {
    // Postgres jsonb reorders keys. If the hash depended on key order, every
    // poll after the first would look like a change.
    const inMemory = product();
    const roundTripped = {
      available: inMemory.available,
      imageUrl: inMemory.imageUrl,
      currency: inMemory.currency,
      price: inMemory.price,
      title: inMemory.title,
      url: inMemory.url,
    } as ProductSnapshot;
    expect(hashSnapshot([roundTripped])).toBe(hashSnapshot([inMemory]));
  });

  it('still distinguishes products that differ only by url', () => {
    expect(hashSnapshot([product({ url: 'https://brand.example/products/x' })])).not.toBe(
      hashSnapshot([product({ url: 'https://brand.example/products/y' })]),
    );
  });
});
