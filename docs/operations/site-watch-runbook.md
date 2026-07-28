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

Try the structured feed first — it is strictly better where it exists:

```bash
curl -fsS "https://thebrand.example/products.json?limit=250" | jq '.products | length'
```

A number back means the brand is on a platform with a machine-readable product
list. Nothing usable means you need the HTML adapter.

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
