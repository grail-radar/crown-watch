import { SourceType } from '@prisma/client';

/**
 * Where a reader can act on a drop — and how honestly we may describe it.
 *
 * `store`      — the brand's own product page. The reader can buy this watch.
 * `brand_site` — the brand's homepage. Honest, but they still have to find it.
 */
export type PurchaseLinkKind = 'store' | 'brand_site';

export interface PurchaseLink {
  url: string;
  kind: PurchaseLinkKind;
}

export interface PurchaseLinkInput {
  /** Provenance of the drop; null when it has no source event behind it. */
  sourceType: SourceType | null | undefined;
  /** The drop's own link — a product page or an article, depending on source. */
  sourceUrl: string | null | undefined;
  brandWebsite: string | null | undefined;
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * The single answer to "where can a reader buy this?", shared by the website
 * and the Telegram channels.
 *
 * **Provenance decides, not the shape of the URL.** A drop's link is a product
 * page only when the drop came from a `site_watch` source, because only Tier 4
 * reads a brand's own storefront. Every other source — RSS, newsletter,
 * Kickstarter, a manual submission — carries a publication's article, and
 * presenting that as somewhere to buy would lie to the reader and misrepresent
 * coverage we link to as attribution (CONTEXT.md §6).
 *
 * Returning `null` is a normal answer. A misleading link costs more than a
 * missing one, so where there is nothing honest to offer, nothing is offered.
 */
export function purchaseLinkFor(input: PurchaseLinkInput): PurchaseLink | null {
  const sourceUrl = trimmed(input.sourceUrl);
  const brandWebsite = trimmed(input.brandWebsite);

  if (input.sourceType === SourceType.site_watch && sourceUrl) {
    return { url: sourceUrl, kind: 'store' };
  }

  // Including a site-watch drop that somehow has no URL: the brand's own site
  // is still true, just weaker.
  if (brandWebsite) {
    return { url: brandWebsite, kind: 'brand_site' };
  }

  return null;
}
