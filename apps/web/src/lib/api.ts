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

export interface DropSummary {
  id: string;
  title: string;
  type: string;
  priceLow: string | null;
  priceHigh: string | null;
  currency: string | null;
  eventDate: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  sourceName: string | null;
}

export interface FeedDrop extends DropSummary {
  brand: { name: string; slug: string };
}

export interface DropFeed {
  total: number;
  count: number;
  drops: FeedDrop[];
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
