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

**We do not pay to be told what we already hold.** Country, founding year, the
price band and the catalogue counts come from our own database and are written
into the draft directly. Asking a model to re-derive them would spend money for
the privilege of disagreeing with ourselves.

**A draft with nothing in it is recorded as a failure, not stored as a draft.**
`sufficient = false` plus a note. An empty briefing that looks confident is
worse than no briefing: a writer reading "movement supplier: —" takes it for a
fact about the brand rather than a fact about us.

**Cost is bounded before it is spent and reported after.** `max_tokens` caps the
expensive half at 512 per Brand. A dry run counts the real input tokens through
the API's own tokeniser and multiplies by that ceiling to give a worst case for
the whole run. Actual usage comes off each response and is reported per Brand
and per run.

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
- **`known_for` entries are capped at 60 characters and 4 entries, and anything
  longer is dropped rather than truncated.** The cap is the copyright guard
  (`CONTEXT.md` §6): a tag is a few words in our own structure, and half a
  sentence of somebody's marketing copy is still their sentence. Dropping loses
  a fact; truncating would keep a liability and disguise it as a fact.
- **Cost is small but not nothing.** At Opus 4.8 rates a Brand costs roughly
  $0.019 in the worst case (about 1,150 input tokens, capped at 512 out), so the
  37 unannotated Brands are well under a dollar and a 300-Brand catalogue is
  under six. Measured, not estimated from characters — the tokeniser is asked.
- **A model with no rate in `pricing.ts` gets its tokens reported and no dollar
  figure.** Not zero, which would read as free. The table carries the date it
  was checked so a stale rate is discoverable rather than silently trusted.
