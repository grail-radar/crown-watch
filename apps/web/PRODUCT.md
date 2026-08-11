# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: people discovering the microbrand scene.** They know that watchmaking
exists outside the big Swiss names and cannot tell which of the hundreds of small
brands deserve their attention. They arrive without a shortlist, and the job is
deciding who is worth following — not tracking a brand they already own.

**Secondary: enthusiasts already following specific brands** who do not want to
miss a launch, waitlist opening or restock. One system serves both: the curated
judgement is the product, and the drop radar is what keeps it current.

**Arrival and device are genuinely mixed.** Readers land from Telegram posts on a
phone and from search on a desktop in comparable numbers, so neither scene is the
adaptation of the other — both are first-class.

**Operator (internal): a solo moderator.** No source publishes to the public feed
unreviewed, so somebody clears a queue. Today that is one person working a
token-gated `/admin` page plus CLI scripts.

## Product Purpose

Crown Watch aggregates independent and microbrand watchmaking — new launches,
Kickstarter campaigns, waitlist openings and restocks — into one place, instead of
an enthusiast following dozens of individual brand newsletters and Instagram
accounts.

Success is a reader who can name brands worth their attention that they could not
name before, and who comes back when something lands. Every Brand and every Watch
gets its own indexable page; organic search is the primary growth channel.

## Positioning

**The Annotation is the product** — one honest sentence of human judgement per
Brand, including the unflattering ones. It cannot be scraped, and a competitor's
far larger database does not have it.

Breadth and speed are explicitly *not* available as a differentiator:
chronoscout.co already tracks ~330 brands with restock alerts and sell-out speed.
Pure aggregation is a weak reason to pay when brand newsletters are free and
instant. The judgement is what turns a feed into a way to decide, and it is what
future work must protect.

**Nothing about placement or judgement is purchasable.** Affiliate tags on
purchase links are the only commercial relationship. The moment a Brand can pay
for what the site says about it, every Annotation on the site is worthless — a
permanent no, recorded as ADR-0004.

## Operating Context

- Readers arrive on a Drop or Brand page from a Telegram channel post, or on a
  Watch or Brand page from search. The homepage is not the main entrance.
- Two public Telegram channels broadcast Drops: `@crownwatch_en` (English) and
  `@crownwatch_ua` (Ukrainian). A weekly email digest is the slower channel.
- A Drop is an *event*, so it appears as an entry on a Watch page and never as a
  destination of its own: people search for "Baltic Aquascaphe MK2", never for
  "Baltic restock, August".
- Content is machine-extracted from watch publications and brand storefronts, then
  cleared by a human before it is public.
- Headlines and images belong to their publishers (Worn & Wound, aBlogtoWatch,
  Monochrome, Fratello, Hodinkee) and link back to the original coverage.

## Capabilities and Constraints

**Live surfaces:** public feed with Drop-type filters (`/`), all Drops
(`/drops`, `/drops/[id]`), Brand pages (`/brands/[slug]`), Watch pages
(`/watches/[brand]/[slug]`), a manual Drop submission form (`/submit`), a
token-gated moderation page (`/admin`), and a weekly-digest email signup.

**Scope decision — the web app stays a public catalogue.** No sign-in, no per-user
Watchlists, no checkout on the site for now. Alerts are delivered through Telegram
and the weekly email. The paid tier and Stripe remain product intent, not web
surface. Future design must not assume an account exists.

**Ukrainian is coming to the site.** `uk` is a broadcast locale today and the
website is English-only, but the site itself will be localized. Design must plan
for a language switcher and for Cyrillic strings running roughly a third longer
than their English equivalents; no layout may depend on English string lengths.

**Ubiquitous language (`CONTEXT.md` §9) is binding on UI labels.** Brand, Watch,
Variant, Drop, Accessory, Signal, Price band, Annotation, Curated / Listed,
Watchlist, Channel. The avoided terms are avoided in the interface too: never
"product", "model", "SKU", "listing", "release", "bio", "blurb", "verified" or
"featured".

**Two Brand states, and the honest one is not hidden.** *Curated* means a human
approved the Annotation; *Listed* means present and openly unreviewed. A Listed
Brand is not a defective Curated one and must not be styled as an error or an
absence.

**Copyright constrains what can be displayed.** Extraction outputs short factual
fields in our own structure and never reproduces source marketing copy or article
text. No design may call for prose the pipeline is not allowed to produce.

**Not purchasable, so not designable:** no sponsored slots, no promoted ordering,
no "featured brand" placements, ever.

**Nothing physical is sold** — no shipping, customs or logistics data exists.

## Brand Commitments

- **Name:** Crown Watch. Domain `crownswatch.org`.
- **Tagline:** "Microbrand watch drop & waitlist radar."
- **Voice:** plainly stated, opinionated, unpadded. The homepage deliberately
  carries no brand count, drop count or refresh-speed claim, because any number
  invites the one comparison this site loses. Editorial independence is stated in
  plain words rather than sold.
- **Standing preference — the category standard, at the craft level of its best
  practitioners.** Asked to choose a visual world, the answer was the convention
  played straight rather than an invented one. The bar is **A Collected Man** and
  **Hodinkee**: this site should be comparable to those, and is not trying to
  look like something else. Recorded as durable, not as one project's mood.
- **Incumbent identity in code** (documented in the DESIGN.md that this
  preference supersedes): Fraunces display + Instrument Sans text, a gold accent
  on an ink ground, and a reader-controlled light/dark theme. The theme control
  is a requirement and survives; the rest is being rebuilt.

## Evidence on Hand

- A real seeded catalogue: ~44 Brands, published Drops with prices and links,
  Watches and Variants, and price bands derived from Variants.
- A small number of written Annotations; most Brands are Listed rather than
  Curated. Fact-drafting exists to speed the research, but a person writes every
  sentence.
- Two live Telegram channels with real broadcast history.
- Vercel Analytics and Speed Insights are wired up, so device and traffic claims
  can be checked rather than assumed.
- **Absent, and not to be invented:** testimonials, customer logos, user counts,
  subscriber numbers, ship-date reliability scores (tried and retired — see
  `CONTEXT.md` §2), pricing pages, and any comparison claiming more coverage or
  faster detection than a competitor.

## Product Principles

1. **The judgement is the product; the feed keeps it current.** When the two
   compete for a reader's attention, the judgement wins the position.
2. **Never claim breadth or speed.** Those comparisons are lost before they start.
   Say what is honest and specific instead.
3. **Nothing is purchasable but a watch, and not from us.** No placement, no good
   word, no ordering — affiliate links are the whole commercial surface.
4. **Unreviewed is stated, not hidden.** Listed Brands and machine-extracted facts
   are labelled honestly rather than dressed as certainty.
5. **The Watch page is the destination.** Drops are events on it; the catalogue is
   built to be landed on from search, not navigated from the homepage.

## Accessibility & Inclusion

No formal standard has been set. Two product-specific requirements already exist:
a reader-controlled light/dark theme that must survive future work, and Ukrainian
localization, which makes text-length tolerance and correct `lang` handling an
accessibility concern rather than a styling one.
