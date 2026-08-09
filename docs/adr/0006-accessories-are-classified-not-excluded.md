# ADR-0006 — Accessories are classified, not excluded

**Status:** accepted
**Date:** 2026-08-09
**Context issue:** [#38](https://github.com/grail-radar/crown-watch/issues/38),
with [#41](https://github.com/grail-radar/crown-watch/issues/41) depending on it

> **Amended 2026-08-09.** #41 settled where accessories are shown, and found
> that the per-Watch half of its own preferred shape is not buildable from the
> data. See the amendment at the end.

## Context

A brand's `products.json` returns everything the shop sells, and Tier 4 treats
every product as a candidate release. So the Channels were told about
*Bracelet Lézard - Marron*, *Boucle SERICA*, *'Black Tie'* spring bars,
*Ajouter votre gravure*, ten YEMA straps, a travel case, a gift card and a
product literally named `Warranty Product`.

The scale only became legible when `backfill:drop-watches`
([#26](https://github.com/grail-radar/crown-watch/issues/26)) attached 373
existing Drops to Watches and printed them by Watch: a large share of the feed's
history is not watches. `CONTEXT.md` §1 makes the promise plainly — the feed
tells you when a watch lands — and a Channel cannot unsend (ADR-0002).

Straps are not junk. They are a real thing a brand sells, the data is already
collected, and a reader may well want to know that a model comes on a bracelet.
The problem is what they are announced *as*.

## Decision

Every product a watcher sees is classified as a **watch** or an **accessory**,
and the answer is **stored on the Watch row** (`watches.kind`).

- Only a Watch of kind `watch` raises a Drop. Accessories reach neither the
  public feed nor the Channels.
- Accessory rows are recorded in full — Variants, prices, availability, images.
  Nothing is deleted or skipped at ingestion.
- The classification is a **list of cases** over the product title, in the
  spirit of ADR-0003, and an operator overrules it per Watch with
  `watches.kind_override`. Null means "trust the rule".

Stored rather than derived at render time, because the question that has to be
answerable is *"which Drops should never have gone out?"* — and that has to be a
join, not a re-poll of every store.

## Rationale

**Classification beats exclusion** because the two tickets want different
things. #38 needs accessories out of the feed today; #41 needs them visible
somewhere tomorrow. Dropping them at ingestion would satisfy the first and make
the second start by re-fetching four stores.

**The two misclassifications are not symmetrical, and the rule leans
accordingly:**

- An accessory called a watch is **noise**: one message that should not have
  gone out. Somebody sees it, marks the row, and it never recurs.
- A watch called an accessory is **silence**. The release is never announced,
  no alert is missing from anywhere anyone looks, and the feed quietly fails at
  the only thing it promises.

So the rule matches whole words that only ever mean an accessory, plus a few
products named outright, and gives up on everything else. `'Black Tie'` and
`SERICA Expédition` stay watches, because nothing in those titles says
otherwise and guessing costs more than admitting ignorance.

The same asymmetry decided which keywords survive. `nato`, `mesh`, `band`,
`roll` and `tool` were all tried and removed: a store lists "Skin Diver CMM.20
Steel Bracelet", and "tool watch" is ordinary trade vocabulary, so each of them
silenced real watches to catch accessories the remaining nouns already catch.
`cap` went the same way — *Cap Horn* is a plausible watch, and the hat is worth
less than the release.

What replaced them is a short list of products **named outright**, matched
against the whole title: `Bonklip®`, `Vesper Mesh`, `'Black Tie'`, `SERICA
Expédition`, `YEMA Cap`. Whole-title matching is what makes those free — no
watch is ever titled *exactly* "yema cap", so naming one costs nothing, which is
precisely what a keyword could not promise.

**Kind lives on the Watch, not the Variant.** Grouping is by title and
classification is by title, so every Variant of a Watch would get the same
answer. One column, and it cannot disagree with itself.

## Consequences

- **The rule will be wrong, and that is planned for.** It will never catch a
  strap whose title says nothing, and `bracelet` — which it must keep, because
  that is how both Serica and YEMA title the strap itself — will occasionally
  silence a watch listed on one. `kind_override` exists so being wrong costs a
  row and not a release.
- **A misclassification is named, not just counted.** A poll reports the
  accessories it saw for the first time by name, because that is where a
  wrongly-silenced watch shows up. Standing accessories are left out; a brand
  with forty of them would drown the report every hour.
- **An override does not reach a held source.** A poll that refuses
  (ADR-0005) returns before it rebuilds the catalogue, so a correction waits
  until the hold is released or the source re-baselined. Accepted: a held
  source is already an abnormal state that needs a human that day.
- **`kind` is rewritten on every poll; `kind_override` never is.** A rule that
  could overturn a human ruling on the next run would make the override
  worthless.
- **Existing rows needed a pass.** Everything predating this defaulted to
  `watch`. `backfill:watch-kinds` classifies them, and its output is how the
  cleanup ticket learns which published Drops were about accessories.
- **Where accessories are shown** — decided by
  [#41](https://github.com/grail-radar/crown-watch/issues/41), see the amendment
  below.
- **Accessory Drops already announced stay on the feed.** This change is
  prospective. Retracting them is a separate, deliberate operator action, and it
  is now possible to enumerate them:

  ```sql
  SELECT d.id, b.name, d.title, d.published_at
  FROM drops d
  JOIN watches w ON w.id = d.watch_id
  JOIN brands b  ON b.id = d.brand_id
  WHERE w.kind = 'accessory' AND d.published_at IS NOT NULL;
  ```

  Drops with a null `watch_id` — anything read from a publication's RSS — are
  outside that query, by definition.

## Alternatives considered

- **Exclude accessories at ingestion.** Simplest, and it throws away exactly the
  data #41 was written to display.
- **Filter at render time instead of storing.** No migration, and it makes
  "which Drops were wrong" a question only a full re-poll can answer. The
  stored column exists precisely to make that a join.
- **Ask a model what each product is.** Recurring cost per product against a
  roughly $4 credit balance, non-deterministic across polls, and the same
  objection ADR-0003 raised: this is a decision that wants correcting by editing
  a row, not by re-prompting.
- **Classify by price, or by whether the title carries a movement reference.**
  Both fail on the real data — Serica's watches are named `Réf. 8315-2` and its
  straps are named `Bracelet 'Parade'`, and a tourbillon and a leather strap do
  not sort cleanly by price band across four brands.
- **A separate `accessories` table.** Cleaner in the abstract, and it would
  duplicate Variants, slugs, and the grouping rule wholesale to express one
  boolean.

---

## Amendment, 2026-08-09 — where accessories are shown

**Context issue:** [#41](https://github.com/grail-radar/crown-watch/issues/41).

#41 posed the shape as a choice: are accessories something a reader browses in
their own right, or context that appears on a Watch and on a Brand? It
preferred the second — "nobody arrives wanting a strap directory, but plenty of
people want to know whether *this* watch comes on a bracelet."

**Half of that preference is not buildable, and it is the more appealing half.**
Nothing in the data links an accessory to the watches it fits. A Watch owns its
Variants; an accessory is its own Watch with its own Variants; there is no
relation between them, and none can be derived — "Rallye Leather Strap" does not
say which models it suits, and inferring it from lug width would mean parsing
specs the project deliberately does not collect (see the `Watch` model's note on
absent spec columns).

So the decision is the achievable part of the preference:

- **Accessories appear on the Brand page**, in a section below the Drops, each
  linking to the Watch page it already has. Quiet by design — a strap is context,
  never news.
- **Accessories do not appear on a Watch page.** Not rejected on taste; it
  requires an accessory→Watch relation that does not exist. Building one is a
  ticket of its own, and it needs a source of truth nobody has yet offered.
- **There is no accessory directory**, per the ticket's own reasoning.
- **In stock leads.** A brand can sell forty straps with half of them gone, and a
  list headed by what cannot be bought reads as a dead catalogue.

Two things fell out of the same change, both required by #41's criteria:

- **An accessory Drop is no longer served or sent**, including the ones
  announced before #38 existed. That is a filter, not a cleanup: the Drops and
  their `drop_broadcasts` rows stay exactly where they are, because those rows
  are the only evidence the messages were sent (ADR-0002).

  One predicate, `ABOUT_A_WATCH`, is shared by every path rather than copied
  into each. Review found the send side entirely unguarded when it was not:
  #38 had closed only the *write* path, so a Channel added later would have
  backfilled every historic strap into it, the weekly digest was still mailing
  them, and approving a pre-#38 Drop still sitting in the moderation queue would
  have posted one. Three places each deciding what "public" means is how that
  happens. The paths now covered: the drops feed, a Drop's own URL, the Brand
  page, the brand directory's count, the weekly digest, the Telegram backfill,
  and `broadcastDrop` itself — the last of which checks the row rather than the
  query, because it is the step that cannot be undone.
- **A Drop with no Watch is still served.** Anything read out of a publication's
  RSS has a null `watch_id`, and excluding accessories carelessly would have
  taken the whole of Tier 1 with them.
