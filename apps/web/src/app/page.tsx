import Link from 'next/link';
import { BrandCard, DropCard } from '@/components/cards';
import { SubscribeForm } from '@/components/subscribe-form';
import { getBrands, getDrops } from '@/lib/api';
import { dropTypeLabel } from '@/lib/format';

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

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      {/* Hero */}
      <section className="py-16 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-faint">
          Independent horology, tracked daily
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-medium leading-[1.08] tracking-tight sm:text-6xl">
          The microbrand watch{' '}
          <em className="italic text-gold">drop &amp; waitlist radar</em>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-faint">
          New launches, Kickstarter campaigns, waitlist openings, and restocks
          from independent watchmakers — all in one feed, so you never miss a
          drop.
        </p>
        <div className="mt-8 flex flex-wrap gap-2.5 text-xs text-faint">
          <span className="rounded-full border border-line px-3 py-1.5">
            {total} independent brand{total === 1 ? '' : 's'}
          </span>
          <span className="rounded-full border border-line px-3 py-1.5">
            {feed.count} published drop{feed.count === 1 ? '' : 's'}
          </span>
          <span className="rounded-full border border-line px-3 py-1.5">
            Refreshed every 20 minutes
          </span>
        </div>
      </section>

      {/* Latest drops */}
      <section id="drops" className="scroll-mt-8 border-t border-line/70 pt-12">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">Latest drops</h2>
          {feed.count > 0 && (
            <span className="text-sm text-faint">
              {feed.count} live on the radar
            </span>
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

        {brands.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
            No brands to show yet — the ingestion pipeline may still be warming
            up (the API sleeps when idle). Refresh in a moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => (
              <BrandCard key={b.id} brand={b} />
            ))}
          </div>
        )}
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
