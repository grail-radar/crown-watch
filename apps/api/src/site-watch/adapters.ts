import { parse as parseHtml } from 'node-html-parser';
import { currencyFromPrice } from './currency';
import { ProductSnapshot } from './snapshot';

/**
 * How to read one store page's HTML.
 *
 * Selectors rather than code, so adding a brand on an ordinary storefront is a
 * database row. Only `item` and `link` are required: a listing without a title
 * falls back to the link text, and a store that never says whether something is
 * in stock is treated as always available, which is the honest reading of "the
 * page does not say".
 */
export interface HtmlSelectors {
  /** Repeating element that wraps one product. */
  item: string;
  /** Anchor inside `item` carrying the product URL. Defaults to the first <a>. */
  link?: string | null;
  title?: string | null;
  price?: string | null;
  image?: string | null;
  /** Element whose presence means sold out, e.g. `.badge--sold-out`. */
  soldOut?: string | null;
  /** Text that means sold out when found inside `item`, e.g. "Sold out". */
  soldOutText?: string | null;
  /** Element whose presence means in stock. Wins over the sold-out signals. */
  inStock?: string | null;
}

/**
 * Per-source adapter settings, stored as data on the source row.
 *
 * There is deliberately **no `currency`**. It used to live here as a label an
 * operator typed at registration, and a store serving more than one market
 * price list then announced the wrong one half the time. Currency is now read
 * from the bytes each price came from — see `currency.ts`.
 */
export interface WatchConfig {
  adapter: string;
  /** Overrides the base used to build product URLs; derived from the endpoint otherwise. */
  productUrlBase?: string | null;
  /** Required by the `html_selectors` adapter, ignored by the others. */
  selectors?: HtmlSelectors | null;
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
 *
 * **It carries no currency, so nothing here sets one.** The feed returns bare
 * numbers, and which market price list those numbers came from depends on how
 * the storefront resolved the request. YEMA serves at least two, so a label
 * would be a coin flip — and a Channel cannot unsend it (ADR-0002). Prices from
 * this adapter go out as bare numbers until the store tells us otherwise.
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
        // See the note above: the feed does not say, so neither do we.
        currency: null,
        imageUrl: firstImage ?? null,
        available,
      },
    ];
  });
};

/** Absolute, query-and-fragment-free product URL — the identity across polls. */
function absoluteUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, `${base}/`);
    if (!/^https?:$/.test(url.protocol)) return null;
    // Listing pages routinely decorate links with `?variant=`, `?ref=` or a
    // `#gallery` fragment that changes between renders. Keeping them would make
    // the same watch look like a brand new product on the next poll.
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Read a store's ordinary HTML listing page through configured selectors.
 *
 * For the brands with no machine-readable product endpoint — which, from
 * discovery, is a lot of the ones enthusiasts actually care about.
 *
 * HTML is far noisier than a feed, and the bar is that this must not
 * manufacture drops from unrelated page changes. Three things enforce that:
 * only fields the diff acts on are extracted at all (a banner or a rewritten
 * paragraph is never looked at); products are keyed on a normalised URL, so
 * reordering and tracking parameters are invisible; and text is whitespace-
 * collapsed, so a reflowed template is not a title change. Everything the
 * adapter cannot express — price edits, copy tweaks — is already silent
 * downstream, because `diffWatches` only acts on a Watch nothing was known of
 * and on a Watch becoming buyable again.
 */
export const htmlSelectors: StoreAdapter = (body, config, endpoint) => {
  const selectors = config.selectors;
  if (!selectors?.item?.trim()) {
    throw new AdapterError(
      'html_selectors adapter needs watchConfig.selectors.item',
    );
  }

  const base = storeBaseFrom(endpoint, config);

  let root: ReturnType<typeof parseHtml>;
  try {
    root = parseHtml(body);
  } catch {
    throw new AdapterError('Response could not be parsed as HTML');
  }

  // Scripts and styles are removed before anything is read: a store's inline
  // analytics blob or a rebuilt stylesheet changes on nearly every request and
  // must never reach the snapshot.
  for (const node of root.querySelectorAll('script, style, noscript')) {
    node.remove();
  }

  const text = (scope: ReturnType<typeof parseHtml>, selector?: string | null) => {
    if (!selector) return '';
    const found = scope.querySelector(selector);
    // Collapsed, so a template reflowing across lines is not a title change.
    return found ? found.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  const items = root.querySelectorAll(selectors.item);

  return items.flatMap((item): ProductSnapshot[] => {
    const anchor = selectors.link
      ? item.querySelector(selectors.link)
      : item.tagName === 'A'
        ? item
        : item.querySelector('a');
    const href = anchor?.getAttribute('href')?.trim();
    if (!href) return [];

    const url = absoluteUrl(href, base);
    if (!url) return [];

    const title =
      text(item, selectors.title) ||
      (anchor ? anchor.textContent.replace(/\s+/g, ' ').trim() : '');
    if (!title) return [];

    const image = selectors.image
      ? item.querySelector(selectors.image)
      : item.querySelector('img');
    const imageSrc =
      image?.getAttribute('src')?.trim() ||
      image?.getAttribute('data-src')?.trim() ||
      '';

    // Availability: an explicit in-stock marker wins, then either sold-out
    // signal, and a store that expresses none is taken at its word as
    // available. Guessing "sold out" from silence would invent a restock for
    // every product the first time the page did say something.
    const haystack = item.textContent.replace(/\s+/g, ' ').toLowerCase();
    const soldOutPhrase = selectors.soldOutText?.trim().toLowerCase();
    const available = selectors.inStock
      ? Boolean(item.querySelector(selectors.inStock))
      : !(
          (selectors.soldOut && item.querySelector(selectors.soldOut)) ||
          (soldOutPhrase && haystack.includes(soldOutPhrase))
        );

    // The number and its currency come from the same string, on this fetch.
    // A store that switches market price lists between polls switches both
    // together, so the two can never disagree the way a fixed label did.
    const priceText = text(item, selectors.price);

    return [
      {
        url,
        title,
        price: toNumber(priceText),
        currency: currencyFromPrice(priceText),
        imageUrl: imageSrc ? absoluteUrl(imageSrc, base) : null,
        available,
      },
    ];
  });
};

const ADAPTERS: Record<string, StoreAdapter> = {
  shopify_products_json: shopifyProductsJson,
  html_selectors: htmlSelectors,
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
  const raw = (config.selectors ?? null) as Partial<HtmlSelectors> | null;
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  return {
    adapter: config.adapter.trim(),
    // A `currency` left on an existing row is read and discarded on purpose:
    // registered sources still carry one, and silently honouring it would put
    // back the label this ticket removed.
    productUrlBase:
      typeof config.productUrlBase === 'string' ? config.productUrlBase : null,
    selectors:
      raw && str(raw.item)
        ? {
            item: str(raw.item)!,
            link: str(raw.link),
            title: str(raw.title),
            price: str(raw.price),
            image: str(raw.image),
            soldOut: str(raw.soldOut),
            soldOutText: str(raw.soldOutText),
            inStock: str(raw.inStock),
          }
        : null,
  };
}
