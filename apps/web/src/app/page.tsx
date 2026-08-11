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
      <section className="border-b border-rule py-20 sm:py-28">
        <h1 className="display max-w-4xl text-[clamp(2.5rem,6.5vw,4.5rem)]">
          Which microbrands exist, and which are worth your attention.
        </h1>
        {/*
          States the editorial stance (ADR-0004). What is true today is that
          nothing here can be bought — worth saying plainly.
        */}
        <p className="mt-8 max-w-xl leading-relaxed text-muted">
          An independent reference for small watchmakers. Nothing here is paid
          for or sponsored — no brand can buy a place or a good word. New
          launches and restocks land on the same pages as they happen.
        </p>
        {/* Into the catalogue, not a signup — the digest and the channels sit
            further down, and a reader who arrived from one should not be sold it
            again on the first screen. */}
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <Link
            href="/#brands"
            className="bg-ink px-5 py-2.5 text-inverse transition hover:opacity-80"
          >
            Browse the brands
          </Link>
          <Link
            href="/#drops"
            className="underline decoration-rule underline-offset-4 transition hover:decoration-ink"
          >
            See what just landed
          </Link>
        </div>
      </section>

      {/* Latest drops */}
      <section id="drops" className="scroll-mt-8 pt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-2xl">Latest drops</h2>
          {feed.total > 0 && (
            <Link
              href="/drops"
              className="text-sm text-muted transition hover:text-ink"
            >
              All {feed.total} drops →
            </Link>
          )}
        </div>

        {feed.count > 0 && (
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href="/#drops"
              className={
                !activeType
                  ? 'text-ink underline underline-offset-4'
                  : 'text-muted transition hover:text-ink'
              }
            >
              All
            </Link>
            {FILTER_TYPES.map((t) => (
              <Link
                key={t}
                href={`/?type=${t}#drops`}
                className={
                  activeType === t
                    ? 'text-ink underline underline-offset-4'
                    : 'text-muted transition hover:text-ink'
                }
              >
                {dropTypeLabel(t)}
              </Link>
            ))}
          </div>
        )}

        {visibleDrops.length === 0 ? (
          <p className="mt-10 max-w-xl text-muted">
            {activeType
              ? `No ${dropTypeLabel(activeType).toLowerCase()} drops on the radar right now — check back soon.`
              : 'No published drops yet — new drops land here as soon as they clear moderation.'}
          </p>
        ) : (
          <ul className="mt-10 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDrops.map((d) => (
              <li key={d.id}>
                <DropCard drop={d} brand={d.brand} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Brand directory */}
      <section id="brands" className="mt-20 scroll-mt-8 border-t border-rule pt-14">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-2xl">Brand directory</h2>
          {total > 0 && <span className="text-sm text-muted">{total} brands</span>}
        </div>

        <BrandDirectory brands={brands} />
      </section>

      {/* Weekly digest signup */}
      <section id="digest" className="mt-20 scroll-mt-8 border-t border-rule pt-14">
        <h2 className="display text-2xl">Never miss a drop</h2>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          One weekly email with every new microbrand launch, waitlist opening
          and restock on the radar. Free, no spam, unsubscribe anytime.
        </p>
        <SubscribeForm />
      </section>
    </main>
  );
}
