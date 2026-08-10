# ADR-0007 — A dead link demotes a Drop to moderation; it does not discard it

**Status:** accepted
**Date:** 2026-08-10
**Context issue:** [#39](https://github.com/grail-radar/crown-watch/issues/39)

## Context

ADR-0001 lets a Tier 4 Drop publish and broadcast the moment it is detected, with
no human in the path. The justification is narrow and worth restating: the signal
is a structural diff of the brand's **own** store, so no language model read
anything and there is nothing to misread.

Nothing on that path ever checked that the product page a reader would land on
actually exists.

The incident that raised this is not the one to design against. Six Drops titled
`diver` carried URLs that 404'd, but those were test fixtures written straight
into production on 2026-08-07 — no store ever served them, #36 stopped new debris
and #40 retracted these. Designing for "the store lied" would be building for a
thing that has not happened.

The realistic causes are narrower and do happen:

- A Shopify products feed lists a product that is **not published to the online
  store channel**. The feed reports it; the reader gets a 404.
- A product is delisted between the poll and the broadcast.

A reader clicking "Buy" and landing on a 404 is the most expensive kind of wrong
this project can be. It is the exact moment the feed promises something and fails
to deliver, and on a Channel it cannot be taken back (ADR-0002).

## Decision

Before a Tier 4 candidate becomes a public Drop, ask the store whether the page
it points at exists.

**A definitively dead link demotes the Drop to the moderation queue.** It is
still written, still linked to its Watch, and still carries everything the poll
found — it simply is not published and is not broadcast. ADR-0001's exemption
rests on nothing having been inferred; a page the store will not serve falsifies
that for that one candidate, so it falls back to the lane every extracted Drop
already uses.

**Only `404` and `410` count as dead.** Those are the two answers HTTP has that
are about the *resource*. Every other status is about the request or about the
shop.

**Anything else publishes.** A 403 at a bot wall, a 429, a 500, a timeout, a
robots.txt that forbids the path — all leave the candidate publishable and are
reported as `unverified`.

**A missing image publishes.** Explicitly decided rather than left implicit.

## Considered options

- **Discard the candidate.** Rejected, and this is the important one. The product
  is in the stored snapshot from that poll onward, so novelty — decided by
  product URL — can never fire for it again. A store that publishes the page an
  hour later would go permanently unannounced. Discarding trades a visible
  wrong for a silent one.
- **Refuse the whole Source, as the flood guard does.** Rejected. ADR-0005 holds
  an entire store because the *poll* is untrustworthy. Here the poll is fine and
  one candidate is not, and holding a store's genuine releases because one
  product page is unpublished is a worse failure than the one being prevented.
- **Fail closed on an inconclusive check.** Rejected. A store that rate-limits us
  or times out would silently cost a brand every release it made while
  struggling. This is the same call `RobotsService` already makes — an unreadable
  robots.txt allows, because one flaky file must not silence a brand
  indefinitely.
- **Refuse a Drop with no image.** Rejected. An image is presentation, not a
  promise. `buildSendCall` already falls back from `sendPhoto` to `sendMessage`,
  and the site's card falls back to a monogram, so the reader loses a thumbnail
  and nothing else. Silencing a genuine release over a missing photo is the
  larger error, and 0 of 27 published Drops currently lack one, so the case is
  rare as well as cheap.

## Consequences

- **The moderation queue gains a new kind of occupant**, and it is the only
  place these Drops appear. An operator approving one calls straight into the
  broadcast path, which is the recovery: publish it once the store's page is up.
  Nobody is notified, so a Drop can sit there — the poll report and the run log
  both count them (`deadLinkCount`, `totalDeadLinks`) precisely so that is
  visible.
- **One extra request per announced candidate.** Bounded by construction: only
  candidates about to be announced are asked about, the flood guard has already
  capped those at ten per poll, a baseline poll asks about nothing, and a refused
  poll asks about nothing. robots.txt is honoured and its answer is cached per
  origin, so vetting three releases from one store costs one lookup.
- **A Watch and its Variants are never touched.** This refuses an announcement.
  The product came from the store's own feed and stays in the catalogue, where a
  reader can still find it — the brand page and the Watch page are not claims
  that something is newly released.
- **A store that blocks bots on product pages while serving its feed gets no
  protection from this.** Every check returns `unverified` and every candidate
  publishes, exactly as before. That is the intended trade and not a gap to
  close: the alternative is refusing to announce anything from that brand.
