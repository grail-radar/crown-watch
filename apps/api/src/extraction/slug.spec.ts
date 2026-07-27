import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Christopher Ward')).toBe('christopher-ward');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(slugify('Lebois & Co')).toBe('lebois-co');
    expect(slugify('H. Moser & Cie.')).toBe('h-moser-cie');
  });

  it('strips diacritics so brands stay reachable by ascii urls', () => {
    expect(slugify('Blütezeit')).toBe('blutezeit');
  });

  it('never yields leading or trailing hyphens', () => {
    expect(slugify('  ...Baltic!  ')).toBe('baltic');
  });

  it('collapses runs of punctuation into a single separator', () => {
    expect(slugify('Toledano & Chan')).toBe('toledano-chan');
    expect(slugify('Kiwame   ///   Tokyo')).toBe('kiwame-tokyo');
  });

  // Ampersand is dropped, the word "and" is kept — so these are different
  // brands as far as slugs are concerned. Documented because it means a brand
  // written both ways would occupy two rows.
  it('treats "&" and "and" as different', () => {
    expect(slugify('Toledano & Chan')).not.toBe(slugify('Toledano and Chan'));
  });

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('brand');
  });
});
