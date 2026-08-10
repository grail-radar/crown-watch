/**
 * The evidence a draft is built from, and the copyright guard over it.
 *
 * Once a brand's own page is put in front of the model, the risk changes: the
 * model can repeat their marketing back to us and it reads like a fact. A
 * length cap does not catch that — a tagline is short (`CONTEXT.md` §6, #30).
 */
import { BrandEvidence, isLiftedFrom, readableText } from './brand-evidence';

const evidence = (over: Partial<BrandEvidence> = {}): BrandEvidence => ({
  siteText: null,
  siteNote: null,
  watchNames: [],
  dropTitles: [],
  priceBand: null,
  ...over,
});

describe('readableText', () => {
  it('keeps the prose and drops the machinery', () => {
    const text = readableText(
      '<html><body><nav>Shop Cart</nav><h1>Baltic</h1>' +
        '<p>Movements by Sellita.</p><script>track()</script>' +
        '<footer>© 2026</footer></body></html>',
    );

    expect(text).toContain('Movements by Sellita.');
    expect(text).not.toContain('track()');
    expect(text).not.toContain('Shop Cart');
    expect(text).not.toContain('© 2026');
  });

  it('returns null when a page says nothing readable', () => {
    // The signal that a site yielded nothing, so the draft can say so rather
    // than look like a brand nobody could find anything about.
    expect(readableText('<html><body><script>go()</script></body></html>')).toBeNull();
    expect(readableText('')).toBeNull();
  });

  it('caps how much of a shop we pay to reason over', () => {
    const text = readableText(`<html><body><p>${'watch '.repeat(2000)}</p></body></html>`);

    expect(text!.length).toBeLessThanOrEqual(4000);
  });
});

describe('isLiftedFrom', () => {
  it('refuses a phrase copied out of the brand’s own page', () => {
    const facts = evidence({
      siteText: 'Swiss movements, honest prices, and no middleman.',
    });

    expect(isLiftedFrom('Swiss movements, honest prices', facts)).toBe(true);
  });

  it('is not fooled by a line break or a capital', () => {
    const facts = evidence({
      siteText: 'Swiss movements,\n   HONEST prices for every day.',
    });

    expect(isLiftedFrom('swiss movements, honest prices', facts)).toBe(true);
  });

  it('checks our own coverage too, not just the site', () => {
    // Every source the model saw, or the guard has a hole in the shape of
    // whichever source we forgot.
    expect(
      isLiftedFrom(
        'Aquascaphe Bronze Titanium',
        evidence({ watchNames: ['Aquascaphe Bronze Titanium Limited'] }),
      ),
    ).toBe(true);
    expect(
      isLiftedFrom(
        'Baltic returns to the bronze diver',
        evidence({ dropTitles: ['Baltic returns to the bronze diver this week'] }),
      ),
    ).toBe(true);
  });

  it('lets a short fact through even though it is on the page', () => {
    // "Sellita" appears there precisely because it is the fact we asked for.
    // Below a few words there is nothing to own.
    const facts = evidence({ siteText: 'Movements by Sellita, assembled in France.' });

    expect(isLiftedFrom('Sellita', facts)).toBe(false);
    expect(isLiftedFrom('France', facts)).toBe(false);
  });

  it('allows a fact that is not in the material at all', () => {
    const facts = evidence({ siteText: 'Vintage-inspired watches from Paris.' });

    expect(isLiftedFrom('bronze dive watches', facts)).toBe(false);
  });
});
