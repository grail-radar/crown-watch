/**
 * Normalising and hashing a store's catalogue — the layer below the diff.
 *
 * What a change *means* is `watch-events.spec.ts`: it is decided in Watches,
 * not in products, so it does not live here.
 */
import {
  hashSnapshot,
  normalizeSnapshot,
  ProductSnapshot,
  signalHash,
} from './snapshot';

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

/**
 * The narrower identity: is there anything here that could become a Drop?
 *
 * `hashSnapshot` asks "did the store's answer change at all". This asks "did it
 * change in a way anybody could be told about", and the gap between the two is
 * the near-hourly no-op snapshot YEMA was producing from its alternating market
 * price lists.
 */
describe('signalHash', () => {
  describe('what cannot raise a Drop is invisible to it', () => {
    it('ignores a price that moved', () => {
      expect(signalHash([product({ price: 500 })])).toBe(
        signalHash([product({ price: 450 })]),
      );
    });

    it('ignores a price appearing or disappearing', () => {
      expect(signalHash([product({ price: 500 })])).toBe(
        signalHash([product({ price: null })]),
      );
    });

    it('ignores a currency label the store started or stopped printing', () => {
      expect(signalHash([product({ currency: 'EUR' })])).toBe(
        signalHash([product({ currency: null })]),
      );
    });

    it('ignores a swapped photograph', () => {
      expect(signalHash([product({ imageUrl: 'https://cdn.example/a.jpg' })])).toBe(
        signalHash([product({ imageUrl: 'https://cdn.example/b.jpg' })]),
      );
    });

    it('ignores all of them moving at once', () => {
      expect(
        signalHash([product({ price: 500, currency: 'EUR', imageUrl: 'a' })]),
      ).toBe(signalHash([product({ price: 9, currency: null, imageUrl: 'b' })]));
    });
  });

  describe('what can raise a Drop still changes it', () => {
    it('notices a product URL it has never seen', () => {
      expect(signalHash([product({ url: 'https://brand.example/products/x' })])).not.toBe(
        signalHash([product({ url: 'https://brand.example/products/y' })]),
      );
    });

    it('notices availability turning true', () => {
      expect(signalHash([product({ available: false })])).not.toBe(
        signalHash([product({ available: true })]),
      );
    });

    it('notices a product arriving alongside the ones already there', () => {
      const a = product({ url: 'https://brand.example/products/a' });
      const b = product({ url: 'https://brand.example/products/b' });
      expect(signalHash([a])).not.toBe(signalHash(normalizeSnapshot([a, b])));
    });

    it('notices a retitled product, even though a title raises no Drop by itself', () => {
      // Not cosmetic, despite appearances. `groupByWatch` derives its key from
      // the title, so the stored snapshot's titles decide how the *previous*
      // state is grouped. Let one go stale and a Watch's since-delisted
      // references drop out of `wasBuyable`, which is how a restock that never
      // happened gets announced.
      expect(signalHash([product({ title: 'Model A' })])).not.toBe(
        signalHash([product({ title: 'Model A — Bronze' })]),
      );
    });
  });

  it('survives a jsonb round trip like its wider sibling', () => {
    const inMemory = product();
    const roundTripped = {
      available: inMemory.available,
      imageUrl: inMemory.imageUrl,
      currency: inMemory.currency,
      price: inMemory.price,
      title: inMemory.title,
      url: inMemory.url,
    } as ProductSnapshot;
    expect(signalHash([roundTripped])).toBe(signalHash([inMemory]));
  });

  it('is not the same hash as the wide one, for the same products', () => {
    // Belt and braces: if these ever collided, narrowing would be a no-op and
    // every test above would pass for the wrong reason.
    expect(signalHash([product()])).not.toBe(hashSnapshot([product()]));
  });
});
