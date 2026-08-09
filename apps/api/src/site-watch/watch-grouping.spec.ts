/**
 * Putting a store's products into Watches, and correcting it when the rule is
 * wrong — pure, no I/O.
 *
 * ADR-0003 accepted a deliberately simple identity rule *on the condition* that
 * corrections are cheap. These are that condition's tests, and they sit
 * alongside the rule's own case table in `watch-identity.spec.ts` on purpose:
 * the two are read together when deciding whether a grouping is a bug in the
 * rule or a case for an override.
 */
import { ProductSnapshot } from './snapshot';
import { groupByWatch } from './watch-grouping';

const product = (
  over: Partial<ProductSnapshot> & { url: string },
): ProductSnapshot => ({
  title: 'Superman Bronze CMM.10',
  price: 2190,
  currency: 'EUR',
  imageUrl: null,
  available: true,
  ...over,
});

const names = (grouping: ReturnType<typeof groupByWatch>) =>
  [...grouping.groups.values()].map((g) => g.identity.name).sort();

describe('groupByWatch', () => {
  it('follows the rule when nothing overrides it', () => {
    const grouping = groupByWatch('yema', [
      product({ url: 'https://yema.example/products/u8' }),
      product({ url: 'https://yema.example/products/u7' }),
    ]);

    expect(grouping.groups.size).toBe(1);
    expect(grouping.applied).toEqual([]);
    expect(grouping.unmatched).toEqual([]);
  });

  describe('forcing a merge', () => {
    // The real shape: a store appends a reference to one product and not to its
    // siblings, so the rule splits one watch in two.
    const products = [
      product({ url: 'https://yema.example/products/u8', title: 'Superman Bronze' }),
      product({
        url: 'https://yema.example/products/u7',
        title: 'Superman Bronze Ref. CMM.10',
      }),
    ];

    it('splits them without an override, which is the bug being fixed', () => {
      expect(groupByWatch('yema', products).groups.size).toBe(2);
    });

    it('groups them into one Watch when told to', () => {
      const grouping = groupByWatch('yema', products, {
        overrides: [
          { productUrl: 'https://yema.example/products/u7', watchKey: 'yema:superman bronze' },
        ],
      });

      expect(grouping.groups.size).toBe(1);
      const [group] = [...grouping.groups.values()];
      expect(group.entries).toHaveLength(2);
      expect(grouping.applied).toEqual(['https://yema.example/products/u7']);
    });

    it('keeps the name of the Watch being merged into, not the stray’s', () => {
      // The override says where the stray belongs, not what the group is
      // called. Taking the name from whichever product the store happened to
      // list first would rename a published Watch to the title being corrected.
      const grouping = groupByWatch(
        'yema',
        // Store order puts the stray first, which is the case that breaks.
        [products[1], products[0]],
        {
          overrides: [
            {
              productUrl: 'https://yema.example/products/u7',
              watchKey: 'yema:superman bronze',
            },
          ],
        },
      );

      expect(names(grouping)).toEqual(['Superman Bronze']);
    });

    it('keeps each product’s own reference after the merge', () => {
      // The reference is the only per-variant identity a store gives away, and
      // it must not be flattened by re-homing the product.
      const grouping = groupByWatch('serica', [
        product({ url: 'https://serica.example/products/a', title: 'Réf. 8315-2 (SYU66-20-SS)' }),
        product({ url: 'https://serica.example/products/b', title: 'Réf. 8315-2 (SYU66-20-BR)' }),
      ], {
        overrides: [
          { productUrl: 'https://serica.example/products/b', watchKey: 'serica:réf. 8315-2' },
        ],
      });

      const [group] = [...grouping.groups.values()];
      expect(group.entries.map((e) => e.identity.reference).sort()).toEqual([
        'SYU66-20-BR',
        'SYU66-20-SS',
      ]);
    });
  });

  describe('forcing a split', () => {
    // Two genuinely different models a store happens to title identically —
    // the limited edition that should stand apart from the standard one.
    const products = [
      product({ url: 'https://brand.example/products/standard', title: 'Aquascaphe' }),
      product({ url: 'https://brand.example/products/limited', title: 'Aquascaphe' }),
    ];

    it('merges them without an override, which is the bug being fixed', () => {
      expect(groupByWatch('baltic', products).groups.size).toBe(1);
    });

    it('separates them into two Watches when told to', () => {
      const grouping = groupByWatch('baltic', products, {
        overrides: [
          {
            productUrl: 'https://brand.example/products/limited',
            watchKey: 'baltic:aquascaphe limited',
            watchName: 'Aquascaphe Limited Edition',
          },
        ],
      });

      expect(grouping.groups.size).toBe(2);
      expect(names(grouping)).toEqual(['Aquascaphe', 'Aquascaphe Limited Edition']);
    });

    it('falls back to the rule’s name when the override does not give one', () => {
      const grouping = groupByWatch('baltic', products, {
        overrides: [
          {
            productUrl: 'https://brand.example/products/limited',
            watchKey: 'baltic:aquascaphe limited',
          },
        ],
      });

      expect(grouping.groups.size).toBe(2);
      expect(names(grouping)).toEqual(['Aquascaphe', 'Aquascaphe']);
    });
  });

  it('reports an override the store no longer matches', () => {
    // Harmless — nothing is regrouped — but it must not be silent, or a stale
    // correction sits in the table forever looking like it is doing something.
    const grouping = groupByWatch(
      'yema',
      [product({ url: 'https://yema.example/products/u8' })],
      {
        overrides: [
          { productUrl: 'https://yema.example/products/delisted', watchKey: 'yema:whatever' },
        ],
      },
    );

    expect(grouping.groups.size).toBe(1);
    expect(grouping.applied).toEqual([]);
    expect(grouping.unmatched).toEqual(['https://yema.example/products/delisted']);
  });

  it('ignores an override for a product of a different store', () => {
    const grouping = groupByWatch(
      'yema',
      [product({ url: 'https://yema.example/products/u8' })],
      {
        overrides: [
          { productUrl: 'https://baltic.example/products/other', watchKey: 'yema:merged' },
        ],
      },
    );

    expect(grouping.groups.size).toBe(1);
    expect(grouping.unmatched).toEqual(['https://baltic.example/products/other']);
  });

  it('gives the same answer every time it is asked', () => {
    // Called on every poll of every store. A grouping that shifted between
    // identical polls would re-partition a published catalogue for no reason.
    const products = [
      product({ url: 'https://yema.example/products/a', title: 'One' }),
      product({ url: 'https://yema.example/products/b', title: 'Two' }),
    ];
    const rules = {
      overrides: [
        { productUrl: 'https://yema.example/products/b', watchKey: 'yema:one' },
      ],
    };

    const first = groupByWatch('yema', products, rules);
    const second = groupByWatch('yema', products, rules);

    expect([...second.groups.keys()]).toEqual([...first.groups.keys()]);
    expect(names(second)).toEqual(names(first));
  });
});
