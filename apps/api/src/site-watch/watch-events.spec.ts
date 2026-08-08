/**
 * What a poll should announce, expressed in Watches rather than in products.
 *
 * Pure — no database. The cases are the ones that decide whether a follower
 * gets one message or three, and whether they get one at all.
 */
import { ProductSnapshot } from './snapshot';
import { diffWatches } from './watch-events';

const BRAND = 'yema';

const product = (
  over: Partial<ProductSnapshot> & { url: string },
): ProductSnapshot => ({
  title: 'Superman Bronze CMM.10',
  price: 2190,
  currency: 'EUR',
  imageUrl: 'https://cdn.example/a.jpg',
  available: true,
  ...over,
});

describe('diffWatches', () => {
  it('announces one release when a store lists one model as three products', () => {
    // 2026-08-06: this exact catalogue put three near-identical messages on
    // both Channels within a second.
    const events = diffWatches(BRAND, [], [
      product({ url: 'https://yema.example/products/superman-u8' }),
      product({ url: 'https://yema.example/products/superman-u7' }),
      product({ url: 'https://yema.example/products/superman-u4' }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('new_watch');
    expect(events[0].identity.name).toBe('Superman Bronze CMM.10');
    expect(events[0].products).toHaveLength(3);
  });

  it('still announces two watches that only look like one line', () => {
    // The Baltic case. Collapsing these would be the opposite failure: one
    // message for two watches an enthusiast wants told apart.
    const events = diffWatches('baltic', [], [
      product({ url: 'https://baltic.example/products/panda', title: 'Scalegraph Classic - Panda' }),
      product({ url: 'https://baltic.example/products/reverse', title: 'Scalegraph Classic - Reverse Panda' }),
    ]);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === 'new_watch')).toBe(true);
  });

  it('says nothing at all when the catalogue has not moved', () => {
    const catalogue = [product({ url: 'https://yema.example/products/superman-u8' })];

    expect(diffWatches(BRAND, catalogue, catalogue)).toEqual([]);
  });

  describe('restocks, which are about the Watch and not the reference', () => {
    const u8 = 'https://yema.example/products/superman-u8';
    const u7 = 'https://yema.example/products/superman-u7';

    it('announces a restock when a sold-out Watch can be bought again', () => {
      const events = diffWatches(
        BRAND,
        [product({ url: u8, available: false }), product({ url: u7, available: false })],
        [product({ url: u8, available: true }), product({ url: u7, available: false })],
      );

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('restock');
    });

    it('stays silent when a Watch that was never sold out gains a configuration back', () => {
      // The wart ADR-0003 accepted and #26 removes: the Watch was buyable the
      // whole time, so telling a follower it is "back in stock" is a lie that
      // costs the Channel its credibility.
      const events = diffWatches(
        BRAND,
        [product({ url: u8, available: true }), product({ url: u7, available: false })],
        [product({ url: u8, available: true }), product({ url: u7, available: true })],
      );

      expect(events).toEqual([]);
    });

    it('announces one restock, not one per reference that returned', () => {
      const events = diffWatches(
        BRAND,
        [product({ url: u8, available: false }), product({ url: u7, available: false })],
        [product({ url: u8, available: true }), product({ url: u7, available: true })],
      );

      expect(events).toHaveLength(1);
    });

    it('says nothing when a Watch sells out', () => {
      const events = diffWatches(
        BRAND,
        [product({ url: u8, available: true })],
        [product({ url: u8, available: false })],
      );

      expect(events).toEqual([]);
    });
  });

  it('does not announce a retitle as a new release', () => {
    // A store tidying a title changes the grouping key, so anything comparing
    // keys would read a rename as a brand-new watch and announce it. Novelty
    // is decided by the product URL, which is the thing that exists in the
    // world.
    const url = 'https://yema.example/products/superman-u8';

    const events = diffWatches(
      BRAND,
      [product({ url, title: 'Superman Bronze CMM.10' })],
      [product({ url, title: 'Superman Bronze CMM.10 Automatic' })],
    );

    expect(events).toEqual([]);
  });

  it('does not announce a new buying option for a Watch already on sale', () => {
    // A third bracelet for a model that launched last year is not a release.
    const events = diffWatches(
      BRAND,
      [product({ url: 'https://yema.example/products/superman-u8', available: true })],
      [
        product({ url: 'https://yema.example/products/superman-u8', available: true }),
        product({ url: 'https://yema.example/products/superman-u7', available: true }),
      ],
    );

    expect(events).toEqual([]);
  });

  it('treats a new reference for a sold-out Watch as that Watch returning', () => {
    const events = diffWatches(
      BRAND,
      [product({ url: 'https://yema.example/products/superman-u8', available: false })],
      [
        product({ url: 'https://yema.example/products/superman-u8', available: false }),
        product({ url: 'https://yema.example/products/superman-u7', available: true }),
      ],
    );

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('restock');
  });

  describe('what the one message ends up saying', () => {
    it('leads with a reference a reader can actually buy', () => {
      // Linking a sold-out reference when a sibling is in stock sends the
      // reader to a dead end for a watch that is genuinely available.
      const events = diffWatches(BRAND, [], [
        product({ url: 'https://yema.example/products/sold-out', price: 2190, available: false }),
        product({ url: 'https://yema.example/products/in-stock', price: 2400, available: true }),
      ]);

      expect(events[0].lead.url).toBe('https://yema.example/products/in-stock');
    });

    it('prefers the cheapest of the references a reader can buy', () => {
      const events = diffWatches(BRAND, [], [
        product({ url: 'https://yema.example/products/steel', price: 2400, available: true }),
        product({ url: 'https://yema.example/products/rubber', price: 2190, available: true }),
      ]);

      expect(events[0].lead.url).toBe('https://yema.example/products/rubber');
    });

    it('carries the span of prices the references are sold at', () => {
      const events = diffWatches(BRAND, [], [
        product({ url: 'https://yema.example/products/a', price: 2190 }),
        product({ url: 'https://yema.example/products/b', price: 2400 }),
        product({ url: 'https://yema.example/products/c', price: null }),
      ]);

      expect(events[0].priceLow).toBe(2190);
      expect(events[0].priceHigh).toBe(2400);
    });

    it('has no price at all when no reference carries one', () => {
      const events = diffWatches(BRAND, [], [
        product({ url: 'https://yema.example/products/a', price: null }),
      ]);

      expect(events[0].priceLow).toBeNull();
      expect(events[0].priceHigh).toBeNull();
    });

    it('falls back to a sold-out reference when nothing is buyable', () => {
      const events = diffWatches(BRAND, [], [
        product({ url: 'https://yema.example/products/only', available: false }),
      ]);

      expect(events[0].lead.url).toBe('https://yema.example/products/only');
    });
  });
});
