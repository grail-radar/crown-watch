/**
 * Which store products are the same Watch.
 *
 * A store product is not a watch. YEMA lists the Superman Bronze CMM.10 as three
 * products — one per bracelet reference — and a reader wants one watch with three
 * ways to buy it, not three unrelated releases. Grouping is what turns the
 * former into the latter (ADR-0003).
 *
 * The rule is **brand plus a normalised title**, and it is deliberately
 * conservative. The tempting version strips trailing words to find a common stem
 * — and that version is wrong, because Baltic sells "Scalegraph Classic - Panda"
 * and "Scalegraph Classic - Reverse Panda", which any enthusiast will tell you
 * are two watches to want rather than one watch in two flavours. A rule that
 * merges those is worse than a rule that occasionally splits a variant off.
 *
 * So: normalise the typography, remove a bracketed reference, and stop. Where it
 * gets a case wrong the answer is an override row, not a cleverer regex — which
 * is exactly the trade ADR-0003 accepted, and the reason grouping costs nothing
 * per product and stays readable as a table of cases.
 */

export interface WatchIdentity {
  /**
   * What decides sameness. Scoped to the brand, because two brands may both
   * sell an "Aquascaphe" and they are not the same watch.
   */
  key: string;
  /** The title as a reader should see it — tidied, but not case-folded. */
  name: string;
  /** URL-safe form of the name, unique within the brand alongside `key`. */
  slug: string;
  /**
   * The bracketed reference this removed, when there was one. Kept rather than
   * discarded: it is the only per-variant identity a store hands over for free,
   * and a Variant is required to carry one.
   */
  reference: string | null;
}

/** En dash, em dash and minus all read as a hyphen to a person. */
const DASHES = /[‐-―−]/g;

/**
 * A reference in brackets at the very end — `Réf. 8315-2 (SYU66-20-SS)`.
 *
 * Bracketed and terminal is the one variant suffix unambiguous enough to drop:
 * some stores append the SKU for one variant and not its siblings, which would
 * otherwise split one watch in two. Anything unbracketed is left alone, because
 * a bare trailing token is far more often the model name than a variant code.
 */
const TRAILING_BRACKETED_REF = /\s*[([][^()[\]]*[)\]]\s*$/;

function tidy(title: string): string {
  return title.replace(DASHES, '-').replace(/\s+/g, ' ').trim();
}

export function watchIdentity(
  brandSlug: string,
  rawTitle: string,
): WatchIdentity {
  const tidied = tidy(rawTitle);

  // Only strip the reference when something is left to identify the watch by:
  // Serica genuinely sells a watch called "Réf. 8315-2", and normalising that
  // away would leave a watch with no identity at all.
  const stripped = tidy(tidied.replace(TRAILING_BRACKETED_REF, ''));
  const name = stripped || tidied;

  const removed = name === tidied ? null : tidied.slice(name.length);
  const reference = removed ? (removed.match(/[([]([^()[\]]*)[)\]]/)?.[1]?.trim() || null) : null;

  const key = `${brandSlug}:${name.toLocaleLowerCase()}`;

  return { key, name, slug: slugify(name), reference };
}

/**
 * Diacritics are folded rather than dropped, so "Réf." becomes "ref" instead of
 * "rf" — a slug a person can still read is worth the extra step.
 */
export function slugify(value: string): string {
  const ascii = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase();

  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  // A title of pure punctuation or non-Latin script would otherwise slug to the
  // empty string and collide with every other such title in the brand.
  return slug || 'watch';
}
