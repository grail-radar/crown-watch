# Site-watch runbook

How to grow and look after Tier 4 — the watcher that reads brands' own stores
and turns changes into published drops and instant Telegram alerts.

Written for whoever is on the hook when a brand's watcher stops working. For
*why* the design is the way it is, see
[ADR-0001](../adr/0001-tier-4-signals-publish-without-moderation.md) and
[ADR-0002](../adr/0002-broadcasts-are-at-most-once.md).

---

## What must be set for alerts to actually send

Dispatch degrades quietly by design: with these missing, polling still succeeds
and drops still publish to the site — only the Telegram post is skipped, with a
warning in the log.

| Variable | Needed for | Missing means |
|---|---|---|
| `DATABASE_URL` | everything | nothing runs |
| `ADMIN_TOKEN` | triggering a poll over HTTP | the endpoint returns 503 |
| `TELEGRAM_BOT_TOKEN` | any alert | `dispatch skipped`, drops still publish |
| `TELEGRAM_CHANNEL_UA` | the Ukrainian channel | that channel is silently absent |
| `TELEGRAM_CHANNEL_EN` | the English channel | that channel is silently absent |
| `TELEGRAM_GROUPS` | partner communities carrying the feed | no group post; a *malformed* entry fails the boot |
| `PUBLIC_WEB_URL` | the "Brand on Crown Watch" link | links point at the default domain |

> The Ukrainian variable is `TELEGRAM_CHANNEL_UA`. `TELEGRAM_CHANNEL_UK` is also
> accepted for compatibility, but `UK` reads as United Kingdom — prefer `UA`.

> `TELEGRAM_GROUPS` is the one Telegram setting that refuses to degrade quietly.
> See the [Telegram destinations runbook](./telegram-destinations.md) for adding
> a partner group and for checking what the bot may actually post.

Check what a running API actually sees:

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll" -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

If `totalBroadcastsSent` is 0 while `totalDropsCreated` is not, the credentials
are the first thing to check.

---

## Adding a new watched brand

A brand is a database row. No code change is needed for either adapter.

### 1. Find the best endpoint

Probe the candidates. This sorts a list of brands by what each one needs, and
goes through the same user agent and `robots.txt` guard as a real poll:

```bash
pnpm --filter @crown-watch/api probe:stores -- yema.com baltic-watches.com
```

`--file=brands.txt` reads one domain per line (`#` comments allowed), which is
how you sort thirty brands in one go. It only reads — nothing is registered.

Results are grouped by what to do next:

| Group | Meaning |
|---|---|
| **Register with the structured adapter** | A real feed with products in it. Ready as-is. |
| **Needs HTML selectors** | No product endpoint. Write selectors against the listing page. |
| **Probe again later** | The store rate-limited us. It may still have a feed — do *not* write selectors yet. |
| **Off limits** | `robots.txt` disallows the path. Respect it. |
| **No answer** | Unreachable, or blocking us outright. |

The probe never trusts a status code alone: a store answering `200` with a
lander page instead of a feed is reported as needing selectors, because only
parsing it tells you the difference. One brand on the roster does exactly this.

### 2. Choose the adapter

| | `shopify_products_json` | `html_selectors` |
|---|---|---|
| **Use when** | `/products.json` returns products | the store is ordinary HTML |
| **Availability** | per variant, exact | inferred from the page |
| **Breaks when** | the platform changes its API (rare) | the store is redesigned (common) |
| **Config** | none | `selectors` |
| **Price currency** | never labelled — the feed omits it | read from the page on every fetch |

Prefer the structured one whenever it is available. The HTML adapter is for the
brands that leave you no choice — and it will need revisiting after a redesign.

The currency row is the one reason to prefer the HTML adapter for a store that
offers both: a feed price goes out as a bare number. See
[Prices, and why some of them have no currency](#prices-and-why-some-of-them-have-no-currency).

### 3. Insert the source

```sql
-- Structured feed
INSERT INTO sources (id, type, name, brand_id, endpoint, watch_config, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, 'site_watch', 'The Brand — store',
  '<brand_id>', 'https://thebrand.example/products.json?limit=250',
  '{"adapter":"shopify_products_json"}'::jsonb,
  now(), now()
);
```

```sql
-- Ordinary HTML listing page
INSERT INTO sources (id, type, name, brand_id, endpoint, watch_config, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, 'site_watch', 'The Brand — store',
  '<brand_id>', 'https://thebrand.example/collections/all',
  '{"adapter":"html_selectors","selectors":{
      "item":".product-card",
      "link":".product-card__link",
      "title":".product-card__title",
      "price":".price",
      "image":".product-card__image",
      "soldOut":".badge--sold-out"
  }}'::jsonb,
  now(), now()
);
```

`brand_id` must be set — a store belongs to exactly one brand, and a source
without one fails the poll with a clear error rather than guessing.

**Selector notes.** Only `item` is required. Without `link` the first `<a>`
inside each item is used; without `title` the link text is. For availability,
`soldOut` (a CSS selector) or `soldOutText` (a phrase such as `"Sold out"`) mark
a product as unavailable; `inStock` marks the positive case and wins over both.
A store expressing none is treated as selling everything — see
[the adapter](../../apps/api/src/site-watch/adapters.ts).

### 4. Verify the silent baseline

The first poll of a new source must record a snapshot and create **no drops**,
even though the store already lists dozens of products. This is the check that
proves you configured it correctly *and* that you have not just spammed both
channels with a brand's entire back catalogue.

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll?sourceId=<source_id>" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq '{status, baseline, productCount, dropsCreated, broadcastsSent, error}'
```

Expect:

```json
{ "status": "ok", "baseline": true, "productCount": 34, "dropsCreated": 0, "broadcastsSent": 0, "error": null }
```

- `productCount` of 0 → `status` is `error`; the selectors match nothing. An
  empty catalogue is never accepted as truth.
- `productCount` far below what the page shows → your `item` selector is too
  narrow, or the store paginates and the endpoint needs a higher limit.
- `dropsCreated` above 0 on a first poll → the source already had a snapshot;
  it is not new.

Poll a second time without changing anything: `changed` must be `false`.

---

## Checking source health

Health is on the source row, so an operator never has to read logs:

```sql
SELECT name, health_status, consecutive_failures, last_polled_at, next_attempt_at, left(last_error, 120) AS last_error
FROM sources
WHERE type = 'site_watch'
ORDER BY health_status DESC, consecutive_failures DESC;
```

| `health_status` | Meaning | Do |
|---|---|---|
| `healthy` | last poll succeeded | nothing |
| `degraded` | 1–2 failures in a row | wait — usually transient |
| `error` | 3+ failures in a row | investigate; read `last_error` |
| `held` | a poll found too much to announce and published nothing | see [Held sources](#a-held-source-a-poll-that-refused-to-publish) — only a human clears this |
| `unknown` | never polled | run a baseline poll |

`next_attempt_at` in the future means the source is deliberately being left
alone. It is **not** stuck: backoff doubles from 15 minutes to a one-day cap,
and a single success clears the counter, the window and the error.

### Common failures

| `last_error` | Cause | Fix |
|---|---|---|
| `Adapter produced no products` | store redesign broke the selectors | re-derive selectors, update `watch_config`, force a poll |
| `Store responded 404` | the endpoint moved | update `sources.endpoint` |
| `Store responded 429 (rate limited)` | we polled too hard | nothing — backoff already honours their `Retry-After` |
| `disallowed by robots.txt` (as `skipped`) | the brand asks crawlers off that path | respect it; find a permitted page or drop the brand |
| `Unknown adapter` | typo in `watch_config.adapter` | fix the JSON |
| `has no brand attached` | `brand_id` is null | set it |

After fixing a source, retry immediately instead of waiting out a window the
broken configuration earned:

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll?sourceId=<source_id>&force=true" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq .
```

`force` applies to one source and ignores only the backoff window. It does not
bypass robots.txt, and it does not let an alert be sent twice. It is **not** the
lever for a held source — see the next section.

---

## A held source: a poll that refused to publish

`health_status = 'held'` means the store answered, the adapter parsed it, and the
poll then **refused to announce what it found**. Nothing was published: no Drops,
no Telegram posts, no Watches, and no snapshot. Above
`SITE_WATCH_MAX_CHANGES_PER_POLL` changes in one poll (default 10), the poll
stops rather than tells both Channels, because a Channel cannot unsend and no
legitimate hour at one microbrand produces eleven Drops. The reasoning is
[ADR-0005](../adr/0005-an-implausible-poll-is-refused-not-published.md).

A held source is **not** broken and **not** backing off, so `force` does nothing
for it. It keeps being polled hourly and keeps refusing — including when the
store loses a few products and the diff falls back under the threshold, so the
flood cannot walk through in instalments. Three things end a hold: releasing it
(3a), re-baselining it (3b), or the store returning to exactly the catalogue we
already hold, which publishes nothing by definition and so needs nobody's
ruling.

While it is held, a genuine Drop at that store is held too. That is the point,
but it does mean a hold is worth clearing the same day.

### 1. See what it is holding

Poll that one source again. The previous snapshot was never overwritten, so the
poll re-derives its list from the live store rather than from anything stored:

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll?sourceId=<source_id>" -H "x-admin-token: $ADMIN_TOKEN" | jq '{status, refusedReason, productCount, changes}'
```

`changes` is what that poll would have announced, with `broadcasts: 0` on every
entry because none of it went anywhere. It reflects the store **as of that
request** — if the shop is mid-change, two polls minutes apart can differ.

### 2. Decide which it is

| What `changes` looks like | What happened | Do |
|---|---|---|
| the brand's whole catalogue, including Watches that have been listed for months | the stored snapshot was lost or overwritten | find out how, then re-baseline (below) |
| every product, with URLs in a shape you do not recognise | the store was redesigned or the endpoint moved | fix `endpoint` / `watch_config`, then re-baseline |
| a plausible collection launch, and the store's own page agrees | a genuinely large launch | release it |
| products that are not watches — straps, buckles, cases | the endpoint lists the whole shop | narrow the endpoint or selectors |

**Open the store in a browser before deciding.** The whole point of the hold is
that the data cannot be trusted to answer this question about itself.

### 3a. Release it, if it is real

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll?sourceId=<source_id>&release=true" -H "x-admin-token: $ADMIN_TOKEN" | jq '{status, dropsCreated, broadcastsSent}'
```

This publishes that poll in full and posts every Drop to both Channels — the
thing that cannot be undone. It applies to one poll of one source; the next poll
is guarded again, and `release=true` without a `sourceId` is rejected rather than
ignored.

> **Release polls the store afresh — it does not replay what you inspected.**
> Check `dropsCreated` against the number you reviewed. If they differ, the shop
> changed underneath you, and what went out is not quite what you approved.

### 3b. Re-baseline it, if it is not

When the flood is an artefact, what the source needs is a fresh silent baseline
rather than a release. Delete the stale snapshot and poll:

```sql
DELETE FROM raw_ingestion_events WHERE source_id = '<source_id>';
```

The next poll has nothing to diff against, so it records a baseline and
announces nothing — the same silent first poll a newly registered store gets,
which also clears the hold. Check `baseline: true` and `dropsCreated: 0` in the
response.

> Deleting the events for a source that has published Drops sets those Drops'
> `source_event_id` to null; the Drops themselves survive. Retracting Drops is a
> separate operation — see below.

If a brand does this routinely, raise `SITE_WATCH_MAX_CHANGES_PER_POLL` instead
of releasing it by hand every time. Do not raise it merely to onboard a large
catalogue: a first poll announces nothing however many products it finds.

---

## The schedule, and what to expect from it

Two triggers, deliberately:

- **`.github/workflows/site-watch-poll.yml`** — hourly at seven past. Also wakes
  the API, which free hosting puts to sleep when idle.
- **The API's own cron** (`SITE_WATCH_POLL_CRON`, hourly at five past) — runs
  only while the service is awake.

Running both is safe. Every alert is claimed per `(drop, channel)` before it is
sent, so an overlapping or repeated run cannot post the same drop twice
(ADR-0002). A poll that finds nothing changed writes nothing at all.

**Stores are polled one at a time, with a pause between them**
(`SITE_WATCH_POLL_DELAY_MS`, 2s). Several brands often sit behind one platform
edge, and a back-to-back run reads to that edge as a single impatient crawler —
four freshly registered stores once answered 429 together for exactly this
reason. A source that is skipped costs no pause, since it made no request.

**Scheduled runs are best-effort.** GitHub Actions delays cron jobs under load
and can skip them entirely; delays of five to fifteen minutes are normal, and
longer happens. Combined with a cold start of up to a minute, a drop detected
"hourly" may reach the channels twenty minutes after the store changed. That is
accepted on free hosting and stated here rather than hidden.

Nothing about this is host-specific — moving to always-on hosting is a
configuration change (tighten `SITE_WATCH_POLL_CRON`, drop the workflow), not a
rewrite.

### Seeing what a run did

The workflow writes a table to its job summary: per source, what changed, how
many drops were created and how many alerts went out. Open the run in the
**Actions** tab.

A run is green when the *run* succeeded, even if individual stores failed —
one brand's broken selector must not blind the rest. Per-source failures are
itemised in that table and on the source row. A red run means something
broader broke: the API was unreachable, or the secrets are missing.

A transient failure needs no intervention. The next run polls from scratch, and
a source that failed is retried once its backoff window expires.

---

## Prices, and why some of them have no currency

**A price is labelled only when the store said so on that fetch.** Where the
store did not say, the number goes out bare — on the site and in the Channels.
That is deliberate: a bare number beats a wrong one.

### Why

`watch_config.currency` used to carry the answer: a label an operator typed when
the source was registered. YEMA serves at least two market price lists — the
observed pairs 349/390, 39/47 and 49/59 have different ratios, so they are
separate lists rather than one converted — which means the number changed
between polls while the label never did. Roughly half of YEMA's polls announced
a euro figure labelled `USD`, and one of them reached both Channels on
2026-08-06 as *"Price: 2190 USD"*. Nobody can now say which list that came from,
and a Channel cannot unsend ([ADR-0002](../adr/0002-broadcasts-are-at-most-once.md)).

So the field is gone. `watch_config.currency` on an existing source row is read
and discarded.

### What each adapter can tell you

| Adapter | Currency | Why |
|---|---|---|
| `html_selectors` | read from the price text on every fetch | The page prints `€ 640.00`, and the number and its symbol come from the same string — a store switching market lists switches both together. |
| `shopify_products_json` | **never** | The feed returns bare numbers and no currency at all. Which list they came from depends on how the storefront resolved the request, so any label would be a guess. |

Symbols only one currency uses are read (`€` `£` `zł` `₴`), as are spelled-out
ISO codes (`2190 EUR`, `CHF 1 890`). Shared symbols are refused: `$` is six
currencies, `¥` is two, `kr` is three. A dual-priced listing — `€640 / $700` —
is refused too, since there is no way to choose. The full case table is
`apps/api/src/site-watch/currency.spec.ts`.

### What this costs

A Shopify store that only ever serves one market loses a label it could have
had. That is the accepted price of not being able to tell it apart from YEMA
from the outside.

### If you want a label back for a specific store

Point the source at an HTML listing page that prints the symbol and register it
with `html_selectors`. That is the supported route, and it is honest: the label
then comes from the same bytes as the number.

### Fixing the labels already published

Drops created before this carry whatever the registration label said. Re-derive
them from what their Watch's Variants now evidence:

```bash
pnpm --filter @crown-watch/api relabel:drop-currency
```

```bash
pnpm --filter @crown-watch/api relabel:drop-currency -- --confirm
```

**Run it after every store has been polled once**, not before. The answer comes
from each Watch's Variants, and those only carry what the store printed once a
poll has rewritten them — running it early would clear labels the next poll
would have confirmed.

It is evidence rather than a wipe: a Watch whose priced Variants agree keeps its
label (Baltic prints `€ 640.00`, so its Drops stay `EUR`), and one whose
Variants no longer say anything is cleared. Drops about no Watch are skipped
entirely — an RSS-extracted Drop's currency came out of a publication's prose,
not from the label this replaced. Prices, publication state and broadcast rows
are untouched.

> The Channel messages already sent keep their wrong labels. A Channel cannot
> unsend, and Telegram only permits deleting a post for 48 hours
> ([telegram-destinations](./telegram-destinations.md)). Those are permanent;
> this fixes the site and everything sent from here on.

### Rejected alternatives

- **Keep the config label, and only trust it for stores "known" to serve one
  market.** The knowing is the problem. Nothing verifies it, it decays silently
  as stores add markets, and the failure is a wrong number in a Channel.
- **Pin the request to one market** (a country parameter, a market-scoped path,
  a forced locale). Storefront-specific, undocumented for `products.json`, and
  it would still be an assumption rather than something the response confirms.
  Worth revisiting per store if a brand ever documents it.
- **Convert everything to one display currency.** Requires an FX feed and a
  rate as of the fetch, and would print a number no shop will actually charge.
- **Guess from the brand's country.** A French brand selling to the US in
  dollars is the common case, not the exception.

---

## When the watcher calls a strap a watch, or a watch a strap

A brand's feed returns the whole shop. Every product is classified as a **watch**
or an **accessory**, the answer is stored on `watches.kind`, and only a watch
raises a Drop ([ADR-0006](../adr/0006-accessories-are-classified-not-excluded.md)).

The rule is a short list of cases over the title. It will be wrong sometimes,
and it leans deliberately toward calling things watches: an accessory announced
is one stray message, a watch silenced is a release nobody knows is missing.

### See what a brand is selling, by kind

```sql
SELECT kind, count(*) FROM watches WHERE brand_id = '<brand_id>' GROUP BY kind;
```

```sql
SELECT name, kind, kind_override
FROM watches
WHERE brand_id = '<brand_id>' AND kind = 'accessory'
ORDER BY name;
```

You do not need to poll to find this out — that is why the column is stored.

### Correct one

Set `kind_override`. The rule is not consulted again for that Watch, and the
next poll applies it — including on a store that has not changed. The one
exception is a [held source](#a-held-source-a-poll-that-refused-to-publish),
which stops before it rebuilds the catalogue: release or re-baseline it first,
and the override lands with the poll that follows.

```sql
UPDATE watches SET kind_override = 'accessory' WHERE id = '<watch_id>';
```

```sql
UPDATE watches SET kind_override = 'watch' WHERE id = '<watch_id>';
```

To hand it back to the rule, clear the override:

```sql
UPDATE watches SET kind_override = NULL WHERE id = '<watch_id>';
```

`kind` is rewritten by every poll; `kind_override` is never written by anything
but you.

### Classify the Watches recorded before kinds existed

Everything older defaults to `watch`. Dry run first:

```bash
pnpm --filter @crown-watch/api backfill:watch-kinds
```

```bash
pnpm --filter @crown-watch/api backfill:watch-kinds -- --confirm
```

It skips any Watch carrying a `kind_override`, and it prints the reclassified
accessories with how many Drops each already has — those are the messages that
should never have gone out.

### Find the accessory Drops already on the feed

```sql
SELECT d.id, b.name, d.title, d.published_at
FROM drops d
JOIN watches w ON w.id = d.watch_id
JOIN brands b  ON b.id = d.brand_id
WHERE w.kind = 'accessory' AND d.published_at IS NOT NULL
ORDER BY d.published_at DESC;
```

This change is prospective — it does not retract anything. Taking those off the
feed is [a deliberate operator action](#taking-drops-off-the-feed-that-should-never-have-been-announced),
and it needs `backfill:drop-watches` to have run, since a Drop with a null
`watch_id` cannot be found this way.

---

## Correcting a wrong grouping

The rule that decides which store products are the same **Watch** is brand plus
a normalised title, and it is deliberately simple
([ADR-0003](../adr/0003-watch-identity-is-normalised-titles.md)). It will be
wrong sometimes. When it is, you fix it by inserting a row — **no deploy, no
restart**. The next poll picks it up.

That cheapness is not a convenience, it is the condition the simple rule was
accepted under. If corrections needed a release, the honest choice would have
been the expensive rule the project rejected.

### What wrong looks like

| Symptom | The rule did | You want |
|---|---|---|
| One model announced twice within a second | split | a merge |
| A brand page listing the same watch twice | split | a merge |
| Two genuinely different models sharing one page | merged | a split |
| A limited edition folded into the standard model | merged | a split |

The usual cause of a wrong split is a store that appends a reference to some
products and not their siblings. The usual cause of a wrong merge is two models
a store happens to title identically.

### Look at the grouping first

```sql
SELECT w.name, w.key, count(v.id) AS variants, min(v.product_url) AS example
FROM watches w
LEFT JOIN watch_variants v ON v.watch_id = w.id
WHERE w.brand_id = '<brand_id>'
GROUP BY w.id ORDER BY variants DESC, w.name;
```

A Watch with one variant next to a near-identical Watch with one variant is a
wrong split. A Watch with variants whose product URLs read like different models
is a wrong merge.

### Force a merge

Point the stray product at the key of the Watch it belongs to. Copy that key
from `watches.key` rather than typing it — it is `<brand-slug>:<lowercased
name>`, and a near-miss silently creates a third Watch instead.

```sql
INSERT INTO watch_grouping_overrides (id, brand_id, product_url, watch_key, note, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, '<brand_id>',
  'https://thebrand.example/products/superman-u7',
  'yema:superman bronze',
  'Store appends the reference to the U7 bracelet only',
  now(), now()
);
```

### Force a split

Give the product a key nothing else uses, and a name — without one it inherits
whatever the rule derived, which is the name it is being separated from.

```sql
INSERT INTO watch_grouping_overrides (id, brand_id, product_url, watch_key, watch_name, note, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, '<brand_id>',
  'https://thebrand.example/products/aquascaphe-limited',
  'baltic:aquascaphe limited',
  'Aquascaphe Limited Edition',
  'A separate model, not a dial option',
  now(), now()
);
```

### Then poll, and check

```bash
curl -fsS -X POST "$API_BASE_URL/ingestion/site-watch/poll?sourceId=<source_id>&force=true" -H "x-admin-token: $ADMIN_TOKEN" | jq '{groupingOverridesApplied, groupingOverridesUnmatched, watchesRecorded}'
```

`groupingOverridesApplied` counts the rows that re-homed a product. A zero when
you expected one means the `product_url` does not match the store exactly.

**Undoing is deleting the row.** The next poll re-groups those products by the
rule, and no trace of the override is kept.

> **The Watch rows themselves are not undone.** A forced split creates a second
> Watch; deleting the override moves its products back but leaves that Watch
> behind, empty, at a URL somebody may already hold. The same is true of any
> Watch an override empties. Tidy them by hand once you are sure:
>
> ```sql
> DELETE FROM watches w
> WHERE w.brand_id = '<brand_id>'
>   AND NOT EXISTS (SELECT 1 FROM watch_variants v WHERE v.watch_id = w.id);
> ```
>
> Drops that pointed at a deleted Watch keep their rows and lose their
> `watch_id` — nothing is announced again, and no broadcast record is touched.

### Overrides that have stopped doing anything

A store that delists a product, or changes its URL, leaves the override matching
nothing. It is harmless — nothing is regrouped — but it is not silent: the poll
reports it in `groupingOverridesUnmatched` and logs a warning.

```sql
SELECT product_url, watch_key, note, created_at, last_matched_at
FROM watch_grouping_overrides
WHERE last_matched_at IS NULL OR last_matched_at < now() - interval '7 days'
ORDER BY created_at;
```

`last_matched_at` is stamped on every poll the override actually applies to. A
null one has never matched — usually a typo in the URL. One that stopped days
ago means the store moved on. Delete either once you have confirmed it.

---

## Giving old Drops the Watch they are about

A Drop records which **Watch** it is an event about, so one release is one alert
however many references a store lists
([ADR-0003](../adr/0003-watch-identity-is-normalised-titles.md)). Drops that
predate Watches, and any created while a store's products were not yet indexed,
carry a null `watch_id` until this is run.

Dry run first — it changes nothing and prints what it would assign:

```bash
pnpm --filter @crown-watch/api backfill:drop-watches
```

```bash
pnpm --filter @crown-watch/api backfill:drop-watches -- --confirm
```

It matches a Drop's `source_url` to a Variant's `product_url` and nothing else.
A title is never used to guess: a wrong `watch_id` puts an announcement on some
other model's page, silently.

**It assigns; it never merges and never deletes.** The three YEMA Drops from
6 August stay three rows sharing one `watch_id` — collapsing them would cascade
the `drop_broadcasts` rows that are the only evidence those messages were sent.
The script re-counts those rows before and after and fails loudly if the number
moved.

Left with a null `watch_id`, as expected rather than as a failure:

- Drops read out of a publication's RSS — they name a watch in prose and have no
  store product to match
- Drops whose store product has since been delisted

Read the per-Watch counts in the output. A Watch claiming dozens of Drops is a
grouping that has gone wrong, not a busy model — see
[Correcting a wrong grouping](#correcting-a-wrong-grouping).

---

## Taking drops off the feed that should never have been announced

When a poll publishes something it should not have, the fix is to **retract**,
never to delete.

Deleting a drop cascades its `drop_broadcasts` rows, and those rows are the only
record that a message was sent. Destroying them removes the evidence that makes
"at most once, ever" true ([ADR-0002](../adr/0002-broadcasts-are-at-most-once.md))
— and a drop recreated later would then be a backfill candidate all over again.
Retraction unpublishes instead: the drop leaves the feed, leaves the API, and
stops being a backfill candidate, while every broadcast row survives.

Dry run first — it changes nothing and prints what it would touch:

```bash
pnpm --filter @crown-watch/api retract:drops -- --from=<ISO> --to=<ISO>
```

```bash
pnpm --filter @crown-watch/api retract:drops -- --from=<ISO> --to=<ISO> --confirm
```

It refuses a backwards window, and refuses a window matching **no** drops rather
than reporting a cheerful zero — a mistyped timestamp is far likelier than a
genuinely empty window. After applying, it re-counts the broadcast rows and
fails loudly if any went missing.

The script prints which database host it is about to change. Read that line.

### The 2026-08-07 incident

The window used, recorded so the same set can be re-derived and audited:

```
--from=2026-08-07T12:31:00Z --to=2026-08-07T13:39:00Z
```

372 drops, all `pre_order`, from exactly four store hosts — `yema.com` (182),
`cronusartwatches.com` (129), `serica-watches.com` (49), `haimwatchco.com` (12).
No RSS-sourced drop falls inside it, and the three genuine YEMA store drops from
6 August sit safely outside, as do both Baltic restocks from 4 August.

Cause: a test run against production overwrote four stores' stored snapshots with
fixture data; the next scheduled poll read every real product as new.

Two guards came out of it, deliberately at different levels:

- **That cause** cannot recur: the suite refuses a non-local `DATABASE_URL`
  before a single spec loads. See the [README](../../README.md#tests).
- **That shape** cannot recur whatever causes it: a poll finding more than
  `SITE_WATCH_MAX_CHANGES_PER_POLL` changes at one store publishes nothing and
  holds the source. All four stores would have hit it — the smallest announced
  twelve. See [Held sources](#a-held-source-a-poll-that-refused-to-publish).

---

## Related

- [ADR-0001](../adr/0001-tier-4-signals-publish-without-moderation.md) — why Tier 4 drops publish without moderation
- [ADR-0002](../adr/0002-broadcasts-are-at-most-once.md) — why an alert is never sent twice, and never retried
- [ADR-0003](../adr/0003-watch-identity-is-normalised-titles.md) — how products become Watches, and why the override table is load-bearing
- [ADR-0005](../adr/0005-an-implausible-poll-is-refused-not-published.md) — why an implausible poll is refused, and why its snapshot is not kept
- [ADR-0006](../adr/0006-accessories-are-classified-not-excluded.md) — why a strap is recorded but never announced
- [README](../../README.md#telegram-drop-broadcast-contextmd-2) — channel setup and backfilling

---

## Brands discovered by extraction

Extraction creates a brand from whatever an article happened to mention, which is
often just a name. **A brand with no website shows no purchase link at all** — on
the site or in the channels — so the gap is filled automatically: the `rss-poll`
workflow runs the enrichment pass in the same run that discovers the brand.

The pass converges rather than grinding. Most brands will never have all three
details — an obscure microbrand often has no published founding year — so "still
incomplete" is not a usable work queue. Each brand is asked about at most three
times; after that it stays incomplete and is counted as `exhausted` rather than
re-billed for the same silence every twenty minutes. A missing website is always
taken before a missing founding year, because only one of them costs a reader
anything.

Where it stands:

```sql
SELECT
  count(*) FILTER (WHERE website IS NULL) AS no_website,
  count(*) FILTER (WHERE website IS NULL AND enrichment_attempts >= 3) AS given_up_on,
  count(*) FILTER (WHERE country IS NULL OR founded_year_est IS NULL) AS partial
FROM brands;
```

`given_up_on` above zero is not a fault — those are brands nobody has written
down. Fill them by hand if they matter; the pass will not ask again. A wrong URL
sits behind a link labelled with that brand's name, so leaving a gap is the
correct outcome rather than accepting a plausible guess.

To make the pass retry one brand, reset its counter:

```sql
UPDATE brands SET enrichment_attempts = 0 WHERE slug = '<slug>';
```

---

## Worked example: registering a selector-based store

Baltic is the reference case for `html_selectors`. Its shop is Shopify Hydrogen
— the same `/products/…` and `/collections/…` URL shapes as a classic Shopify
store, but headless, so `products.json` 404s and there is no structured feed to
fall back on.

**Endpoint:** `https://baltic-watches.com/en/collections/watches`

```json
{
  "adapter": "html_selectors",
  "selectors": {
    "item": "a[href*=\"/products/\"]",
    "title": "p.uppercase",
    "price": "p.mt-auto",
    "soldOutText": "Out of stock"
  }
}
```

Why these, and what they cost to get right:

- **`item` is the anchor itself.** The page is built from utility classes, so
  there is no meaningful wrapper class to hang a selector on. The product URL
  shape is the stable thing, and the adapter treats an `<a>` item as its own
  link. The `?variant=…` decoration on some hrefs is stripped automatically, so
  one watch stays one product across polls.
- **`title` and `price` are told apart by their only distinguishing classes.**
  Both are `<p>`; only the title carries `uppercase`, only the price carries
  `mt-auto`. Fragile against a redesign — which is the standing trade-off of
  this adapter, and why a redesign shows up as `Adapter produced no products`
  rather than as silence.
- **The `price` selector now carries the currency too.** Baltic prints
  `€ 640.00`, so the symbol arrives in the same string as the number and the
  Drop is labelled `EUR`. A selector that captured only the digits would strip
  the label and publish a bare number — worth checking when you write one.
- **`soldOutText` is "Out of stock", not "Sold out".** This one matters more
  than it looks. The first attempt used "Sold out", the phrase most stores use;
  it matched nothing, and three genuinely sold-out watches were recorded as
  available. Nothing would have looked wrong — until those watches came back and
  produced **no restock alert**, because there was no false→true transition to
  detect. Getting this wrong silently loses the thing Tier 4 exists for.

### Verify the selectors before registering, not after

Fetch the page and run the adapter over the saved HTML. What you are checking:

- every product parsed has a title, a price and a `/products/` URL
- the count is close to what the page claims
- the number reported unavailable matches what the page actually shows
- **fetching two or three times produces an identical snapshot hash**

That last check is the one worth the effort. If the markup renders
non-deterministically — a lazy-loaded row, a shuffled grid — products appear and
vanish between polls, and every appearance is a new-release alert to both
channels. Baltic returned an identical hash across three fetches and zero
would-be alerts, which is what made it safe to register.

For the record, its first real poll behaved: 59 products, a silent baseline, no
drops; a second poll immediately after reported unchanged.
