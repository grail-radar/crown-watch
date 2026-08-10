import { parse as parseHtml } from 'node-html-parser';

/**
 * How much of a brand's own page is worth putting in front of a model.
 *
 * Enough for an About page's substance, short of paying to reason over a whole
 * shop. A homepage that needs more than this to say who makes its movements is
 * not going to say it at all.
 */
const MAX_SITE_CHARS = 4000;

/** Tags whose text is never prose about the brand. */
const NOISE = new Set(['script', 'style', 'noscript', 'svg', 'nav', 'footer']);

/**
 * The readable text of a brand's own page.
 *
 * Deliberately crude — this is evidence for a model to read, not a document we
 * present to anybody, so a rough de-tagging beats a parser that pretends to
 * understand the page. Returns null when there is nothing worth reading, which
 * is the signal a brand's site yielded nothing (#30).
 */
export function readableText(html: string): string | null {
  let root: ReturnType<typeof parseHtml>;
  try {
    root = parseHtml(html);
  } catch {
    return null;
  }
  for (const tag of NOISE) {
    for (const node of root.querySelectorAll(tag)) node.remove();
  }
  const text = root
    .structuredText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, MAX_SITE_CHARS);
  return text.length > 0 ? text : null;
}

/**
 * Everything a draft was allowed to read.
 *
 * Kept as one blob because its only other job is the copyright check: a fact is
 * refused when it appears verbatim in here, and "here" has to mean every source
 * the model saw (`CONTEXT.md` §6).
 */
export interface BrandEvidence {
  /** Readable text from the brand's own site, or null if we could not read it. */
  siteText: string | null;
  /** Why not, when `siteText` is null — for the draft's note. */
  siteNote: string | null;
  /** Watches we already track for this brand, by name. */
  watchNames: string[];
  /** Recent Drop titles — our own existing coverage of the brand. */
  dropTitles: string[];
  /** What the brand costs, from its own Variants. Already ours; never asked. */
  priceBand: { low: string; high: string; currency: string | null } | null;
}

/** Whitespace- and case-insensitive, so a reflow does not defeat the check. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Did this "fact" come out of a source verbatim?
 *
 * The copyright guard that matters (`CONTEXT.md` §6). A length cap only catches
 * a *long* lift; a brand's tagline is usually short, and "Swiss movements,
 * honest prices" copied straight off their homepage is exactly the kind of
 * phrase that reads like a fact and is actually their marketing.
 *
 * Compared against every source the model was shown, normalised for case and
 * whitespace so a line break does not smuggle a phrase past.
 */
export function isLiftedFrom(value: string, evidence: BrandEvidence): boolean {
  const needle = normalise(value);
  // Below a few words there is nothing to own: "Sellita" and "in-house" appear
  // on the page precisely because they are the facts we asked for.
  if (needle.length < 15) return false;
  const haystacks = [
    evidence.siteText,
    ...evidence.watchNames,
    ...evidence.dropTitles,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return haystacks.some((source) => normalise(source).includes(needle));
}
