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

## Notes

- Prisma is pinned to 6.x for stability; bump to 7.x later if desired.
- Postgres/Redis are mapped to **:5434 / :6380** to avoid colliding with any
  instances you already run on the default ports.
