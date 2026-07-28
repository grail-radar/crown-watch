/**
 * Template tests — pure, no database, no network.
 *
 * These assert on the message a reader actually sees, because the template is
 * the product here: everything downstream just moves these bytes to Telegram.
 */
import { DropType } from '@prisma/client';
import { ALERT_LOCALES, DropAlert, renderDropAlert } from './messages';

const WEB = 'https://crownswatch.org';

const alert = (over: Partial<DropAlert> = {}): DropAlert => ({
  brandName: 'Lorier',
  brandSlug: 'lorier',
  title: 'Neptune IV',
  type: DropType.pre_order,
  price: 499,
  currency: 'USD',
  purchase: { url: 'https://lorier.com/products/neptune-iv', kind: 'store' },
  coverageUrl: null,
  ...over,
});

describe('renderDropAlert', () => {
  it('carries brand, model, price and both links', () => {
    const text = renderDropAlert('en', alert(), WEB);

    expect(text).toContain('Lorier');
    expect(text).toContain('Neptune IV');
    expect(text).toContain('499 USD');
    // The direct link to the brand's own product page…
    expect(text).toContain('https://lorier.com/products/neptune-iv');
    // …and the link to that brand on our site.
    expect(text).toContain(`${WEB}/brands/lorier`);
  });

  it('names the kind of drop differently for a restock and a new release', () => {
    const release = renderDropAlert('en', alert({ type: DropType.pre_order }), WEB);
    const restock = renderDropAlert('en', alert({ type: DropType.restock }), WEB);

    expect(release).toContain('New release');
    expect(restock).toContain('Back in stock');
    expect(release).not.toEqual(restock);
  });

  it('writes Ukrainian and English from the same drop data', () => {
    const data = alert();
    const uk = renderDropAlert('uk', data, WEB);
    const en = renderDropAlert('en', data, WEB);

    // Same facts in both…
    for (const text of [uk, en]) {
      expect(text).toContain('Lorier');
      expect(text).toContain('Neptune IV');
      expect(text).toContain('499 USD');
      expect(text).toContain('https://lorier.com/products/neptune-iv');
      expect(text).toContain(`${WEB}/brands/lorier`);
    }
    // …and the same shape: only the wording differs.
    expect(uk.split('\n')).toHaveLength(en.split('\n').length);
    expect(uk).not.toEqual(en);
    expect(uk).toContain('Новий реліз');
    expect(uk).toContain('Ціна');
  });

  it('has wording for every drop type in every language', () => {
    // A drop type with no translation would render "undefined" to a channel.
    for (const locale of ALERT_LOCALES) {
      for (const type of Object.values(DropType)) {
        const text = renderDropAlert(locale, alert({ type }), WEB);
        expect(text).not.toContain('undefined');
        expect(text.split('\n')[0].trim()).not.toHaveLength(0);
      }
    }
  });

  it('omits the price line when the store did not expose one', () => {
    const text = renderDropAlert('en', alert({ price: null, currency: null }), WEB);

    expect(text).not.toContain('Price');
    // The rest of the message is unaffected.
    expect(text).toContain('Neptune IV');
    expect(text).toContain(`${WEB}/brands/lorier`);
  });

  it('still links to the brand page when there is no product URL', () => {
    const text = renderDropAlert('en', alert({ purchase: null }), WEB);

    expect(text).toContain(`${WEB}/brands/lorier`);
    expect(text).not.toContain('Buy from the brand');
  });

  it('escapes titles so a store cannot break or inject markup', () => {
    // Ampersands are common in real model names ("Tudor & Co"); angle brackets
    // are the injection case.
    const text = renderDropAlert(
      'en',
      alert({ brandName: 'Smith & Co', title: 'Diver <b>Pro</b>' }),
      WEB,
    );

    expect(text).toContain('Smith &amp; Co');
    expect(text).toContain('Diver &lt;b&gt;Pro&lt;/b&gt;');
    // The only markup left is ours.
    expect(text).not.toContain('<b>Pro');
  });

  it('escapes a product URL so it cannot break out of the href attribute', () => {
    // The URL is third-party store data interpolated into href="...". A bare
    // quote would close the attribute and turn the rest into markup.
    const text = renderDropAlert(
      'en',
      alert({ purchase: { url: 'https://evil.example/p?x="><script>alert(1)</script>', kind: 'store' } }),
      WEB,
    );

    expect(text).not.toContain('<script>');
    expect(text).toContain('&quot;');
    // Exactly one anchor was opened for the product link, not two.
    expect(text.match(/<a href="/g)).toHaveLength(2); // product + brand page
  });

  it('does not say "buy" over a link to a magazine article', () => {
    // Tier 1 drops carry the publication's article, not a product page.
    // Labelling that "Buy from the brand" misleads every reader and
    // misrepresents the publication's coverage (CONTEXT.md §6).
    const coverage = alert({
      purchase: null,
      coverageUrl: 'https://wornandwound.com/nomos-introduces-new-tetra-27/',
    });

    expect(renderDropAlert('en', coverage, WEB)).toContain('Read the coverage');
    expect(renderDropAlert('en', coverage, WEB)).not.toContain('Buy from');
    expect(renderDropAlert('uk', coverage, WEB)).toContain('Читати огляд');
    expect(renderDropAlert('uk', coverage, WEB)).not.toContain('Купити');
  });

  it('does say "buy" when the link really is the brand’s store', () => {
    expect(renderDropAlert('en', alert(), WEB)).toContain('Buy from the brand');
    expect(renderDropAlert('uk', alert(), WEB)).toContain('Купити в бренда');
  });

  it('offers the brand’s own site in its own words, not the other two', () => {
    // A drop we only have coverage for, whose brand we do know the site of.
    const both = alert({
      purchase: { url: 'https://lorier.com', kind: 'brand_site' },
      coverageUrl: 'https://wornandwound.com/hands-on-the-lorier-neptune-iv/',
    });

    const en = renderDropAlert('en', both, WEB);
    const uk = renderDropAlert('uk', both, WEB);

    expect(en).toContain('Visit the brand');
    expect(en).not.toContain('Buy from the brand');
    expect(uk).toContain('Сайт бренда');
    expect(uk).not.toContain('Купити в бренда');
  });

  it('carries the brand’s site and the coverage as two separate links', () => {
    const both = alert({
      purchase: { url: 'https://lorier.com', kind: 'brand_site' },
      coverageUrl: 'https://wornandwound.com/hands-on-the-lorier-neptune-iv/',
    });

    const text = renderDropAlert('en', both, WEB);

    expect(text).toContain('https://lorier.com"');
    expect(text).toContain('wornandwound.com');
    expect(text).toContain('Read the coverage');
    // Where to act, then the article, then our own brand page.
    expect(text.match(/<a href="/g)).toHaveLength(3);
  });

  it('says nothing about buying when there is nowhere to send the reader', () => {
    const bare = alert({ purchase: null, coverageUrl: null });

    const text = renderDropAlert('en', bare, WEB);

    expect(text).not.toContain('Buy from');
    expect(text).not.toContain('Visit the brand');
    expect(text).not.toContain('Read the coverage');
    // Still a valid message: the drop and our own brand page.
    expect(text).toContain('Neptune IV');
    expect(text).toContain(`${WEB}/brands/lorier`);
  });

  it('gives all three link labels distinct wording in both languages', () => {
    // Reusing a label would tell a reader the wrong thing about a destination.
    const labels = (locale: 'uk' | 'en') => [
      renderDropAlert(locale, alert(), WEB),
      renderDropAlert(
        locale,
        alert({ purchase: { url: 'https://lorier.com', kind: 'brand_site' } }),
        WEB,
      ),
      renderDropAlert(
        locale,
        alert({ purchase: null, coverageUrl: 'https://wornandwound.com/x/' }),
        WEB,
      ),
    ];

    for (const locale of ALERT_LOCALES) {
      const [store, brandSite, coverage] = labels(locale);
      expect(store).not.toEqual(brandSite);
      expect(brandSite).not.toEqual(coverage);
      expect(store).not.toEqual(coverage);
    }
  });

  it('drops the trailing zeros a Decimal price arrives with', () => {
    // priceLow is Decimal(12,2), so 650 comes back as "650.00" — noise in chat.
    const text = renderDropAlert('en', alert({ price: 650.0 }), WEB);

    expect(text).toContain('650 USD');
    expect(text).not.toContain('650.00');
  });

  it('does not double the slash when the site URL has a trailing one', () => {
    const text = renderDropAlert('en', alert(), 'https://crownswatch.org/');

    expect(text).toContain('https://crownswatch.org/brands/lorier');
    expect(text).not.toContain('org//brands');
  });
});
