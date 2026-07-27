# ADR-0001 — Tier 4 site-watch signals publish without moderation

**Status:** accepted
**Date:** 2026-07-27
**Context issue:** [#1](https://github.com/grail-radar/crown-watch/issues/1), implemented by [#3](https://github.com/grail-radar/crown-watch/issues/3)

## Context

`CONTEXT.md` §5 states the project's most important architectural rule:

> **No source writes directly to the public feed.** … automated extraction will
> misread prices/dates/currency and occasionally hallucinate, so nothing goes
> live without passing through moderation.

Crown Watch's product promise is that a subscriber hears about a drop *the
moment it happens*. A drop that waits in `moderation_queue` for a human to click
approve is not an alert: if the reviewer is asleep, the subscriber misses the
release they were promised.

Tier 4 (§4) watches a brand's **own storefront** rather than a publication. The
signal is a structural diff — a product URL that did not exist before, or an
availability flag flipping from false to true. No language model reads prose
anywhere on that path.

## Decision

Run two lanes:

- **Tier 4 site-watch** — drops are created already approved and published, and
  are eligible for immediate alerting.
- **Everything LLM-extracted** — unchanged. Drops are created `pending` and wait
  in `moderation_queue` exactly as before.

`DropWriterService` is the single place a drop row is created, so the
published-versus-pending decision lives in one function rather than being
re-derived per caller.

## Rationale

§5's rule is stated together with its reason: extraction misreads and
hallucinates. That reasoning is about a model interpreting prose. It does not
transfer to a set-difference over a store's own product list, where the failure
modes are different in kind — a broken selector or a blocked request, not an
invented price.

So the rule is kept wherever its reasoning applies, and relaxed only where it
does not. The safeguard against the Tier 4 failure modes is not moderation but
refusing to act on implausible input: an empty catalogue is treated as a fault
rather than as "the brand delisted everything", and only two transitions can
raise a drop.

## Consequences

- A Tier 4 misfire reaches the public feed without a human seeing it first.
  Mitigations: the empty-catalogue guard, the deliberately narrow set of
  alert-worthy transitions, and per-source health tracking.
- An auto-published drop is distinguishable from a human-approved one:
  `published_at` is set while `reviewed_at` stays null.
- Provenance is recoverable — `drop → source_event → source.type` identifies
  every auto-published drop.
- `CONTEXT.md` §5 is now narrower than its literal wording. This ADR is the
  record of that; §5 should be read together with it.

## Alternatives considered

- **Moderate everything.** Honest to the letter of §5, but caps the promise at
  "we tell you when the maintainer wakes up" and removes the reason to pay.
- **Auto-publish above a confidence threshold.** Applies a confidence score to a
  structural diff that does not really have one.
- **Alert without publishing.** Subscribers get the alert, the public feed stays
  moderated. Rejected as incoherent: the feed would contradict the alerts.
