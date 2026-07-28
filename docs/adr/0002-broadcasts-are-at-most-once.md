# ADR-0002 — Public broadcasts are at-most-once, never at-least-once

**Status:** accepted
**Date:** 2026-07-28
**Context issue:** [#1](https://github.com/grail-radar/crown-watch/issues/1), implemented by [#4](https://github.com/grail-radar/crown-watch/issues/4)

## Context

Detected drops are broadcast to two public Telegram channels, one Ukrainian and
one English. Unlike the per-user alerts `notifications_log` guards
(`CONTEXT.md` §5), these channels belong to nobody: every follower sees every
message, and nobody opted into a specific brand.

Polls overlap. The scheduler ([#7](https://github.com/grail-radar/crown-watch/issues/7))
will run them unattended, a deploy can restart the process mid-run, and an
operator can trigger a poll by hand while a scheduled one is in flight. So the
same drop will be handed to the dispatcher more than once, and the delivery
guarantee has to be chosen deliberately rather than inherited by accident.

The hard case is a send whose outcome we never learn — a timeout, a dropped
connection, a killed process between the request and the response. Telegram may
or may not have posted the message, and nothing we can observe afterwards
distinguishes the two.

## Decision

Broadcasts are **at-most-once**. A `drop_broadcasts` row, unique on
`(drop_id, chat_id)`, is claimed *before* the send is attempted. Whoever wins
the insert owns the send; every other attempt sees the row and stops.

A send that fails is recorded as `failed` and **is not retried**. A claim whose
process died before recording an outcome stays `pending` and is likewise never
retried.

## Rationale

The two failure modes are not symmetrical:

- A **lost** message costs one drop alert. The drop is still on the public feed
  and in the weekly digest, so the information is not lost, only its immediacy.
- A **repeated** message costs the channel. `CONTEXT.md` §2 makes alerting the
  paid tier's core promise, and a channel that posts the same watch twice gets
  muted — after which every future alert is lost, not just one.

An unbounded downside beats a bounded one, so the ambiguous case resolves
toward silence. This is the same instinct as the Tier 4 diff itself, which stays
silent on price edits, photo swaps and sell-outs rather than risk noise
(ADR-0001).

Claiming before sending is what makes the guarantee real rather than intended:
recording after a successful send would leave the crash window unprotected,
which is precisely the "restart mid-run" case.

## Consequences

- A transient Telegram outage silently costs those drops their alerts. They are
  visible on the feed and in the digest, and `drop_broadcasts.error` records
  what happened, but nothing re-sends them.
- **A drop can end up never broadcast at all, not merely broadcast late.**
  `SiteWatchService` stores the new snapshot *before* it dispatches, so a
  process killed part-way through the change loop leaves a snapshot the next
  poll compares equal against: the diff is empty, no drop is re-created, and
  the surviving drop row is never handed to the dispatcher. Nothing re-drives
  dispatch from the `drops` table.

  This is the accepted cost of the ordering, not an oversight. Storing the
  snapshot after dispatch would trade it for a worse failure: the next poll
  would re-detect the same changes and create duplicate drop rows on the public
  feed — visible to everyone, not just to one channel's followers.

  A re-drive is possible later precisely *because* the claim is keyed on
  `(drop_id, chat_id)`: a job that sweeps recently published drops through
  `broadcastDrop` cannot double-post, since already-broadcast pairs lose the
  insert. Deferred until the scheduler exists
  ([#7](https://github.com/grail-radar/crown-watch/issues/7)) makes unattended
  runs — and therefore mid-run deaths — routine.
- Re-broadcasting is a deliberate operator action: delete the `drop_broadcasts`
  row for that `(drop, channel)` and poll again. There is no automatic path,
  by design.
- The key is the **chat id**, not the locale. Pointing a locale at a different
  channel — a test channel swapped for the real one, a typo'd id corrected —
  is a channel that has genuinely never seen the drop, so it is broadcast to.
- A `pending` row that is hours old is a real signal for the operator runbook
  ([#7](https://github.com/grail-radar/crown-watch/issues/7)): it means a run
  died mid-send.

## Alternatives considered

- **Retry failed sends with backoff.** Standard, and correct for per-user
  channels where a duplicate is a minor annoyance. Rejected here because the
  ambiguous-timeout case makes retry indistinguishable from repeat, and repeat
  is the expensive mistake on a public channel.
- **Record after sending instead of before.** Simpler and never loses a message
  to a transient error, but leaves exactly the crash window the ticket names —
  a restart mid-run would replay the drop.
- **Reuse `notifications_log`.** It is keyed on `user_id`; a public channel has
  no user. Inventing a synthetic user to satisfy the schema would make the
  per-user dedup guard mean two different things.
- **Key on locale rather than chat id.** Marginally simpler, but a corrected
  channel id would then be permanently blocked from receiving drops it never
  actually got.
