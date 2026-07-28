/**
 * What a drop's link actually is. Pure — no database, no network.
 *
 * This rule exists in one place because the website and the Telegram channels
 * both need the answer, and a purchase label over a magazine article shipped
 * once already when they each decided for themselves.
 */
import { SourceType } from '@prisma/client';
import { purchaseLinkFor } from './purchase-link';

const STORE_PAGE = 'https://lorier.com/products/neptune-iv';
const ARTICLE = 'https://wornandwound.com/hands-on-the-lorier-neptune-iv/';
const BRAND_SITE = 'https://lorier.com';

describe('purchaseLinkFor', () => {
  it('gives a store link for a drop the site-watch found', () => {
    // Only Tier 4 reads a brand's own storefront, so only its drops carry a
    // URL a reader can actually buy from.
    expect(
      purchaseLinkFor({
        sourceType: SourceType.site_watch,
        sourceUrl: STORE_PAGE,
        brandWebsite: BRAND_SITE,
      }),
    ).toEqual({ url: STORE_PAGE, kind: 'store' });
  });

  it('never treats an extracted drop’s article as somewhere to buy', () => {
    const link = purchaseLinkFor({
      sourceType: SourceType.rss,
      sourceUrl: ARTICLE,
      brandWebsite: BRAND_SITE,
    });

    expect(link).toEqual({ url: BRAND_SITE, kind: 'brand_site' });
    expect(link?.url).not.toBe(ARTICLE);
  });

  it('falls back to the brand’s own site for every non-store provenance', () => {
    for (const sourceType of [
      SourceType.rss,
      SourceType.newsletter,
      SourceType.kickstarter,
      SourceType.manual,
    ]) {
      expect(
        purchaseLinkFor({ sourceType, sourceUrl: ARTICLE, brandWebsite: BRAND_SITE }),
      ).toEqual({ url: BRAND_SITE, kind: 'brand_site' });
    }
  });

  it('treats a drop with no provenance at all as not buyable', () => {
    // A manually created drop may have no source event behind it.
    expect(
      purchaseLinkFor({
        sourceType: null,
        sourceUrl: ARTICLE,
        brandWebsite: BRAND_SITE,
      }),
    ).toEqual({ url: BRAND_SITE, kind: 'brand_site' });
  });

  it('offers nothing when the brand has no website and there is no product page', () => {
    expect(
      purchaseLinkFor({
        sourceType: SourceType.rss,
        sourceUrl: ARTICLE,
        brandWebsite: null,
      }),
    ).toBeNull();
  });

  it('is an ordinary answer, not an error, when a drop has no links at all', () => {
    expect(
      purchaseLinkFor({ sourceType: null, sourceUrl: null, brandWebsite: null }),
    ).toBeNull();
  });

  it('falls back to the brand site when a site-watch drop somehow lost its URL', () => {
    expect(
      purchaseLinkFor({
        sourceType: SourceType.site_watch,
        sourceUrl: null,
        brandWebsite: BRAND_SITE,
      }),
    ).toEqual({ url: BRAND_SITE, kind: 'brand_site' });
  });

  it('offers nothing for a site-watch drop with neither a URL nor a brand site', () => {
    expect(
      purchaseLinkFor({
        sourceType: SourceType.site_watch,
        sourceUrl: null,
        brandWebsite: null,
      }),
    ).toBeNull();
  });

  it('ignores blank strings, which are absent values wearing a disguise', () => {
    expect(
      purchaseLinkFor({
        sourceType: SourceType.site_watch,
        sourceUrl: '   ',
        brandWebsite: '',
      }),
    ).toBeNull();
  });
});
