/**
 * Which of a store's products are the same Watch, as one shared answer.
 *
 * Both readers of the grouping have to agree: `WatchWriterService` builds the
 * catalogue a brand page shows, and `diffWatches` decides what gets announced.
 * If they grouped independently they would eventually disagree — a Drop about a
 * Watch that has no such row, or three variants on the page and two messages in
 * the Channel — so the rule is applied in exactly one place.
 *
 * The rule itself lives in `watch-identity.ts`. This only puts products into
 * buckets by it.
 */
import { ProductSnapshot } from './snapshot';
import { WatchIdentity, watchIdentity } from './watch-identity';

export interface WatchGroup {
  identity: WatchIdentity;
  /** Every product the store lists for this Watch, in the order it gave them. */
  products: ProductSnapshot[];
  /** The per-product identity, which carries each one's own reference. */
  identities: WatchIdentity[];
}

/**
 * Group a store's products into Watches, keyed by identity.
 *
 * Insertion-ordered, so a caller that iterates gets the store's own ordering
 * rather than something that shifts between polls for no reason.
 */
export function groupByWatch(
  brandSlug: string,
  products: ProductSnapshot[],
): Map<string, WatchGroup> {
  const groups = new Map<string, WatchGroup>();

  for (const product of products) {
    // Computed once and carried: the rule is pure, but this is also the hot
    // path for a store with two hundred products.
    const identity = watchIdentity(brandSlug, product.title);
    const group = groups.get(identity.key) ?? {
      identity,
      products: [],
      identities: [],
    };
    group.products.push(product);
    group.identities.push(identity);
    groups.set(identity.key, group);
  }

  return groups;
}
