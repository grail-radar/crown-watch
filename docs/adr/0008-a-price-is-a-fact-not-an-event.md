# ADR-0008 — A price is a fact, not an event

**Status:** accepted
**Date:** 2026-08-10
**Context issue:** [#25](https://github.com/grail-radar/crown-watch/issues/25)

## Context

Two questions arrived together, and the answer to the second decides the first.

The stored snapshot's identity covered title, price, currency and image, but the
diff acts on exactly two things: a product URL never seen before, and
availability turning true. So a store could rewrite its landing zone for fields
that can never produce a Drop. YEMA does exactly that — its alternating market
price lists moved the hash six to eight times a day, and every one of those
stored payloads was a no-op.

The second question is whether that is a bug at all. **A real price drop on a
watched Watch is a genuine event nobody would call noise**, and the data is
currently being thrown away. If price movement is going to become a Drop, then
price belongs in the snapshot's identity and there is nothing to fix.

## Decision

**Price movement raises no Drop.** Price, currency and image leave the **Signal**
— the part of a store's catalogue that can become a Drop (`CONTEXT.md` §9). A
poll whose Signal has not moved stores nothing.

**Title stays in that identity**, though a retitle raises no Drop either.
`groupByWatch` derives its key from the title, so the titles in the *stored*
snapshot decide how the previous state is grouped. Let one go stale and
`groupedBefore` misses, a Watch's since-delisted references fall out of
`wasBuyable`, and the next availability flip announces a restock that never
happened.

**The catalogue is written from every poll whose content moved**, price included.
A price is a fact about a Watch and belongs on its Variant, where the brand page
and the price band read it. Only the *landing zone* goes quiet.

**What the store last showed us is recorded on the source**, in
`sources.last_content_hash`, separately from what was last stored. Those two
part company the moment a cosmetic poll stops storing anything, and without the
first one "changed" would be measured against the last **stored** payload rather
than the last one **seen** — so a store that moved a price once and then settled
would read as changed at every poll from then on and re-upsert its whole
catalogue hourly, for ever.

Deliberately **not** solved by rewriting the stored snapshot in place, which is
the obvious fix and the wrong one: that row is a Drop's `source_event_id`, so
overwriting it would rewrite the provenance of an announcement that had already
been sent, and would make this the one place the project discards raw fetched
content against `CONTEXT.md` §5.

## Why price movement is not an event, for now

- **The evidence in this very ticket is that store prices oscillate for no
  reason.** YEMA's rotation is the data set we have, and it is noise by
  construction. A Drop type built on it would fire on that rotation on day one,
  and ADR-0002 is unambiguous about what happens to a Channel that fires on
  noise.
- **We cannot reliably say what a price even is.** Most Shopify-fed stores give a
  bare number with no currency (#24), so "€990 → €890" is frequently
  "990 → 890" in an unknown unit. A percentage threshold papers over that; it
  does not fix it.
- **There is nowhere to put the history.** `watch_variants.price` holds the
  current price and nothing else. Distinguishing a wobble from a reduction needs
  a series, and this project has no price-history table — inventing one to serve
  a feature nobody has asked for is the speculative half of the work, not the
  cheap half.
- **The narrow-events rule is load-bearing.** `watch-events.ts` deliberately
  stays silent on price edits, title tweaks, images, a Watch selling out, and a
  new bracelet for a model that launched last year. Price is not an exception
  waiting to be made; it is the same rule.

**What would have to be true to revisit.** A price history worth trusting, a
threshold validated against a real oscillation sample rather than guessed, a
currency we can state (or a decision to announce bare numbers), and a `DropType`
with message templates in both locales. That is a ticket, not a clause in this
one.

## Considered options

- **Keep price in the snapshot identity and do nothing.** Rejected: it keeps
  writing payloads nobody reads, and leaves the landing zone growing at six to
  eight rows per source per day for no signal.
- **Narrow to url and availability only, as #25 proposed.** Rejected on the
  evidence — see the title clause above. The ticket reasoned from what the diff
  *acts on*; the grouping reads the title too, one level down.
- **Announce price drops above a percentage threshold.** Rejected for now, per
  the reasoning above. Deliberately not "never".
- **Keep storing snapshots purely to preserve price history.** Rejected. It is
  paying a certain cost — a growing landing zone — for a feature that has not
  been specified, using a data structure (a raw payload per observation) nobody
  would choose for a time series.

## Consequences

- **Price history is not recoverable from `raw_ingestion_events`.** This is the
  real cost and it is accepted: a poll whose only movement was a price stores
  nothing, so that observation is gone. `watch_variants.price` still holds the
  current price, refreshed on every poll whose content moved, so the site stays
  correct — but anyone building price-drop detection later must build the
  history deliberately rather than mine it from snapshots.
- **A stored snapshot may be stale on price, currency and image**, for as long as
  a store makes no announceable change. Nothing reads those fields out of it: a
  Drop is built from the live fetch, and the catalogue is written from the live
  fetch (verified on #25). The snapshot's only job is to answer "had we seen this
  product, and was it buyable".
- **A held source is released by a return that has drifted on price.** ADR-0005
  ends a hold when the store returns to the catalogue we already hold; under the
  narrowed identity that now includes a return whose prices moved meanwhile.
  Correct rather than lenient — prices were never what was being held back — but
  it is a change to a safety guard, so ADR-0005 is amended rather than quietly
  overridden, and both directions are asserted in the tests: a settled return is
  released, a store still flooding stays held whatever its prices say.
- **No raw content is ever overwritten or deleted.** `CONTEXT.md` §5 stands
  untouched: a quiet poll simply writes no payload. The observation is not kept,
  which is the accepted cost above; nothing that *was* kept is disturbed, and no
  Drop's `source_event_id` ever points at a payload other than the one that
  produced it.
- **`snapshotStored` appears in the poll report**, so an operator can see the
  difference between "nothing happened" and "nothing worth recording happened".
