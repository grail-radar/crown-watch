import { ProductSnapshot } from './snapshot';

/** Per-source adapter settings, stored as data on the source row. */
export interface WatchConfig {
  adapter: string;
  /** Shopify's product feed omits currency, so the operator supplies it. */
  currency?: string | null;
  /** Overrides the base used to build product URLs; derived from the endpoint otherwise. */
  productUrlBase?: string | null;
}

export type StoreAdapter = (body: string, config: WatchConfig, endpoint: string) => ProductSnapshot[];

export class AdapterError extends Error {}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** `https://brand.example/products.json?limit=5` → `https://brand.example` */
export function storeBaseFrom(endpoint: string, config: WatchConfig): string {
  const override = config.productUrlBase?.trim();
  if (override) return override.replace(/\/$/, '');
  try {
    return new URL(endpoint).origin;
  } catch {
    throw new AdapterError(`Cannot derive a store base from endpoint: ${endpoint}`);
  }
}

/**
 * Shopify storefronts expose a public product feed with per-variant
 * availability — structured, complete, and with nothing to misread. Where a
 * brand offers it, this is the highest-quality signal available.
 */
export const shopifyProductsJson: StoreAdapter = (body, config, endpoint) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AdapterError('Response was not valid JSON');
  }
  const products = (parsed as { products?: unknown })?.products;
  if (!Array.isArray(products)) {
    throw new AdapterError('Response did not contain a products array');
  }

  const base = storeBaseFrom(endpoint, config);
  const currency = config.currency?.trim().toUpperCase() || null;

  return products.flatMap((raw): ProductSnapshot[] => {
    const p = raw as {
      handle?: unknown;
      title?: unknown;
      variants?: unknown;
      images?: unknown;
    };
    const handle = typeof p.handle === 'string' ? p.handle.trim() : '';
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    if (!handle || !title) return [];

    const variants = Array.isArray(p.variants) ? p.variants : [];
    // A product is buyable if any variant is — matching what a shopper sees.
    const available = variants.some(
      (v) => (v as { available?: unknown })?.available === true,
    );
    const prices = variants
      .map((v) => toNumber((v as { price?: unknown })?.price))
      .filter((n): n is number => n !== null);

    const images = Array.isArray(p.images) ? p.images : [];
    const firstImage = images
      .map((i) => (i as { src?: unknown })?.src)
      .find((src): src is string => typeof src === 'string' && /^https?:\/\//i.test(src));

    return [
      {
        url: `${base}/products/${handle}`,
        title,
        price: prices.length ? Math.min(...prices) : null,
        currency,
        imageUrl: firstImage ?? null,
        available,
      },
    ];
  });
};

const ADAPTERS: Record<string, StoreAdapter> = {
  shopify_products_json: shopifyProductsJson,
};

export function getAdapter(name: string): StoreAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new AdapterError(
      `Unknown adapter "${name}". Known adapters: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }
  return adapter;
}

export function parseWatchConfig(value: unknown): WatchConfig {
  const config = (value ?? {}) as Partial<WatchConfig>;
  if (typeof config.adapter !== 'string' || !config.adapter.trim()) {
    throw new AdapterError('Source is missing watchConfig.adapter');
  }
  return {
    adapter: config.adapter.trim(),
    currency: typeof config.currency === 'string' ? config.currency : null,
    productUrlBase:
      typeof config.productUrlBase === 'string' ? config.productUrlBase : null,
  };
}
