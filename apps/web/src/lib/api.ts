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
  /**
   * `drops` counts PUBLISHED drops only. `watches` is what the card shows —
   * accessories excluded, and optional because the website and the API deploy
   * independently.
   */
  _count: { drops: number; watches?: number };
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
  /**
   * The Watch this event is about, so a card links straight there rather than
   * through the Drop URL's redirect. Null for a Drop read out of a
   * publication's prose, which keeps its own page.
   *
   * Optional because the website and the API deploy independently.
   */
  watch?: { brandSlug: string; watchSlug: string } | null;
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
 * One thing a brand sells, as the brand page lists it.
 *
 * A summary only; the thing's own page carries every way to buy it. One Watch
 * however many store products sit beneath it — three YEMA listings for the
 * Superman Bronze CMM.10 are `variantCount: 3` here, not three entries (#28).
 */
export interface BrandWatchSummary {
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

/**
 * Something a brand sells that is not a watch — a strap, a bracelet, a box.
 *
 * The same shape, because the two lists answer the same question at a glance;
 * a distinct name because an Accessory never appears as a Drop and never
 * reaches a Channel (ADR-0006), and that difference is worth keeping visible.
 */
export type BrandAccessory = BrandWatchSummary;

/**
 * What a brand's watches cost, cheapest to dearest, read off their Variants.
 *
 * `currency` is null when the stores never stated one — most Shopify feeds
 * give a bare number, and reading a symbol into it is how a €990 watch was
 * once shown as $990 (#24). The API withholds the band entirely rather than
 * span two currencies.
 */
export interface PriceBand {
  low: string;
  high: string;
  currency: string | null;
}

export interface BrandDetail {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  instagramHandle: string | null;
  country: string | null;
  foundedYearEst: number | null;
  /** `listed` or `curated` — see the Annotation below. */
  status: string;
  createdAt: string;
  /**
   * The one honest sentence about this Brand, or null.
   *
   * Only ever present on a Curated Brand: the API withholds a draft that
   * nobody has approved, so anything here can be shown as written (#22).
   * Never purchasable, in any form (ADR-0004).
   */
  annotation?: string | null;
  annotationApprovedAt?: string | null;
  /**
   * What the brand costs, or null when nothing it makes carries a price.
   * Derived, never entered — a hand-kept band is a band that goes stale.
   */
  priceBand?: PriceBand | null;
  /**
   * Every Watch the brand makes, each exactly once. Capped by the API, so it
   * may be shorter than {@link watchCount}.
   */
  watches?: BrandWatchSummary[];
  /** The true number of Watches, which is what the page says out loud. */
  watchCount?: number;
  /**
   * The recent events, already collapsed to one per Watch by the API — a
   * release announced once per store product is still one release (ADR-0003).
   */
  drops: DropSummary[];
  /**
   * Empty for a brand that sells only watches. **Optional, not merely
   * possibly-empty**: the website and the API deploy independently, so a web
   * build can be live against an API that predates this field. The same is
   * true of `watches`, `watchCount` and `priceBand` above.
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

/** One Watch as the sitemap needs it: where it lives and when it last moved. */
export interface WatchIndexEntry {
  slug: string;
  updatedAt: string;
  brand: { slug: string };
}

/**
 * Every Watch worth indexing. Accessories are excluded by the API, so a gift
 * card never reaches a search result (ADR-0006).
 *
 * Degrades to empty rather than throwing: a sitemap missing its watches is a
 * bad day for SEO, and a sitemap that 500s is a worse one.
 */
export async function getWatches(take = 200): Promise<WatchIndexEntry[]> {
  try {
    const res = await fetch(`${API_URL}/watches?take=${take}`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { watches?: WatchIndexEntry[] };
    return body.watches ?? [];
  } catch {
    return [];
  }
}

/** The Watch a Drop is about, so its URL can redirect there. */
export interface DropWatch {
  dropId: string;
  /** Null when the Drop is about no Watch — an RSS-extracted one. */
  watch: { brandSlug: string; watchSlug: string } | null;
}

/**
 * Which Watch a Drop URL should land on, or null when there is no such
 * published Drop.
 *
 * Distinct from `getDrop` on purpose: this answers for *any* published Drop,
 * including the accessory ones the feed no longer serves. Their URLs were in
 * the sitemap, so a 404 would throw away a page search engines already hold.
 */
export async function getDropWatch(id: string): Promise<DropWatch | null> {
  try {
    const res = await fetch(
      `${API_URL}/drops/${encodeURIComponent(id)}/watch`,
      { cache: 'no-store' },
    );
    if (!res.ok) return null;
    return (await res.json()) as DropWatch;
  } catch {
    return null;
  }
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
