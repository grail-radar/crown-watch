import {
  diffSnapshots,
  hashSnapshot,
  normalizeSnapshot,
  ProductSnapshot,
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
});

describe('diffSnapshots', () => {
  it('reports a new product url as a new release', () => {
    const changes = diffSnapshots(
      [product({ url: 'https://brand.example/products/a' })],
      [
        product({ url: 'https://brand.example/products/a' }),
        product({ url: 'https://brand.example/products/b', title: 'Model B' }),
      ],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('new_product');
    expect(changes[0].product.title).toBe('Model B');
  });

  it('reports a sold-out product coming back as a restock', () => {
    const changes = diffSnapshots(
      [product({ available: false })],
      [product({ available: true })],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('restock');
  });

  it('says nothing when a product sells out', () => {
    expect(
      diffSnapshots([product({ available: true })], [product({ available: false })]),
    ).toEqual([]);
  });

  it('says nothing when only the price changes', () => {
    expect(
      diffSnapshots([product({ price: 500 })], [product({ price: 550 })]),
    ).toEqual([]);
  });

  it('says nothing when only the title or image changes', () => {
    expect(
      diffSnapshots(
        [product({ title: 'Model A', imageUrl: null })],
        [product({ title: 'Model A (2026)', imageUrl: 'https://img.example/a.jpg' })],
      ),
    ).toEqual([]);
  });

  it('says nothing when a product stays available', () => {
    expect(
      diffSnapshots([product({ available: true })], [product({ available: true })]),
    ).toEqual([]);
  });

  it('says nothing when a product disappears from the catalogue', () => {
    expect(diffSnapshots([product()], [])).toEqual([]);
  });

  it('reports several changes from one poll', () => {
    const changes = diffSnapshots(
      [
        product({ url: 'https://brand.example/products/a', available: false }),
        product({ url: 'https://brand.example/products/b' }),
      ],
      [
        product({ url: 'https://brand.example/products/a', available: true }),
        product({ url: 'https://brand.example/products/b' }),
        product({ url: 'https://brand.example/products/c' }),
      ],
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(['new_product', 'restock']);
  });

  it('treats everything as new when there is no previous snapshot', () => {
    // The service uses this only for the baseline decision; it must not
    // silently swallow the first poll's contents.
    expect(diffSnapshots([], [product()])).toHaveLength(1);
  });
});
