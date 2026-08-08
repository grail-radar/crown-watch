# Crown Watch

Microbrand watch drop & waitlist radar. See [CONTEXT.md](./CONTEXT.md) for the
full project brief.

This repository is an early scaffold. What exists today:

- A **Turborepo** monorepo (pnpm workspaces).
- **`@crown-watch/api`** — NestJS backend with the full Prisma data model
  (CONTEXT.md §5) and a working **Tier 1 RSS ingestion** pipeline.
- **`@crown-watch/web`** — Next.js (App Router) + Tailwind, placeholder landing
  page only.

## Layout

```
crown-watch/
├── apps/
│   ├── api/          @crown-watch/api  — NestJS + Prisma + RSS ingestion
│   └── web/          @crown-watch/web  — Next.js + Tailwind (placeholder)
├── docker-compose.yml   Postgres (:5434) + Redis (:6380) for local dev
├── turbo.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node ≥ 20 (tested on 22)
- pnpm 10
- Docker (for local Postgres/Redis) — or point `DATABASE_URL` at your own Postgres

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Start local infra (Postgres on :5434, Redis on :6380)
docker compose up -d

# 3. Configure env (already present at apps/api/.env; template in .env.example)

# 4. Create the schema + generate the Prisma client
pnpm db:migrate      # prisma migrate dev
pnpm db:generate     # prisma generate

# 5. Seed the 3 Tier 1 RSS test publications
pnpm db:seed

# 6. Run the RSS ingestion end-to-end
pnpm ingest:rss
```

## Tier 1 RSS ingestion (CONTEXT.md §4)

The ingestion pipeline polls watch-publication RSS feeds and lands raw items in
the `raw_ingestion_events` table (the "landing zone"). Nothing is published to a
public feed from here — per CONTEXT.md §5, extraction → moderation → publish are
downstream stages built later.

- **Sources** live in the `sources` table (`type = 'rss'`). Seeded with Worn &
  Wound, aBlogtoWatch, and Monochrome Watches.
- **Dedup**: each item gets a stable `content_hash`; the
  `(source_id, content_hash)` unique constraint makes re-polls idempotent.
- **Trigger it three ways**:
  - `pnpm ingest:rss` — one-shot CLI runner (used for verification).
  - `POST /ingestion/rss/poll` — manual trigger on the running API.
  - Scheduled cron (`RSS_POLL_CRON`, default every 15 min) when the API runs.

> The production polling/dispatch path is intended to move to Redis + BullMQ
> (CONTEXT.md §3); the cron scheduler here is the lightweight interim.

## LLM extraction (raw events → drops)

The extraction stage reads unprocessed `raw_ingestion_events` and calls the
Anthropic API (`claude-opus-4-8`) with structured tool-use to pull short factual
fields (brand, model, price, date, confidence). It:

- upserts a **brand** for each discovered microbrand (new-entrant discovery), and
- lands a candidate **drop** in the moderation queue (`moderation_status = pending`)
  only when the article is a real drop event (Kickstarter / waitlist / restock / pre-order).

Nothing is published — every drop waits for human moderation (CONTEXT.md §5).
Copyright-safe: only short factual fields are stored, never source prose.

- Set `ANTHROPIC_API_KEY` to enable it; without a key it no-ops cleanly.
- Run it: `pnpm extract`, or `POST /extraction/run` on the running API.
- The persistence path is covered (no API key needed) by
  `pnpm --filter @crown-watch/api extract:verify`.

## Tier 4 site-watch (CONTEXT.md §4)

Watches brands' **own stores** and turns structural changes into published drops.
Changes are read as events about a **Watch**, not about a store product: YEMA
lists one model as three references, and that is one release and one message per
channel, not three ([ADR-0003](./docs/adr/0003-watch-identity-is-normalised-titles.md)).
A Watch nothing was known of is a new release; a Watch with nothing buyable that
has something again is a restock. Price edits, copy tweaks, photo swaps, a watch
selling out and a new bracelet for last year's model all produce nothing.

Because no language model reads prose on this path, these drops publish
immediately rather than queueing for moderation
([ADR-0001](./docs/adr/0001-tier-4-signals-publish-without-moderation.md)).

A shop's feed also returns straps, buckles, gift cards and warranty products.
Those are classified and recorded in full, and they never raise a Drop — the
feed promises to tell you when a *watch* lands
([ADR-0006](./docs/adr/0006-accessories-are-classified-not-excluded.md)).

Two adapters, chosen per source as data:

- **`shopify_products_json`** — the store's structured product feed, with exact
  per-variant availability. Preferred wherever it exists.
- **`html_selectors`** — an ordinary HTML listing page read through configured
  CSS selectors, for the brands that expose no feed.

The watcher is a deliberate good citizen: it identifies itself honestly by user
agent, fetches and obeys each store's `robots.txt`, and backs off when a store
pushes back — doubling from 15 minutes to a one-day cap, honouring `Retry-After`.
One brand's broken selector never blinds the rest of a run; failures are
itemised per source, with health on the source row.

It also refuses to be the cause of a second flood. A poll that finds more than
`SITE_WATCH_MAX_CHANGES_PER_POLL` changes at one store publishes nothing at all
and holds that source for a human — no legitimate hour at one microbrand
produces eleven Drops, so a poll that says so has something wrong upstream of
it, and a channel cannot unsend
([ADR-0005](./docs/adr/0005-an-implausible-poll-is-refused-not-published.md)).

It runs unattended, hourly, via `.github/workflows/site-watch-poll.yml` (which
also wakes free-tier hosting) and the API's own cron. Running both is safe:
alerts are claimed per `(drop, channel)`, so overlapping runs cannot double-post.

> **Adding a brand, choosing an adapter, or fixing a broken watcher:**
> see the [site-watch runbook](./docs/operations/site-watch-runbook.md).

## Telegram drop broadcast (CONTEXT.md §2)

The moment a site-watch poll detects a drop, it is posted to two public Telegram
channels — one Ukrainian, one English. Both messages are built from the same
drop data by `src/alerts/messages.ts`; the languages differ only in their
template strings, so adding one is a translation, not per-post work.

Each message carries the brand, the model, whether it is a new release or a
restock, the price when the store exposed one, a direct link to the product
page, and a link to the brand's page on the site.

Set up:

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Add the bot to each channel as an admin with **Post messages** permission.
3. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_UA` and `TELEGRAM_CHANNEL_EN`.

Without a token — or with no channels configured — dispatch is skipped with a
warning and the poll still publishes drops normally, matching how extraction and
the digest sender degrade without their keys.

The feed can also be carried by a **partner community** — someone else's group,
posting into the one forum topic its admins agreed to. Set `TELEGRAM_GROUPS` to
comma-separated `locale:chatId[:topicId]` entries, e.g.
`uk:-1001234567890:42`; see the
[Telegram destinations runbook](./docs/operations/telegram-destinations.md) for
finding the ids and what to agree with the group's admins first.

Drops reach the channels from two places: the site-watch poll announces a drop
the moment it detects one, and approving a drop in the moderation queue announces
it at the moment a reviewer makes it public. Approvals are queued and paced, so
clearing a backlog does not lose alerts to Telegram's per-channel rate limit, and
a reviewer never waits on Telegram to approve.

**A drop reaches a given channel at most once, ever.** A `drop_broadcasts` row is
claimed before each send, so an overlapping poll, a re-run or a restart mid-run
cannot repeat a post. A send that fails is recorded and *not* retried — see
[ADR-0002](./docs/adr/0002-broadcasts-are-at-most-once.md) for why silence beats
a duplicate here, and how to force a re-broadcast if you need one.

### Backfilling a channel

Drops published on the site before broadcasting existed — or before a given
channel was wired up — can be posted after the fact:

```bash
pnpm --filter @crown-watch/api backfill:telegram
```

**It is a dry run by default**: it prints every message it would post, in each
language, and sends nothing. Read that output before going further, because a
channel cannot unsend and each message notifies every follower.

```bash
pnpm --filter @crown-watch/api backfill:telegram -- --confirm --limit=5
```

`--limit` defaults to 10 and is capped at 50 — run it repeatedly to work
through a backlog rather than posting one enormous burst. Sends are paced by
`TELEGRAM_BACKFILL_DELAY_MS` (3s) to stay under Telegram's per-channel rate
limit, and go oldest-first so the channel reads chronologically.

Candidates are picked **per channel**, so adding a third language backfills only
that channel. Backfill routes through the same `(drop_id, chat_id)` claim as the
live path, so it can never repeat a drop that has already been posted — a
partially-delivered drop is topped up on the channel that missed it, and a
failed send stays failed rather than being quietly retried.

The same thing is available to an admin over HTTP:
`POST /alerts/backfill?confirm=true&limit=5`.

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run all apps in dev (turbo) |
| `pnpm build` | Build all apps |
| `pnpm typecheck` | Typecheck all apps |
| `pnpm db:migrate` | `prisma migrate dev` (api) |
| `pnpm db:seed` | Seed RSS sources (api) |
| `pnpm ingest:rss` | Run one Tier 1 RSS poll (api) |
| `pnpm extract` | Run the LLM extraction stage (api) |
| `pnpm test` | Run the test suite |
| `pnpm --filter @crown-watch/api backfill:telegram` | Preview a Telegram backfill (dry run) |
| `pnpm --filter @crown-watch/api probe:stores -- <domains>` | Sort brands by which site-watch adapter they need |

## Tests

```bash
docker compose up -d          # tests need a database
pnpm db:migrate               # once, to create the schema
pnpm test
```

Two kinds of test live in the API: pure unit tests (dedup hashing, brand slugs,
article media parsing) that need nothing, and persistence tests that drive the
real Prisma write path against Postgres. They share one database, so they run on
a single worker and delete every row they create. CI runs the same suite against
a Postgres service container.

**The suite refuses to run against a non-local database.** Unless `DATABASE_URL`
resolves to `localhost`, `127.0.0.1` or `::1`, the run aborts before a single
test loads, naming the host it refused. The host is parsed, not pattern-matched,
so a password or database name that happens to contain "localhost" will not get
a remote database past it. This is not paranoia: the tests write,
delete, and overwrite site-watch snapshots, and a run against production once
caused 372 drops to be published to two public Telegram channels that cannot
unsend. The main checkout legitimately holds production credentials for Prisma
Studio and the Telegram tooling, so "don't point it at production" was never a
control that could be relied on.

## Notes

- Prisma is pinned to 6.x for stability; bump to 7.x later if desired.
- Postgres/Redis are mapped to **:5434 / :6380** to avoid colliding with any
  instances you already run on the default ports.
