/**
 * Which currency a store actually printed a price in.
 *
 * `watch_config.currency` used to answer this — a label an operator typed when
 * the source was registered, and then never revisited. YEMA serves at least two
 * market price lists (observed pairs 349/390, 39/47, 49/59, whose ratios differ,
 * so these are separate price lists rather than one converted), which means
 * roughly half of its polls announced a euro figure labelled `USD`. One of them
 * reached both Channels on 2026-08-06, and a Channel cannot unsend (ADR-0002).
 *
 * So the currency is read from the same bytes the price came from, on every
 * fetch — and where those bytes do not say, nothing is claimed. **A bare number
 * beats a wrong one**, which is the same instinct as ADR-0002's silence over
 * repetition and ADR-0006's watch over accessory.
 *
 * The refusals below are the load-bearing part. `$` is six currencies, `¥` is
 * two, and `kr` is three; guessing the most likely one is precisely the class of
 * mistake this replaces.
 */

/** Symbols that identify exactly one currency on the brands we track. */
const UNAMBIGUOUS_SYMBOLS: ReadonlyArray<[string, string]> = [
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['zł', 'PLN'],
  ['₴', 'UAH'],
];

/**
 * Dollar signs that say which dollar. Checked before the bare `$`, longest
 * prefix first so `NZ$` is not read as an `A$`-style match.
 */
const QUALIFIED_DOLLARS: ReadonlyArray<[string, string]> = [
  ['us$', 'USD'],
  ['ca$', 'CAD'],
  ['nz$', 'NZD'],
  ['au$', 'AUD'],
  ['c$', 'CAD'],
  ['a$', 'AUD'],
];

/**
 * ISO codes a store might spell out. Deliberately a list rather than "any three
 * letters": `SEKTOR 990` is not a Swedish price, and a watch called `CHFoo`
 * should not set a currency.
 */
const ISO_CODES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'JPY',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'CAD',
  'AUD',
  'NZD',
  'UAH',
  'HKD',
  'SGD',
] as const;

/**
 * Every currency the text evidences. More than one means the store is showing a
 * dual price, and there is no way to pick between them.
 */
function candidates(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const [symbol, code] of UNAMBIGUOUS_SYMBOLS) {
    if (lower.includes(symbol.toLowerCase())) found.add(code);
  }
  // One pass with the alternation ordered longest-first, so `CA$` is consumed
  // as CAD rather than also matching the `A$` rule and looking ambiguous — but
  // a listing that really does show `US$700 / CA$900` still yields both.
  const dollars = lower.matchAll(/(us|ca|nz|au|c|a)\$/g);
  for (const [, prefix] of dollars) {
    const code = QUALIFIED_DOLLARS.find(([p]) => p === `${prefix}$`)?.[1];
    if (code) found.add(code);
  }
  for (const code of ISO_CODES) {
    // Word-bounded, so `EUROPEAN` and `SEKTOR` do not count.
    if (new RegExp(`\\b${code}\\b`, 'i').test(text)) found.add(code);
  }

  // A `$` that no prefix claimed is genuinely ambiguous — USD, CAD, AUD, NZD,
  // HKD and SGD all print it. Recorded as its own candidate so that a text
  // showing "€640 / $700" is refused rather than read as EUR.
  // A `$` that no prefix claimed — USD, CAD, AUD, NZD, HKD and SGD all print
  // it. Counted as its own candidate so "€640 / $700" is refused rather than
  // read as EUR.
  if (/(^|[^a-z])\$/.test(lower)) found.add('AMBIGUOUS');
  // Same for the two symbols shared across currencies that no prefix resolves.
  if (/[¥]/.test(text)) found.add('AMBIGUOUS');
  if (/\bkr\b/i.test(text)) found.add('AMBIGUOUS');

  return found;
}

/**
 * The ISO code this price text evidences, or null when it evidences none — or
 * more than one.
 */
export function currencyFromPrice(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;

  const found = candidates(text);
  if (found.size !== 1) return null;

  const [only] = [...found];
  return only === 'AMBIGUOUS' ? null : only;
}
