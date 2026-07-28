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
  productUrl: 'https://lorier.com/products/neptune-iv',
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
    const text = renderDropAlert('en', alert({ productUrl: null }), WEB);

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
      alert({ productUrl: 'https://evil.example/p?x="><script>alert(1)</script>' }),
      WEB,
    );

    expect(text).not.toContain('<script>');
    expect(text).toContain('&quot;');
    // Exactly one anchor was opened for the product link, not two.
    expect(text.match(/<a href="/g)).toHaveLength(2); // product + brand page
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
