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
| `PUBLIC_WEB_URL` | the "Brand on Crown Watch" link | links point at the default domain |

> The Ukrainian variable is `TELEGRAM_CHANNEL_UA`. `TELEGRAM_CHANNEL_UK` is also
> accepted for compatibility, but `UK` reads as United Kingdom — prefer `UA`.

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
| **Config** | `currency` | `currency` + `selectors` |

Prefer the structured one whenever it is available. The HTML adapter is for the
brands that leave you no choice — and it will need revisiting after a redesign.

### 3. Insert the source

```sql
-- Structured feed
INSERT INTO sources (id, type, name, brand_id, endpoint, watch_config, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, 'site_watch', 'The Brand — store',
  '<brand_id>', 'https://thebrand.example/products.json?limit=250',
  '{"adapter":"shopify_products_json","currency":"EUR"}'::jsonb,
  now(), now()
);
```

```sql
-- Ordinary HTML listing page
INSERT INTO sources (id, type, name, brand_id, endpoint, watch_config, created_at, updated_at)
VALUES (
  gen_random_uuid()::text, 'site_watch', 'The Brand — store',
  '<brand_id>', 'https://thebrand.example/collections/all',
  '{"adapter":"html_selectors","currency":"EUR","selectors":{
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
bypass robots.txt, and it does not let an alert be sent twice.

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

## Related

- [ADR-0001](../adr/0001-tier-4-signals-publish-without-moderation.md) — why Tier 4 drops publish without moderation
- [ADR-0002](../adr/0002-broadcasts-are-at-most-once.md) — why an alert is never sent twice, and never retried
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
  "currency": "EUR",
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
