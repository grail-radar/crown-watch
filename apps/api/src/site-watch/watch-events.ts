/**
 * What changed between two polls, expressed as events about **Watches**.
 *
 * This replaces a per-product diff, and the difference is the whole point of
 * ADR-0003. On 2026-08-06 YEMA listed one model as three products, the diff
 * produced three Drops, and both Channels announced the same watch three times
 * within a second. A Channel that repeats itself gets muted (ADR-0002), so the
 * grouping has to happen before anything is announced rather than after.
 *
 * Two transitions raise an event, and they are deliberately narrow:
 *
 *   - a Watch none of whose products we had seen before  → a new release
 *   - a Watch with nothing buyable that has something now → a restock
 *
 * Everything else stays silent: price edits, title tweaks, images, a Watch
 * selling out, a new bracelet for a model that launched last year. A Channel
 * that fires on noise gets muted just as surely as one that repeats itself.
 */
import { WatchKind } from '@prisma/client';
import { ProductSnapshot } from './snapshot';
import { WatchIdentity } from './watch-identity';
import { GroupingRules, groupByWatch } from './watch-grouping';

export type WatchEventKind = 'new_watch' | 'restock';

export interface WatchEvent {
  kind: WatchEventKind;
  identity: WatchIdentity;
  /** Every product the store currently lists for this Watch. */
  products: ProductSnapshot[];
  /** The one a reader should be sent to — see `pickLead`. */
  lead: ProductSnapshot;
  /** Cheapest and dearest across the references, or null when none say. */
  priceLow: number | null;
  priceHigh: number | null;
}

/**
 * The reference the message links to.
 *
 * Availability first, price second. Linking a sold-out reference while a
 * sibling is in stock sends a reader to a dead end for a watch they could
 * actually have bought — the specific way this goes wrong that is worth code.
 * With nothing buyable at all, the cheapest stands in, so the message still has
 * somewhere to point.
 */
function pickLead(products: ProductSnapshot[]): ProductSnapshot {
  const ranked = [...products].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const priceA = a.price ?? Number.POSITIVE_INFINITY;
    const priceB = b.price ?? Number.POSITIVE_INFINITY;
    return priceA - priceB;
  });
  return ranked[0];
}

function priceSpan(products: ProductSnapshot[]): {
  priceLow: number | null;
  priceHigh: number | null;
} {
  const prices = products
    .map((p) => p.price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  if (prices.length === 0) return { priceLow: null, priceHigh: null };
  return { priceLow: Math.min(...prices), priceHigh: Math.max(...prices) };
}

/**
 * `rules` are the operator's corrections, and they have to be the same ones the
 * catalogue was built with — otherwise a poll announces a Watch the brand page
 * does not have.
 */
export function diffWatches(
  brandSlug: string,
  previous: ProductSnapshot[],
  current: ProductSnapshot[],
  rules: GroupingRules = {},
): WatchEvent[] {
  const before = new Map(previous.map((p) => [p.url, p]));
  // The previous poll grouped the same way, so this is how the Watch looked
  // last time — including references the store has since delisted.
  const groupedBefore = groupByWatch(brandSlug, previous, rules).groups;
  const events: WatchEvent[] = [];

  for (const group of groupByWatch(brandSlug, current, rules).groups.values()) {
    // A strap is a real thing the brand sells and it is recorded in full, but
    // it is not a watch landing, and the feed promises nothing else (ADR-0006).
    if (group.kind !== WatchKind.watch) continue;

    // Novelty is decided by product URL, never by the grouping key. A store
    // tidying a title changes the key, and a key comparison would read that
    // rename as a brand-new watch and announce a release that never happened.
    const products = group.entries.map((e) => e.product);
    const known = products
      .map((p) => before.get(p.url))
      .filter((p): p is ProductSnapshot => p !== undefined);

    const lead = pickLead(products);
    const span = priceSpan(products);

    if (known.length === 0) {
      events.push({ kind: 'new_watch', identity: group.identity, products, lead, ...span });
      continue;
    }

    // Availability is a property of the Watch, not of one reference. ADR-0003
    // originally fired on any Variant returning and named the cost: a follower
    // told "back in stock" about a watch that never left. #26 chose the other
    // side — the Watch has to have been genuinely unbuyable.
    //
    // Judged over everything the Watch had last poll, not only the references
    // that survived into this one. A store that delists its in-stock reference
    // while a sold-out sibling returns leaves the Watch on sale throughout, and
    // looking only at the survivors would announce that as a restock.
    const previousProducts = [
      ...(groupedBefore.get(group.identity.key)?.entries.map((e) => e.product) ??
        []),
      ...known,
    ];
    const wasBuyable = previousProducts.some((p) => p.available);
    const isBuyable = products.some((p) => p.available);
    if (!wasBuyable && isBuyable) {
      events.push({ kind: 'restock', identity: group.identity, products, lead, ...span });
    }
  }

  return events;
}
