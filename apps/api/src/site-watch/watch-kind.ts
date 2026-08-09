/**
 * Whether a store product is a watch, or one of the other things a watch shop
 * sells.
 *
 * A brand's `products.json` returns the whole shop, and every one of these
 * reached both public Channels as a watch release: "Bracelet Lézard - Marron",
 * "Boucle SERICA", "Ajouter votre gravure", ten YEMA straps, a gift card, and a
 * product named `Warranty Product`. The feed promises one thing — it tells you
 * when a watch lands.
 *
 * **This classifies; it never excludes.** Accessories are recorded in full and
 * simply marked. The reasoning, and what it costs, is ADR-0006.
 */
import { WatchKind } from '@prisma/client';

/**
 * Words that name the accessory itself, matched whole.
 *
 * Kept narrow on purpose. Words that appear as *modifiers* inside a watch
 * listing are deliberately absent — `nato`, `mesh`, `band`, `roll` and `tool`
 * were all tried and removed, because a store lists "Skin Diver CMM.20 Steel
 * Bracelet" and "tool watch" is ordinary trade vocabulary. Each of them
 * silenced real watches to catch accessories that the nouns below already
 * catch, or that {@link ACCESSORY_TITLES} names outright.
 *
 * `bracelet` earns its place despite the same risk: it means the metal band in
 * English *and* the leather strap in French, and it is how Serica and YEMA
 * title the accessory itself.
 */
const ACCESSORY_WORDS = [
  // Straps and bands
  'strap',
  'straps',
  'bracelet',
  'bracelets',
  'sangle',
  'sangles',
  // Fastenings and fittings
  'buckle',
  'boucle',
  'ardillon',
  'clasp',
  'deployant',
  'spring bar',
  'spring bars',
  'end pieces',
  'pieces de bout',
  'endlinks',
  // Cases, boxes and shop furniture
  'watch box',
  'watch case',
  'travel case',
  'watch roll',
  'etui',
  'pouch',
  'card holder',
  'gift card',
  'badge',
  'warranty',
  // Services sold as products
  'gravure',
  'engraving',
] as const;

/**
 * Products named outright, matched against the whole title.
 *
 * The escape hatch for things no word gives away: nothing in "Bonklip" says
 * bracelet, nothing in "'Black Tie'" says spring bars, and "YEMA Cap" is a hat
 * whose only keyword — `cap` — is also a plausible watch name (Cap Horn).
 *
 * Whole-title matching is what makes these free of risk: a watch is never
 * titled *exactly* "yema cap". A keyword could not say that.
 */
const ACCESSORY_TITLES = new Set([
  'bonklip',
  'vesper mesh',
  'black tie',
  'serica expedition',
  'yema cap',
]);

/**
 * Phrases that mark a product as an add-on however it is otherwise named.
 * YEMA sells "Marine Nationale Badge with your watch" — the suffix is the tell,
 * and it appears on titles no keyword would catch.
 */
const ACCESSORY_PHRASES = ['with your watch', 'avec votre montre'] as const;

/**
 * Lowercased, unaccented, punctuation reduced to spaces, padded.
 *
 * Accents are folded rather than stripped so "pièces" matches "pieces" and
 * "Étui" matches "etui". Punctuation becomes whitespace so the quotes and
 * dashes in "Bracelet 'Parade' - Noir" cannot hide a word boundary. The padding
 * is what makes ` word ` a whole-word test.
 */
function normalise(title: string): string {
  return ` ${title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * What a Watch is, from the name it is grouped under.
 *
 * Deliberately conservative, because the two mistakes are not equal. An
 * accessory called a watch is one stray message somebody marks. A watch called
 * an accessory is **silence** — the release is never announced and nobody
 * notices it is missing. So this leans toward `watch`, and
 * `watches.kind_override` catches whatever it gets wrong.
 */
export function classifyWatchKind(name: string): WatchKind {
  const text = normalise(name);

  if (ACCESSORY_TITLES.has(text.trim())) return WatchKind.accessory;
  for (const phrase of ACCESSORY_PHRASES) {
    if (text.includes(` ${phrase} `)) return WatchKind.accessory;
  }
  for (const word of ACCESSORY_WORDS) {
    if (text.includes(` ${word} `)) return WatchKind.accessory;
  }
  return WatchKind.watch;
}
