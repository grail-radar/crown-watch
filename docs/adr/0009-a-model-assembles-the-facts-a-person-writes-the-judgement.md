# ADR-0009 — A model assembles the facts; a person writes the judgement

**Status:** accepted
**Date:** 2026-08-10
**Context issue:** [#30](https://github.com/grail-radar/crown-watch/issues/30)

## Context

The **Annotation** is the product. `CONTEXT.md` §2 is blunt about why: a
competitor already tracks ten times as many Brands with restock alerts and
sell-out speed, so breadth and speed are not available as a differentiator. One
honest sentence per Brand — including the unflattering ones — is.

It does not scale by hand. The catalogue is aiming at 300 Brands and 37 are
unannotated today, and the research behind one sentence is most of the work:
where the brand is based, who makes its movements, whether "in-house" is a real
claim, what it is actually known for, what it costs.

The obvious move is to have a model write the Annotation. That would destroy the
thing being scaled. A model writing evaluative prose from a brand's own copy
produces exactly the bland, faintly promotional summary that makes the feature
worthless — and worse, it would be indistinguishable at a glance from the honest
sentence next to it, so it would devalue the ones a person did write.

## Decision

**Split the work along the line where a model is actually good.** A model
assembles facts. A person writes the judgement. Nothing writes both.

**The judgement is not merely un-requested — it is unrepresentable.** The tool
the model answers through has no field for a sentence, `tool_choice` forces that
tool, and `strict: true` validates the result against its schema. There is
nowhere for prose to go. An instruction saying "do not write the opinion" is a
request; a schema without the field is not.

**Drafting never writes to the Brand.** Facts land in
`brand_annotation_drafts`, keyed one-per-Brand. `brands.annotation` and
`brands.status` are untouched by this path, which is what makes rejecting a
draft a plain delete with no half-annotated state to repair.

**The model is shown evidence, not asked to remember.** The prompt carries the
brand's own page — fetched through the same `SiteFetcher` and the same
robots.txt guard as a Tier 4 poll — plus the Watches we track and the Drops we
have covered. Parametric memory about an obscure microbrand is exactly where a
model invents a movement supplier with total confidence, and "assemble the facts
in front of you" is a different task from "recall what you know about Baltic".
When a site cannot be read, the reason is carried on the draft, so a writer
knows the briefing was assembled from thin material before trusting it.

**We do not pay to be told what we already hold.** Country, founding year, the
price band and the catalogue counts come from our own database and are written
into the draft directly. Asking a model to re-derive them would spend money for
the privilege of disagreeing with ourselves.

**Nothing may be repeated back verbatim from the material we showed it.** Every
field is checked against the site text, the Watch names and the Drop titles the
model was given, normalised for case and whitespace, and dropped if it appears
there (`CONTEXT.md` §6). A length cap alone does not do this job — a tagline is
short, and "Swiss movements, honest prices" lifted off a homepage reads like a
fact and is actually their marketing. Phrases under fifteen characters are
exempt: "Sellita" is on the page precisely because it is the fact we asked for.

**The three outcomes are kept apart, because what happens next differs.**
`usable` is a briefing. `empty` means we asked and got too little to brief
anyone — an answer, so the Brand is not asked again. `failed` means we could not
ask at all, which is not an answer, so the Brand stays in the queue. An empty
briefing that looks confident is worse than no briefing: a writer reading
"movement supplier: —" takes it for a fact about the brand rather than a fact
about us.

**Cost is bounded before it is spent and reported after.** `max_tokens` caps the
expensive half at 512 per Brand. A dry run counts the real input tokens through
the API's own tokeniser — against a prompt built exactly the way the paid ones
are, evidence included — and multiplies by that ceiling to give a worst case for
the whole run. Actual usage comes off each response and is reported per Brand
and per run. A run spends on at most 100 Brands; a dry run is deliberately
unclamped, because budgeting a 300-Brand catalogue is the question being asked
and a capped estimate leaves the operator extrapolating by hand.

## Considered options

- **Have the model write the Annotation, with a human approving it.** Rejected,
  and this is the one that matters. Review is a much weaker filter than
  authorship: a reviewer reads a plausible sentence and asks "is this wrong?",
  where a writer has to ask "what do I actually think?". The second question is
  the product. This also fails ADR-0004's spirit — an Annotation nobody can buy
  is worth little if nobody wrote it either.
- **Have the model draft and a human edit.** Rejected for the same reason, one
  step weaker. An edited draft keeps the draft's shape and its hedge; the
  unflattering clause is exactly what an editor smooths away.
- **Ask the model for everything, including country and price.** Rejected: we
  hold those, and a second source for a fact we already have is a disagreement
  waiting to be resolved by whoever notices it last.
- **Free-text notes field on the draft.** Rejected. It is the prose field with a
  different name, and it would fill up with exactly the sentence this ADR exists
  to keep out.
- **Draft on every poll, automatically.** Rejected. Drafting is occasional, it
  costs money per Brand, and there is no deadline — a scheduled job would spend
  continuously to keep a queue full that nobody is emptying.

## Consequences

- **A draft is worth nothing until a person spends five minutes on it.** That is
  the point, and it is also the cost: 37 drafts is 37 sentences somebody has to
  write. The bottleneck moves from research to judgement, which is where it
  should be, but it does not disappear.
- **The facts can be wrong.** A model is confident about movement suppliers it
  has no business being confident about. The draft is a starting point for a
  writer who will check what matters, not a source of record — nothing here
  writes to the Brand, so a wrong fact costs a minute rather than a correction.
- **A lifted phrase is dropped rather than truncated.** Half a sentence of
  somebody's copy is still their sentence, and truncating would keep the
  liability while disguising it as a fact. Fields are also capped at 60
  characters and 4 tags, but that is a second line of defence now — the guard
  that does the work is the verbatim check.
- **Grounding costs input tokens.** A prompt carrying up to 4,000 characters of
  a brand's page is several times the size of one asking a model to recall. That
  is the trade: the cheap prompt produces confident fiction about exactly the
  brands nobody has heard of, which is all of them. Input is the cheap half of
  the bill, and the estimate counts the real prompt, so the operator sees it.
- **Reading a brand's site is a poll of their server.** It goes through the same
  fetcher and the same robots.txt check as the Tier 4 watcher, so a brand that
  has asked us not to read a page is not read here either.
- **Cost is small but not nothing.** At Opus 4.8 rates a grounded Brand costs
  roughly $0.025 in the worst case — 2,374 input tokens measured against a real
  brand's page, capped at 512 out — so the 37 unannotated Brands come to about
  $0.90 and a 300-Brand catalogue to about $7.40. Measured, not estimated from
  characters: the tokeniser is asked, on the prompt that will actually be sent.
- **A model with no rate in `pricing.ts` gets its tokens reported and no dollar
  figure.** Not zero, which would read as free. The table carries the date it
  was checked so a stale rate is discoverable rather than silently trusted.
