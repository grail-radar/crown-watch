/**
 * What a store's answer about one product URL means.
 *
 * A table, because the whole decision is "which answers are proof that the
 * product is gone" — and the answer is: very few of them. Everything else has
 * to stay `unverified`, or a store that rate-limits us silences a real release.
 */
import { verdictFor, verdictForFailure } from './link-liveness';

describe('verdictFor', () => {
  describe('the product is there', () => {
    it.each([200, 201, 203, 204, 206, 299])('reads %i as live', (status) => {
      expect(verdictFor(status)).toBe('live');
    });

    it.each([301, 302, 307, 308])(
      'reads %i as live — a redirect resolves somewhere',
      (status) => {
        // The fetcher follows redirects, so one arriving here means it stopped
        // following. A store that moved a product still has the product.
        expect(verdictFor(status)).toBe('live');
      },
    );
  });

  describe('the product is gone', () => {
    it.each([404, 410])('reads %i as gone', (status) => {
      expect(verdictFor(status)).toBe('gone');
    });
  });

  describe('the store did not answer the question', () => {
    it.each([401, 403])(
      'reads %i as unverified — a shop hiding from bots is not a dead product',
      (status) => {
        expect(verdictFor(status)).toBe('unverified');
      },
    );

    it.each([429])(
      'reads %i as unverified — being asked to slow down says nothing about the product',
      (status) => {
        expect(verdictFor(status)).toBe('unverified');
      },
    );

    it.each([500, 502, 503, 504])(
      'reads %i as unverified — the store is broken, not the product',
      (status) => {
        expect(verdictFor(status)).toBe('unverified');
      },
    );

    it.each([400, 405, 418, 451])(
      'reads %i as unverified — only 404 and 410 mean "no such thing"',
      (status) => {
        // Deliberately narrow. Anything else in the 4xx range is a statement
        // about the request, and refusing a release over one would be the
        // silent loss this guard exists to avoid.
        expect(verdictFor(status)).toBe('unverified');
      },
    );
  });

  it('never reads a nonsense status as proof of anything', () => {
    expect(verdictFor(0)).toBe('unverified');
    expect(verdictFor(-1)).toBe('unverified');
    expect(verdictFor(999)).toBe('unverified');
  });
});

describe('verdictForFailure', () => {
  it('is unverified — a timeout is our problem, not the product’s', () => {
    // Same reasoning as an unreadable robots.txt allowing: one flaky moment
    // must not be able to silence a brand.
    expect(verdictForFailure()).toBe('unverified');
  });
});
