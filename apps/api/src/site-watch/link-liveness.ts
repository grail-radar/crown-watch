/**
 * Whether a product URL still leads somewhere, read off what the store said.
 *
 * Pure, so the decision that gates an announcement can be read as a table
 * rather than traced through a poll. Same shape as `backoff.ts` and
 * `purchase-link.ts`, and for the same reason: this is a judgement, and a
 * judgement wants to be inspectable without a network.
 *
 * The asymmetry is the whole design. Proving a product is **gone** takes a
 * store saying so in the only two ways HTTP has of saying it. Everything else —
 * a 403 at a bot wall, a 429, a 500, a timeout — is a statement about the
 * request or about the shop, not about the watch, and reading any of them as
 * "gone" would silence real releases. That is the mistake this guard must not
 * make while preventing the other one.
 */

/**
 * `live`       — the store served it; a reader can open it.
 * `gone`       — the store says there is no such product. Proof, not suspicion.
 * `unverified` — we could not find out. Says nothing either way.
 */
export type LinkVerdict = 'live' | 'gone' | 'unverified';

/** What an HTTP status says about the product behind the URL. */
export function verdictFor(status: number): LinkVerdict {
  // 404 Not Found and 410 Gone are the only two answers that are *about the
  // resource*. Every other 4xx is about the request we made.
  if (status === 404 || status === 410) return 'gone';

  // The fetcher follows redirects, so a 3xx reaching this point means it
  // stopped following — too many hops, or a redirect it declined. A store that
  // moved a product still has the product.
  if (status >= 200 && status < 400) return 'live';

  return 'unverified';
}
