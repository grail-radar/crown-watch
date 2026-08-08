/**
 * Which of a store's products are the same Watch, as one shared answer.
 *
 * Both readers of the grouping have to agree: `WatchWriterService` builds the
 * catalogue a brand page shows, and `diffWatches` decides what gets announced.
 * If they grouped independently they would eventually disagree — a Drop about a
 * Watch that has no such row, or three variants on the page and two messages in
 * the Channel — so the rule is applied in exactly one place.
 *
 * The rule itself lives in `watch-identity.ts`. This puts products into buckets
 * by it, and lets an operator overrule it per product.
 */
import { ProductSnapshot } from './snapshot';
import { slugify, WatchIdentity, watchIdentity } from './watch-identity';

/**
 * One store product re-homed by hand.
 *
 * ADR-0003 accepted a deliberately simple identity rule *on the condition* that
 * corrections are cheap; this is that condition. Both directions come from the
 * one mechanism: give two products the same `watchKey` to force a merge, give
 * one product a key of its own to force a split.
 */
export interface GroupingOverride {
  productUrl: string;
  watchKey: string;
  /**
   * What the forced Watch is called. Null or absent means the rule's own name
   * for whichever product lands in the group first — right for a merge, where
   * the products already agree, and usually worth setting for a split.
   */
  watchName?: string | null;
}

/** One product, and the identity it resolved to — kept together so they cannot drift apart. */
export interface WatchGroupEntry {
  product: ProductSnapshot;
  /** This product's own identity, which carries its reference. */
  identity: WatchIdentity;
  /** True when an override, rather than the rule, decided where it groups. */
  overridden: boolean;
}

export interface WatchGroup {
  identity: WatchIdentity;
  entries: WatchGroupEntry[];
}

export interface Grouping {
  groups: Map<string, WatchGroup>;
  /** Override URLs that re-homed a product this poll. */
  applied: string[];
  /**
   * Override URLs the store does not list. Harmless — nothing is regrouped —
   * but reported rather than ignored: a correction for a product that has been
   * delisted or had its URL changed is doing nothing, and an operator who
   * cannot see that will believe it still holds.
   */
  unmatched: string[];
}

/**
 * Group a store's products into Watches.
 *
 * Insertion-ordered, so a caller that iterates gets the store's own ordering
 * rather than something that shifts between polls for no reason.
 */
export function groupByWatch(
  brandSlug: string,
  products: ProductSnapshot[],
  overrides: GroupingOverride[] = [],
): Grouping {
  const byUrl = new Map(overrides.map((o) => [o.productUrl, o]));
  const groups = new Map<string, WatchGroup>();
  const named = new Map<string, string>();
  const applied: string[] = [];

  for (const product of products) {
    // Computed once and carried: the rule is pure, but this is also the hot
    // path for a store with two hundred products. It is computed even when an
    // override wins, because the override replaces where the product groups —
    // not its reference, which is the store's own per-variant identity.
    const ruled = watchIdentity(brandSlug, product.title);
    const override = byUrl.get(product.url);
    if (override) applied.push(override.productUrl);

    const key = override ? override.watchKey : ruled.key;
    // An override says *where* a product belongs, not what the group is called.
    // So an explicit name wins, then the rule's name for any product that was
    // not re-homed — otherwise merging a stray into a published Watch would
    // rename that Watch to the very title being corrected, if the store
    // happened to list the stray first.
    if (override?.watchName) {
      named.set(key, override.watchName);
    } else if (!override && !named.has(key)) {
      named.set(key, ruled.name);
    }

    const identity: WatchIdentity = override
      ? { key, name: ruled.name, slug: ruled.slug, reference: ruled.reference }
      : ruled;

    const group = groups.get(key) ?? { identity, entries: [] };
    group.entries.push({ product, identity, overridden: override !== undefined });
    groups.set(key, group);
  }

  // Second pass, because the name a group settles on can be decided by a
  // product the store listed after the one that created the group.
  for (const [key, group] of groups) {
    const name = named.get(key) ?? group.entries[0].identity.name;
    group.identity = { ...group.identity, name, slug: slugify(name) };
  }

  const matched = new Set(applied);
  return {
    groups,
    applied,
    unmatched: overrides
      .map((o) => o.productUrl)
      .filter((url) => !matched.has(url)),
  };
}
