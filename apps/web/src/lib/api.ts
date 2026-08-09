// Server-side client for the Crown Watch API (imported only by server
// components). Set API_URL in the environment (Vercel) to your API's URL,
// e.g. https://crown-watch-api.onrender.com. Read at runtime, so no rebuild is
// needed when it changes. Falls back to local dev.
const API_URL = (
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3333'
).replace(/\/$/, '');

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  foundedYearEst: number | null;
  website: string | null;
  status: string;
  createdAt: string;
  /** Count of PUBLISHED drops only. */
  _count: { drops: number };
}

export interface BrandList {
  total: number;
  count: number;
  brands: BrandSummary[];
}

/**
 * Where a reader can act on a drop.
 *
 * `store`      — the brand's own product page. They can buy this watch.
 * `brand_site` — the brand's homepage. Honest, but they still have to find it.
 *
 * Decided by the API, never here. The same rule drives the Telegram channels,
 * so the two cannot describe one drop differently — and the web app cannot
 * drift from it, because it never sees what the decision was made from.
 */
export interface PurchaseLink {
  url: string;
  kind: 'store' | 'brand_site';
}

export interface DropSummary {
  id: string;
  title: string;
  type: string;
  priceLow: string | null;
  priceHigh: string | null;
  currency: string | null;
  eventDate: string | null;
  imageUrl: string | null;
  /** The publication's article, when the drop came from one. Attribution. */
  sourceUrl: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  /** null when there is nothing honest to offer. */
  purchase: PurchaseLink | null;
}

export interface FeedDrop extends DropSummary {
  brand: { name: string; slug: string };
}

export interface DropFeed {
  total: number;
  count: number;
  drops: FeedDrop[];
}

/**
 * Something a brand sells that is not a watch — a strap, a bracelet, a box.
 *
 * A summary only; its own page carries every way to buy it. It never appears
 * as a Drop and never reaches a Channel (ADR-0006).
 */
export interface BrandAccessory {
  id: string;
  name: string;
  slug: string;
  /** Cheapest across its variants, or null when the store lists no price. */
  priceLow: string | null;
  currency: string | null;
  imageUrl: string | null;
  variantCount: number;
  /** True when at least one variant can be bought. */
  available: boolean;
}

export interface BrandDetail {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  instagramHandle: string | null;
  country: string | null;
  foundedYearEst: number | null;
  status: string;
  createdAt: string;
  drops: DropSummary[];
  /**
   * Empty for a brand that sells only watches. **Optional, not merely
   * possibly-empty**: the website and the API deploy independently, so a web
   * build can be live against an API that predates this field.
   */
  accessories?: BrandAccessory[];
}

/** List brands for the directory. Degrades to empty if the API is unreachable. */
export async function getBrands(take = 100): Promise<BrandList> {
  try {
    const res = await fetch(`${API_URL}/brands?take=${take}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { total: 0, count: 0, brands: [] };
    return (await res.json()) as BrandList;
  } catch {
    return { total: 0, count: 0, brands: [] };
  }
}

/** Latest published drops. Degrades to empty if the API is unreachable. */
export async function getDrops(
  take = 24,
  skip = 0,
  type?: string,
): Promise<DropFeed> {
  const params = new URLSearchParams({ take: String(take), skip: String(skip) });
  if (type) params.set('type', type);
  try {
    const res = await fetch(`${API_URL}/drops?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { total: 0, count: 0, drops: [] };
    return (await res.json()) as DropFeed;
  } catch {
    return { total: 0, count: 0, drops: [] };
  }
}

/** Fetch a single published drop, or null if not found/unreachable. */
export async function getDrop(id: string): Promise<FeedDrop | null> {
  try {
    const res = await fetch(`${API_URL}/drops/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as FeedDrop;
  } catch {
    return null;
  }
}

/** One buyable configuration of a Watch — a bracelet option, a dial. */
export interface WatchVariant {
  id: string;
  productUrl: string;
  reference: string | null;
  price: string | null;
  currency: string | null;
  imageUrl: string | null;
  available: boolean;
}

/** One model a brand makes: the durable thing, as opposed to an event. */
export interface WatchDetail {
  id: string;
  name: string;
  slug: string;
  firstSeenAt: string;
  /** Borrowed from whichever variant has one; null when none does. */
  imageUrl: string | null;
  brand: { name: string; slug: string; website: string | null };
  variants: WatchVariant[];
}

/** Fetch one watch, or null if not found/unreachable. */
export async function getWatch(
  brandSlug: string,
  watchSlug: string,
): Promise<WatchDetail | null> {
  try {
    const res = await fetch(
      `${API_URL}/watches/${encodeURIComponent(brandSlug)}/${encodeURIComponent(watchSlug)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as WatchDetail;
  } catch {
    return null;
  }
}

/** Fetch a single brand + its published drops, or null if not found/unreachable. */
export async function getBrand(slug: string): Promise<BrandDetail | null> {
  try {
    const res = await fetch(`${API_URL}/brands/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as BrandDetail;
  } catch {
    return null;
  }
}
