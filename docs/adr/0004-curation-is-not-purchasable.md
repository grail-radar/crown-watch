# ADR-0004 — Curation is not purchasable

**Status:** accepted
**Date:** 2026-08-07

## Context

`CONTEXT.md` §2 originally planned a B2B tier where "brands pay for 'verified
drop' placement/featured visibility — similar to Product Hunt." At the time the
stated differentiator was a brand reliability score, so paid placement sat
alongside it without obvious conflict.

That differentiator is retired (§2): `promised_ship_date` is populated on 0 of 14
drops because articles do not state ship dates. What replaced it is **curated
brand judgement** — one honest sentence per Brand, including the unflattering
ones, of the kind an enthusiast wrote unprompted in a public thread: *"~$700+
Artificial FOMO"*, *"more fashion than micro"*, *"mostly homages and aliexpress
specials"*.

Those two business models cannot both be true. If a Brand can pay to be
**Curated**, or to be placed above another, then every Annotation on the site is
suspect — including the honest ones, which is the part that actually costs.

This is not hypothetical. In August 2026 the moderators of a 120k-member
microbrand community answered a request to post about Crown Watch with a rate
card for pinned placement and "Verified Brand" flair through their own
publication. It read exactly as it was, and it is precisely the position this
decision refuses to occupy.

## Decision

**Placement, ordering and Annotations are never purchasable.** No Brand can pay
for what we say about it, for where it appears, or to move from Listed to
Curated.

Affiliate tags on purchase links are permitted, because an affiliate link on a
link we would have shown anyway does not change what is said about the Brand.

Revenue therefore comes from readers or from affiliates — never from the Brands
being judged.

## Rationale

The reversal is asymmetric. Taking the money is easy and immediately profitable;
restoring trust afterwards is slow and may be impossible. Readers cannot audit
which entries were paid for, so the only credible position is a categorical one,
stated in public, before there is money on the table.

The audience makes this sharper than it would be elsewhere. Watch enthusiasts
are unusually alert to undisclosed sponsorship, and the communities this depends
on for reach — Reddit, partner Telegram groups — react to it faster than search
does.

## Consequences

- **The B2B line in `CONTEXT.md` §2 is deleted, not deferred.** A future reader
  should find the refusal, not an unimplemented plan they might pick up.
- **Brand relationships have to be handled without a commercial hook.** The first
  brand to ask for inclusion (Forward Watch Co., via Reddit) is added on the same
  terms as any other, and told so.
- **A partner group carrying the feed is not a paid placement in either
  direction** — we do not pay for carriage, and the group does not pay to be in
  the feed.
- **Affiliate coverage will be thin**, since most microbrands run no programme.
  That is accepted rather than solved by loosening this rule.
