# Writing Annotations

The Annotation is the product. `CONTEXT.md` §2 says why in one line: a
competitor tracks ten times as many brands and cannot tell you whether any of
them is worth your money. One honest sentence per Brand — including the
unflattering ones — is the thing that cannot be scraped.

**A model never writes it.** It cannot: the tool it answers through has no field
for a sentence, and the drafting path never touches `brands.annotation` or
`brands.status` ([ADR-0009](../adr/0009-a-model-assembles-the-facts-a-person-writes-the-judgement.md)).
What drafting gives you is the research — where they're based, who makes the
movements, what they're known for — so writing the sentence takes five minutes
instead of an afternoon.

---

## 1. Draft the facts

Dry run first. It calls the tokeniser, which is free, and tells you what the
real run would cost:

```bash
pnpm --filter @crown-watch/api draft:annotations -- --limit=20
```

It prints the model, the Brands it would draft, the input tokens it actually
counted (not a guess from character length), and a worst case for the run. At
Opus 4.8 rates a Brand is roughly **$0.019** worst case, so the 37 unannotated
Brands are well under a dollar.

Then spend:

```bash
pnpm --filter @crown-watch/api draft:annotations -- --limit=20 --confirm
```

It picks Brands with no Annotation and no draft, oldest first. Set
`ANTHROPIC_DRAFT_MODEL` to pay for a better model here without changing the
hourly extraction pass.

**Nothing is published by this step.** No Brand changes at all.

## 2. Read the drafts

```bash
psql "$DATABASE_URL" -c "select b.slug, d.sufficient, d.facts, d.note from brand_annotation_drafts d join brands b on b.id = d.brand_id order by d.created_at desc limit 20;"
```

A draft carries what the model found (movement supplier, in-house or not, what
it's known for, a signature watch, where it's assembled) alongside what we
already held (country, founding year, how many Watches and Drops we track).

`sufficient = false` means we asked and got nothing useful — `note` says why.
Those are recorded rather than dropped, so "we tried this Brand and it came back
empty" doesn't look identical to "nobody has drafted this Brand".

**Check what matters before you rely on it.** A model is confident about
movement suppliers it has no business being confident about. The draft is a
starting point, not a source of record.

## 3. Write the sentence

This is the part that is not automatable and is the whole product. It should be
the thing you would tell a friend who asked whether to buy one — including the
part they would not like.

> Real in-house movements at a price nobody else manages, let down by quality
> control that varies more than it should — buy the Superman, budget for a
> regulation.

Not this:

> A respected French microbrand known for vintage-inspired designs and
> exceptional value.

The second one is what a model writes, and it is worth nothing.

## 4. Publish it

This moves the Brand to **Curated** — the state that means a human approved
what we say. There is no UI, deliberately:

```bash
curl -fsS -X PUT "$API_BASE_URL/moderation/brands/<slug>/annotation" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"annotation":"Real in-house movements at a price nobody else manages, let down by quality control that varies more than it should."}'
```

To take it back — the Brand returns to Listed and the writing is preserved:

```bash
curl -fsS -X DELETE "$API_BASE_URL/moderation/brands/<slug>/annotation" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

## Throwing a draft away

```bash
pnpm --filter @crown-watch/api draft:annotations -- --reject=<slug>
```

Safe by construction: drafting never wrote to the Brand, so this is a delete
with nothing to repair. Re-draft a Brand by naming it, which overrides the
"already has a draft" skip:

```bash
pnpm --filter @crown-watch/api draft:annotations -- --brand=<slug> --confirm
```

---

## Related

- [ADR-0004](../adr/0004-curation-is-not-purchasable.md) — why placement and annotations are never for sale
- [ADR-0009](../adr/0009-a-model-assembles-the-facts-a-person-writes-the-judgement.md) — why the judgement is never generated, and how that is enforced rather than requested
- `CONTEXT.md` §2 — why the Annotation is the product
- `CONTEXT.md` §6 — the copyright constraint the short-field caps enforce
