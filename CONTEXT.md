# Crown Watch — Project Brief

**Project name:** Crown Watch
**Repo:** `crown-watch`
**Tagline concept:** Microbrand watch drop & waitlist radar

## 1. What this is

An aggregation platform for independent/microbrand watchmakers: new launches, Kickstarter
campaigns, waitlist openings, and restocks — all in one feed, instead of an enthusiast having
to follow dozens of individual brand newsletters and Instagram accounts.

**Who it's for:** primarily people discovering the microbrand scene — they want to learn which
brands exist and which are worth attention. Secondarily, enthusiasts already following brands
who don't want to miss a drop. One system serves both: curated judgement is the product, and
the drop radar is what keeps it current.

**Languages:** `en` and `uk`. Ukrainian exists because nothing serves that scene; it is a
locale, not a separate product. No shipping, customs or logistics data is carried — this
platform sells nothing physical.

**Why now:** the microbrand scene is large and growing, mostly funded via Kickstarter/Indiegogo,
but there's no dedicated aggregator — enthusiasts currently rely on scattered Instagram
follows, individual mailing lists, and forum threads. Generic waitlist SaaS (Waitlister,
Prefinery, GetWaitlist) exists but is not watch-specific and has no cross-brand directory.

## 2. Business model

- **Free tier:** public feed, brand directory, browsing. This drives SEO/organic growth —
  every brand and every **watch** gets its own indexable page. A drop is an *event*, so it is
  an entry on a watch page rather than a destination of its own: people search for
  "Baltic Aquascaphe MK2", never for "Baltic restock, August".
- **Paid tier ($5–12/mo):** personalized alerts (keyword/brand watchlists) pushed to email,
  Telegram, or Discord the moment a drop or restock goes live.
- **Affiliate only, never paid placement.** Where a brand runs an affiliate programme,
  purchase links carry the tag. Placement, ordering and annotations are **not purchasable** —
  the moment a brand can pay for what we say about it, every annotation on the site is
  worthless. This is a permanent no (ADR-0004).
- **Real differentiator:** curated brand judgement — one honest sentence per brand, including
  the unflattering ones. It cannot be scraped, and competitors' far larger databases do not
  have it. Pure aggregation is a weak reason to pay when brand newsletters are free and
  instant; the judgement is what turns a feed into a way to decide.

  *This section previously named a brand reliability/delivery-track-record score (how often a
  brand's promised ship dates slip). It is retired rather than deleted, so the next reader
  knows it was tried: `drops.promised_ship_date` is populated on 0 of 14 drops, because
  articles almost never state a ship date. Revisit if a real source of ship-date data appears.*

## 3. Tech stack

**Naming convention:** repo, npm packages, and domain should all use the `crown-watch` slug
(kebab-case). In a monorepo layout, internal packages are scoped as `@crown-watch/api` and
`@crown-watch/web`.

- **Frontend:** Next.js (App Router), Tailwind. SEO-friendly static/ISR pages per brand and
  per drop — this is the primary organic growth channel.
- **Backend:** NestJS — justified here specifically because of the number of integrations
  (Stripe, email provider, Telegram bot, Discord webhooks, scheduled ingestion jobs).
- **Database:** PostgreSQL + Prisma.
- **Queue/scheduling:** Redis + BullMQ for polling jobs and notification dispatch.
- **Search:** Meilisearch or Typesense (self-hosted) for the public feed/directory search.
- **Notifications:** Postmark or Resend (email), a Telegram bot library (e.g. grammY or
  node-telegram-bot-api), Discord webhooks.
- **Payments:** Stripe is the destination. Crypto-only in the interim — Ukrainian cards cannot
  open a Stripe account. Revisit once an EU card is available; `subscriptions.stripe_customer_id`
  stays in the model because that is where this is going.
- **Hosting:** Vercel (Next.js) + Railway or Fly.io (NestJS API, Postgres, Redis).

## 4. Data ingestion strategy — tiered by reliability, not one crawler

| Tier | Source | Method | Notes |
|---|---|---|---|
| 1 (primary) | Watch publication RSS (Hodinkee, Worn & Wound, Fratello, aBlogtoWatch, Monochrome) | `rss-parser` polling | Highest signal — these outlets already curate which new brands matter. This is the main "new entrant" discovery mechanism. |
| 2 | Kickstarter / Indiegogo, Watches category | Apify Kickstarter actor or a scraping API (ScrapingBee), scheduled | **No official Kickstarter API exists.** Any automation here is paid and can break without notice — budget for maintenance, don't treat as "set and forget." |
| 3 | Brand newsletters | Dedicated inbox + Postmark/Mailgun inbound-parse webhook → LLM extraction | Opt-in (you subscribed), so no scraping ToS risk. Bootstrapping means manually subscribing to ~200–500 brand newsletters over time. |
| 4 | Known brand websites (restock/waitlist pages) | Self-hosted changedetection.io watching specific CSS selectors, webhook on change | Free, open-source, handles the "restock alert" use case directly. |
| 5 | Community / manual | Submission form + your own periodic browsing of r/watches, r/microbrandwatches, Watchuseek | **Do not automate Reddit** — commercial API access requires approval and runs ~$12k/year; free tier is non-commercial only. Treat as manual research, not a system input. |

**Instagram is intentionally excluded from automated ingestion.** Meta's Graph API in 2026 has
no public hashtag search or discovery across arbitrary accounts (only ~30 hashtags/week against
your *own* linked business account). This is a real, accepted gap — don't burn engineering time
trying to route around it; rely on the other four tiers plus brand self-submission instead.

## 5. Data model

```
sources                — id, type (rss|newsletter|kickstarter|site_watch|manual),
                          brand_id (nullable), endpoint/identifier,
                          last_polled_at, health_status

raw_ingestion_events    — id, source_id, fetched_at, raw_payload (jsonb/text),
                          content_hash (dedup), processed (bool)
                          // never discard raw content — needed to reprocess as
                          // extraction prompts improve

brands                  — id, name, slug, website, instagram_handle, country,
                          founded_year_est, status (listed|curated),
                          annotation (nullable), annotated_at,
                          reliability_score (nullable, someday — see §2)
                          // `curated` means a human approved the annotation.
                          // Same gate as moderation_status on drops: judgement
                          // is the product, so nothing publishes unreviewed.

watches                 — id, brand_id, slug, name (normalised title),
                          first_seen_at
                          // The durable object: what people search for and land
                          // on. Spec columns (diameter, lug-to-lug, crystal,
                          // movement…) are deliberately deferred until someone
                          // actually filters.

watch_variants          — id, watch_id, product_url, reference, price, currency,
                          available, last_seen_at
                          // One buyable configuration. A facet of the watch,
                          // never an event — so three bracelet options are one
                          // watch and one alert, not three (ADR-0003).

drops                   — id, brand_id, watch_id, title,
                          type (kickstarter_launch|waitlist_open|restock|pre_order),
                          price_low, price_high, currency, event_date,
                          source_event_id → raw_ingestion_events,
                          confidence_score (from LLM extraction),
                          moderation_status (pending|approved|rejected),
                          published_at

moderation_queue        — view over drops WHERE moderation_status = 'pending',
                          reviewer_id, reviewed_at

users                   — standard auth fields, plan tier

watchlists              — user_id, brand_id (nullable), keyword (nullable), created_at

notification_channels   — user_id, type (email|telegram|discord), identifier, verified

notifications_log       — id, user_id, drop_id, channel, sent_at  // dedup guard

drop_broadcasts         — id, drop_id, chat_id, locale, status, message_id,
                          error, sent_at
                          // public Telegram channels (UA/EN) belong to no user,
                          // so they need their own guard: unique per
                          // (drop, chat) and claimed before sending, making a
                          // broadcast at-most-once (ADR-0002)

subscriptions           — user_id, stripe_customer_id, plan, status
```

**Pipeline flow:** raw fetch → `raw_ingestion_events` (landing zone) → LLM extraction via the
Anthropic API using structured tool-use output (skip LangChain/LlamaIndex — direct API call is
cheaper and easier to debug for one well-defined extraction task) → confidence score →
`moderation_queue` → human approval → published `drop` → matched against `watchlists` →
notification dispatch, deduplicated via `notifications_log`.

**No source writes directly to the public feed.** This is the most important architectural
rule — automated extraction will misread prices/dates/currency and occasionally hallucinate,
so nothing goes live without passing through moderation, at least until you have real
confidence in a given source's extraction accuracy.

## 6. Known risks / design constraints (do not relitigate these during build)

- **Kickstarter has no official API** — expect a fragile or paid integration, not a clean one.
- **Reddit is not viable to automate commercially** — approval-gated and ~$12k/year at the
  commercial tier. Manual browsing only.
- **Instagram has no usable public discovery API** — accepted gap, not a bug to fix.
- **LLM extraction will make mistakes** — moderation queue is mandatory, not a nice-to-have.
- **Cold start problem** — nobody submits brands until there's an audience. Mitigation: manually
  seed ~300–500 brands from existing published lists before launch (a weekend of reading, not
  automation).
- **Weak monetization if it's "just aggregation"** — brand newsletters are already free and
  instant, and a competitor (chronoscout.co) already tracks ~330 brands with restock alerts,
  sell-out speed and projected restock. Breadth and speed are therefore not available as a
  differentiator. Curated judgement is (§2); treat the annotation as the product, not polish.
- **Copyright** — extraction must output short factual fields (brand, model, price, date) in
  your own structure, never reproduce source marketing copy or article text.
- **Cost creep** — start entirely on free/self-hosted tiers (changedetection.io, RSS parsing,
  Postmark free tier, direct Claude API calls for extraction). Add a paid scraping service per
  source only once that specific source proves it needs one.

## 7. MVP scope (Phase 1)

1. Manually seeded brand directory (~100–300 brands to start).
2. RSS ingestion from 10–15 watch publications.
3. Public feed + individual brand/drop pages (SEO-first).
4. Email signup for a weekly digest.
5. Manual "submit a drop" form.
6. Basic Stripe subscription gating email-only keyword alerts.

**Explicitly out of scope for v1:** Kickstarter scraping, newsletter ingestion pipeline,
changedetection.io site watches, Telegram/Discord alerts, reliability scoring. Add these once
the core feed has real users and you know which sources actually matter to them.

## 8. Validate before/alongside building

- Landing page + email capture testing the core pitch.
- Post in 2–3 relevant communities (r/watches, a microbrand Discord, Watchuseek) and see if
  people actually leave an email for "tell me when Brand X restocks."
- Talk to ~20 target users before investing in Tier 2–5 ingestion.

## 9. Language

The words this project uses, and the ones it deliberately doesn't. When output names a domain
concept — an issue title, a test name, a column, a UI label — use the term as defined here.

**Brand**:
An independent watchmaker we track. Carries the Annotation.
_Avoid_: maker, manufacturer, label.

**Watch**:
One model from a Brand — the durable thing a person searches for and lands on. Owns its
Variants and, one day, its specs.
_Avoid_: product, model, reference, SKU.

**Variant**:
One buyable configuration of a Watch: a bracelet option, a dial colour sold as its own store
product. A facet of the Watch, never an event of its own.
_Avoid_: SKU, option, version.

**Drop**:
One event about a Watch — it launched, restocked, opened a waitlist, went live on Kickstarter.
An entry on a watch page, never a page of its own.
_Avoid_: release, listing, post.

**Annotation**:
The one-sentence human judgement about a Brand, including the unflattering ones. The
differentiator, and never purchasable (ADR-0004).
_Avoid_: description, bio, summary, blurb.

**Curated**:
A Brand whose Annotation a human has approved. The other state is **Listed** — present and
honest about being unreviewed.
_Avoid_: verified, approved, featured.

**Watchlist**:
A *user's* list of Brands or keywords they follow. Never a state a Brand is in — that is
Listed or Curated.
_Avoid_: using this word for anything on the Brand side.

**Channel**:
Somewhere a Drop is announced and claimed against, at most once (ADR-0002). Covers both a
Telegram channel we own and one forum topic of a partner community.
_Avoid_: destination, feed, target.