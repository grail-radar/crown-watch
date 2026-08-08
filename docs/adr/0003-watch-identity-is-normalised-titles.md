# ADR-0003 — A Watch is identified by its normalised title, not by inference

**Status:** accepted
**Date:** 2026-08-07

> **Amended 2026-08-08.** Restock is now judged at the Watch rather than at the
> Variant — see the struck consequence below. The override table this ADR's
> trade-off depends on was delivered by
> [#27](https://github.com/grail-radar/crown-watch/issues/27); until then the
> trade was one-sided.

## Context

A store product is not a watch. On 2026-08-06 the YEMA watcher found three
products — `…-38-zn-u8`, `…-37-zn-u7`, `…-34-zn-u4` — all titled "Superman
Bronze CMM.10" at the same price. Each became its own `drop` and its own
Telegram post, so both channels announced one watch three times within a second.
ADR-0002 states plainly that a channel which repeats itself gets muted; this is
that failure, and it will recur on any store that lists variants as separate
products, which is most Shopify stores.

The same problem appears on the read side. With discovery as the primary use
(`CONTEXT.md` §1), a brand page showing one watch three times is broken on the
screen the product is judged by.

So a **Watch** becomes a first-class entity owning its **Variants**, and
something has to decide when two store products are the same Watch.

Baltic makes the boundary concrete and non-obvious: "Scalegraph Classic - Panda"
and "Scalegraph Classic - Reverse Panda" are two dials of one model, and an
enthusiast will tell you those are genuinely different watches to want. Any rule
that merges them is wrong.

## Decision

Group by **brand plus the product title, normalised of trailing variant
suffixes**. A small manual override table corrects the cases the rule gets wrong,
in both directions — forcing a merge, or forcing a split.

Variants hang off the Watch. A Drop is one event about one Watch, so the
`drop_broadcasts` claim stays `(drop_id, chat_id)` exactly as ADR-0002 defines
it, and one event produces one message without that table changing at all.

## Considered options

- **Exact title match.** Too strict: YEMA's three products share a title only
  because that store happens to repeat it. Any store appending a reference or a
  strap name defeats it.
- **An LLM call deciding sameness.** Recurring per-product cost against a
  roughly $4 credit balance, non-deterministic across polls, and the rule stops
  being something you can read. Grouping is a decision that wants correcting by
  editing a table, not by re-prompting.
- **Grouping by product image or price.** Both vary per variant by design.

## Consequences

- ~~**Availability is per Variant, so a restock fires when *any* Variant
  returns.** This is the right reading — the Watch is buyable again — but a
  follower can be told about a restock when only the configuration they don't
  want came back.~~

  **Superseded by [#26](https://github.com/grail-radar/crown-watch/issues/26)
  (2026-08-08).** Availability is now read at the Watch: a restock fires only
  when the Watch had *nothing* buyable and now has something. A configuration
  returning to a Watch that was on sale throughout is silent.

  The original reading was wrong about which mistake is cheaper. "Back in stock"
  about a watch that never left is not a near-miss, it is a false statement, and
  a Channel that makes them gets muted exactly as ADR-0002 describes. The cost of
  the new rule is a genuinely missed signal — a follower waiting for one specific
  bracelet is not told when only that bracelet returns — and that is the bounded
  failure of the two.
- **The override table is load-bearing and must be easy to reach.** The rule is
  deliberately simple, so it will be wrong sometimes; an override that requires a
  deploy would mean living with the error.

  Delivered by [#27](https://github.com/grail-radar/crown-watch/issues/27) as
  `watch_grouping_overrides`. One row re-homes one store product, and both
  directions fall out of that: two products sharing a `watch_key` merge, a
  product given its own key splits off. The overrides are read on every poll and
  handed to the catalogue writer and the diff together, so a correction takes
  effect on the next run and the two can never group differently. Overrides are
  applied even when the store has not changed, because a correction is nearly
  always written about a catalogue that has no reason to move.

  An override the store no longer matches is listed in the poll report and
  logged, and its `last_matched_at` stops advancing — so a correction that has
  quietly stopped applying is visible rather than sitting in the table looking
  effective. See the
  [runbook](../operations/site-watch-runbook.md#correcting-a-wrong-grouping).
- **History is not rewritten.** Existing drops gain a `watch_id` and nothing is
  deleted. Merging the three YEMA drops would cascade their `drop_broadcasts`
  rows, destroying the only evidence those messages were sent and risking a
  re-broadcast of a watch followers have already seen twice. The three posts stay
  wrong forever, because a channel cannot unsend — the fix is prospective.

  Implemented by `backfill:drop-watches`, which is dry-run by default and
  re-counts `drop_broadcasts` before and after.
- **A new buying option for a Watch already on sale is silent.** A third
  bracelet for a model that launched last year is not a release, so it raises no
  Drop. Only a Watch we have never seen any product of, or one that was
  unbuyable and is not any more, is an event.
- **Novelty is decided by product URL, not by the grouping key.** A store
  tidying a title changes the key, and a rule comparing keys would read that
  rename as a brand-new watch and announce a release that never happened.
