# ADR-0005 — An implausible poll is refused, not published

**Status:** accepted
**Date:** 2026-08-08
**Context issue:** [#37](https://github.com/grail-radar/crown-watch/issues/37),
following the 2026-08-07 incident
([#40](https://github.com/grail-radar/crown-watch/issues/40))

## Context

Tier 4 publishes without a human in the loop
([ADR-0001](./0001-tier-4-signals-publish-without-moderation.md)) and a Channel
cannot unsend ([ADR-0002](./0002-broadcasts-are-at-most-once.md)). Those two
decisions are good ones and they compose badly: the damage from a wrong poll is
unbounded and permanent, and it scales with how many messages go out before a
person notices.

On 2026-08-07 a poll read 372 real products as new releases and announced every
one of them to both Channels. The root cause was specific — a test run against
production overwrote four stores' stored snapshots — and it has its own guard
(`assertLocalDatabase`, [#36](https://github.com/grail-radar/crown-watch/issues/36)).
But the *shape* is reachable from several unrelated causes:

- a lost or corrupted stored snapshot
- a store redesign that changes every product URL
- an endpoint that moves, so the adapter reads a different page
- an adapter change that normalises URLs differently than the run before it

Each of them presents identically: one poll, one store, an enormous diff. None
of them is detectable from inside the diff, because the diff is working
correctly — it is being fed a bad baseline.

The site-watch pipeline had no upper bound at all. Its only refusals were an
empty catalogue and a failed fetch, both of which catch a store that says *less*
than expected. Nothing caught one that appeared to say far more.

## Decision

A poll whose diff exceeds a **configured threshold**
(`SITE_WATCH_MAX_CHANGES_PER_POLL`, default 10) publishes nothing, sends
nothing, and **writes nothing at all** — no Drops, no broadcasts, no Watches, and
in particular **no snapshot**. The source is recorded as `held`, a fifth
`SourceHealth`, with the reason on the row.

The guard sits in front of every write, not in front of the broadcast, and it
cannot be switched off: an absent, unparsable or non-positive threshold falls
back to the default rather than opening the gate.

**A hold is sticky.** Once a source is `held`, every subsequent poll is refused
regardless of how big its diff is, because a threshold applied per poll is
otherwise trivially defeated by time: a flood that loses a few products between
polls presents a diff under the wall, and the remainder is announced as though a
person had looked at it.

A baseline poll is exempt by construction — a first sight of a store has no
previous snapshot to diff against, so it has no changes to weigh, and it already
announces nothing however large the catalogue.

Exactly three things end a hold, and all of them are either a person or silent:

1. **Release** — `?release=true` on that source's poll, an explicit per-source
   operator action.
2. **Re-baseline** — deleting the source's stored snapshots, after which the
   next poll is a baseline: it announces nothing and starts clean. This is the
   right exit when the flood was an artefact rather than a real launch.
3. **The store returning to the catalogue we hold** — the snapshot hashes match,
   so there is no diff left to publish and nothing for anyone to rule on.

## Rationale

**Refusing beats publishing** for the same reason ADR-0002 chooses at-most-once.
A held poll costs a delay on real drops, which the feed and the digest still
carry. A published flood costs the Channels themselves, and the correction is
manual retraction of every drop and deletion of every message inside Telegram's
48-hour window.

**Not storing the snapshot is the load-bearing part**, and it is the decision
most likely to be "tidied up" by someone who has not read this. Storing the
refused catalogue would make the next poll diff against the flood, find nothing,
and report a healthy store. The refusal would silently clear itself, and any
genuine release hiding inside the flood would be lost with it — a *silent* loss,
which is the failure mode this project most wants to avoid. Holding the previous
snapshot instead makes the refusal repeatable: every poll re-derives the same
list, so an operator can see exactly what is waiting at any moment, without any
pending-payload machinery to keep in sync and without the risk of replaying a
stale catalogue into a channel.

This deliberately does **not** contradict
[ADR-0002](./0002-broadcasts-are-at-most-once.md)'s snapshot-before-dispatch
ordering, which still holds for every poll that is not refused. The guard runs
before that ordering begins.

**Not recording Watches either**, even though the catalogue is not an
announcement. The Watches would be built from the very payload the poll just
declined to believe; recording them would put a store's worth of invented
Watches on a public Brand page and leave an operator correcting two things
instead of one.

**`held` rather than `error`**, because the store did nothing wrong. It answered,
the adapter parsed it, and health that says "error" would send an operator
looking at a shop that is working perfectly. `held` also carries no backoff and
no failure streak, which leaves the ordinary hourly poll re-checking the source
— and re-deriving the report a human is going to read.

## Consequences

- **A held source stays held until a person acts**, apart from the one silent
  exit above. It is polled hourly like any other source and refuses each time,
  so the hold is visible in every run report until it is dealt with.
- **A real Drop that happens at a held store while it is held is not
  announced.** It is caught by the hold along with everything else, and it
  reaches the Channels only if the release covers it. This is the deliberate
  cost of stickiness, and it is bounded by how quickly an operator looks —
  which is the thing the run report is for.
- **A genuine large release is delayed, not lost.** A brand that publishes a
  whole collection at once is refused, and an operator releases it once they
  have looked at the store. Raising the threshold is the other option, and is
  the right one only for a brand that does this routinely.
- **Onboarding a large catalogue needs no change**, since the baseline is
  exempt. Registering a 250-product brand behaves exactly as before.
- **A flood that never trips the wall once is not caught.** Stickiness closes
  the "shrink under the wall after being held" case, but the guard still bounds
  a poll rather than a rate: a cause that leaked nine products an hour for a day
  would pass without ever raising a hold. Accepted, because every failure mode
  observed so far arrives at once — they are all snapshot- or parsing-shaped.
- **The threshold is a guess about brands, not a fact.** Ten is above anything
  the feed has genuinely produced (three at once is the record) and below the
  smallest store in the 2026-08-07 incident (twelve). It will need revisiting if
  the roster grows toward brands with larger catalogues and busier release
  cycles.

## Alternatives considered

- **Bound the broadcast instead of the poll.** Cheaper, and it protects the
  Channels — but the drops would still be published to the public feed and the
  weekly digest, and retraction would still be needed. The Channels are the
  irreversible surface, not the only wrong one.
- **Store the snapshot and refuse only the publishing.** Tidier-looking, and
  wrong: see above. It converts a held source into a silently healthy one.
- **Persist what the refused poll would have published**, so an operator can
  inspect it without re-polling. Rejected as machinery that buys nothing — the
  refusal is already reproducible from the store itself, and a stored payload
  invites releasing a catalogue that has since moved on.
- **Escalate to `error` and back off.** Would stop the hourly re-poll, at the
  cost of conflating a working store with a broken one and of hiding the report
  an operator needs behind a backoff window.
- **Make the threshold a fraction of the catalogue** (say, a quarter of it
  changing at once). More adaptive in principle, but it scales the wall with the
  very number a corrupted snapshot distorts, and it is far harder to explain to
  the person reading the run report at midnight.
