/**
 * Reading a currency off what a store actually printed — pure, no I/O.
 *
 * A table of cases, like the other rules here, because the interesting half is
 * what it *refuses*. On 2026-08-06 both Channels were told
 * "Price: 2190 USD" for a YEMA watch, and nobody can now say whether that
 * figure came from the dollar price list or the euro one. A Channel cannot
 * unsend (ADR-0002), so a wrong label is permanent the moment it fires.
 *
 * The rule this encodes: **a bare number beats a wrong one.**
 */
import { currencyFromPrice } from './currency';

describe('currencyFromPrice', () => {
  describe('symbols that can only mean one thing', () => {
    it.each([
      ['€ 640.00', 'EUR'],
      ['640,00 €', 'EUR'],
      ['€2,190', 'EUR'],
      ['£1,250', 'GBP'],
      ['1 250 zł', 'PLN'],
      ['12 500 ₴', 'UAH'],
    ])('reads %s as %s', (text, expected) => {
      expect(currencyFromPrice(text)).toBe(expected);
    });
  });

  describe('codes the store spells out', () => {
    it.each([
      ['2190 EUR', 'EUR'],
      ['USD 2,190', 'USD'],
      ['CHF 1 890', 'CHF'],
      ['2190 SEK', 'SEK'],
      ['JPY 240,000', 'JPY'],
      ['from 1,250 GBP', 'GBP'],
    ])('reads %s as %s', (text, expected) => {
      expect(currencyFromPrice(text)).toBe(expected);
    });

    it('is not fooled by a word that merely contains a code', () => {
      // "EURope", "CHFoo" — a code has to stand alone.
      expect(currencyFromPrice('1250 EUROPEAN')).toBeNull();
      expect(currencyFromPrice('SEKTOR 990')).toBeNull();
    });
  });

  describe('symbols shared by several currencies — refused', () => {
    it('refuses a bare dollar sign', () => {
      // USD, CAD, AUD, NZD, HKD, SGD all print `$`. YEMA and CronusArt both
      // use it, and guessing USD is exactly the mistake this ticket exists for.
      expect(currencyFromPrice('$2,190')).toBeNull();
      expect(currencyFromPrice('2190 $')).toBeNull();
    });

    it('reads a dollar sign that says which dollar', () => {
      expect(currencyFromPrice('US$2,190')).toBe('USD');
      expect(currencyFromPrice('CA$2,190')).toBe('CAD');
      expect(currencyFromPrice('A$2,190')).toBe('AUD');
      expect(currencyFromPrice('NZ$2,190')).toBe('NZD');
    });

    it('refuses the yen sign, which is also the yuan sign', () => {
      expect(currencyFromPrice('¥240,000')).toBeNull();
    });

    it('refuses kronor, which three countries print the same way', () => {
      expect(currencyFromPrice('12 500 kr')).toBeNull();
    });
  });

  describe('nothing to read', () => {
    it.each(['', '   ', '2190', '2,190.00', 'Sold out', 'Price on request'])(
      'returns null for %p',
      (text) => {
        expect(currencyFromPrice(text)).toBeNull();
      },
    );
  });

  it('refuses a price that names two currencies at once', () => {
    // A dual-priced listing — "€640 / $700" — cannot be labelled with either
    // without picking one at random.
    expect(currencyFromPrice('€640 / $700')).toBeNull();
    expect(currencyFromPrice('640 EUR (700 USD)')).toBeNull();
    // Including two *qualified* dollars, which a longest-prefix-wins scan
    // would otherwise collapse to whichever came first.
    expect(currencyFromPrice('US$700 / CA$900')).toBeNull();
  });

  it('ignores case and padding', () => {
    expect(currencyFromPrice('  2190 eur  ')).toBe('EUR');
  });
});
