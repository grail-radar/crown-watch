import { createHash } from 'node:crypto';

/**
 * One product as seen on a brand's own store, reduced to the fields the radar
 * cares about. Adapters normalise every store platform into this shape, so the
 * diffing and alerting below know nothing about Shopify, HTML or anything else.
 */
export interface ProductSnapshot {
  /** Canonical product URL — the identity of a product across polls. */
  url: string;
  title: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  available: boolean;
}

export type SnapshotChangeKind = 'new_product' | 'restock';

export interface SnapshotChange {
  kind: SnapshotChangeKind;
  product: ProductSnapshot;
}

/**
 * Deterministic ordering and de-duplication, so an unchanged store always
 * produces an identical snapshot regardless of the order the store returns
 * products in. Without this, a reshuffled catalogue would look like a change.
 */
export function normalizeSnapshot(products: ProductSnapshot[]): ProductSnapshot[] {
  const byUrl = new Map<string, ProductSnapshot>();
  for (const product of products) {
    const url = product.url.trim();
    if (!url) continue;
    // Later entries win, matching "last seen state" semantics.
    byUrl.set(url, { ...product, url });
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** Identity hash of a normalised snapshot — the dedup key for a poll. */
export function hashSnapshot(products: ProductSnapshot[]): string {
  return createHash('sha256').update(JSON.stringify(products)).digest('hex');
}

/**
 * What changed between two polls, expressed as alert-worthy events.
 *
 * Only two transitions raise a drop:
 *   - a product URL that was not there before  → a new release
 *   - availability flipping false → true       → a restock
 *
 * Everything else — price edits, title tweaks, images, products going out of
 * stock, reordering — is deliberately silent. A channel that fires on noise
 * gets muted.
 */
export function diffSnapshots(
  previous: ProductSnapshot[],
  current: ProductSnapshot[],
): SnapshotChange[] {
  const before = new Map(previous.map((p) => [p.url, p]));
  const changes: SnapshotChange[] = [];

  for (const product of current) {
    const prior = before.get(product.url);
    if (!prior) {
      changes.push({ kind: 'new_product', product });
      continue;
    }
    if (!prior.available && product.available) {
      changes.push({ kind: 'restock', product });
    }
  }
  return changes;
}
