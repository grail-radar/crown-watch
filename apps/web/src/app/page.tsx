import Link from 'next/link';
import { BrandDirectory } from '@/components/brand-directory';
import { DropCard } from '@/components/cards';
import { SubscribeForm } from '@/components/subscribe-form';
import { getBrands, getDrops } from '@/lib/api';
import { dropTypeLabel } from '@/lib/format';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

// Render on each request (the API is the source of truth; free-tier friendly).
export const dynamic = 'force-dynamic';

const FILTER_TYPES = [
  'pre_order',
  'kickstarter_launch',
  'waitlist_open',
  'restock',
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const activeType = FILTER_TYPES.includes(type as never) ? type : undefined;

  const [{ total, brands }, feed] = await Promise.all([
    getBrands(100),
    getDrops(48),
  ]);
  const visibleDrops = activeType
    ? feed.drops.filter((d) => d.type === activeType)
    : feed.drops;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/*
        Pitches discovery, per CONTEXT.md §1 and §2. What is absent is
        load-bearing: the brand count, drop count and "refreshed every 20
        minutes" that used to sit here are gone rather than restyled, because a
        competitor tracks ten times the brands and detects restocks in minutes —
        any number or speed claim invites the one comparison this site loses.
      */}
      <section className="py-16 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-faint">
          Independent watchmaking, with an opinion
        </p>
        <h1 className="mt-4 max-w-4xl font-display text-4xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
          Which microbrands exist, and{' '}
          <em className="italic text-gold">which are worth your attention</em>.
        </h1>
        {/*
          States the editorial stance (ADR-0004), not a stock of verdicts we do
          not have yet: per-brand annotations are #22 and unbuilt, so "we say
          when a brand isn't worth it" would be false on the day this ships.
          What is true today is that nothing can be bought — worth saying plainly
          now, and worth strengthening once #22 lands.
        */}
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-faint">
          An independent directory of small watchmakers. Nothing here is paid for
          or sponsored — no brand can buy a place or a good word. New releases and
          restocks land on the same pages as they happen.
        </p>
        {/* Into the catalogue, not a signup — the digest and the channels sit
            further down, and a reader who arrived from one should not be sold it
            again on the first screen. */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/#brands"
            className="rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-on-gold transition hover:bg-gold-bright"
          >
            Browse the brands
          </Link>
          <Link
            href="/#drops"
            className="rounded-full border border-line px-5 py-2.5 text-sm text-faint transition hover:border-gold/50 hover:text-ink"
          >
            See what just landed
          </Link>
        </div>
      </section>

      {/* Latest drops */}
      <section id="drops" className="scroll-mt-8 border-t border-line/70 pt-12">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">Latest drops</h2>
          {feed.total > 0 && (
            <Link
              href="/drops"
              className="text-sm text-faint transition hover:text-ink"
            >
              All {feed.total} drops →
            </Link>
          )}
        </div>

        {feed.count > 0 && (
          <div className="mb-6 flex flex-wrap gap-2 text-xs">
            <Link
              href="/#drops"
              className={`rounded-full border px-3 py-1.5 transition ${
                !activeType
                  ? 'border-gold bg-gold/10 text-gold-bright'
                  : 'border-line text-faint hover:border-gold/50 hover:text-ink'
              }`}
            >
              All
            </Link>
            {FILTER_TYPES.map((t) => (
              <Link
                key={t}
                href={`/?type=${t}#drops`}
                className={`rounded-full border px-3 py-1.5 transition ${
                  activeType === t
                    ? 'border-gold bg-gold/10 text-gold-bright'
                    : 'border-line text-faint hover:border-gold/50 hover:text-ink'
                }`}
              >
                {dropTypeLabel(t)}
              </Link>
            ))}
          </div>
        )}

        {visibleDrops.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
            {activeType
              ? `No ${dropTypeLabel(activeType).toLowerCase()} drops on the radar right now — check back soon.`
              : 'No published drops yet — new releases land here as soon as they clear moderation.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDrops.map((d) => (
              <DropCard key={d.id} drop={d} brand={d.brand} />
            ))}
          </div>
        )}
      </section>

      {/* Brand directory */}
      <section id="brands" className="scroll-mt-8 mt-16 border-t border-line/70 pt-12">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">
            Brand directory
          </h2>
          {total > 0 && (
            <span className="text-sm text-faint">{total} brands</span>
          )}
        </div>

        <BrandDirectory brands={brands} />
      </section>

      {/* Weekly digest signup */}
      <section id="digest" className="mt-16 scroll-mt-8">
        <div className="rounded-3xl border border-gold/25 bg-panel p-8 sm:p-10">
          <h2 className="font-display text-2xl tracking-tight">
            Never miss a drop
          </h2>
          <p className="mt-2 max-w-xl text-faint">
            One weekly email with every new microbrand release, waitlist opening
            and restock on the radar. Free, no spam, unsubscribe anytime.
          </p>
          <SubscribeForm />
        </div>
      </section>
    </main>
  );
}
