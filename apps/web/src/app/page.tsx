import Link from 'next/link';
import { getBrands } from '@/lib/api';

// Render on each request (the API is the source of truth; free-tier friendly).
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { total, brands } = await getBrands(100);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12">
        <span className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          Crown Watch
        </span>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          Microbrand watch drop &amp; waitlist radar
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
          New launches, Kickstarter campaigns, waitlist openings, and restocks
          from independent watchmakers — all in one feed.
        </p>
      </header>

      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Brand directory</h2>
          {total > 0 && (
            <span className="text-sm text-neutral-500">{total} brands</span>
          )}
        </div>

        {brands.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-700">
            No brands to show yet — the ingestion pipeline may still be warming
            up (the API sleeps when idle). Refresh in a moment.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/brands/${b.slug}`}
                  className="block rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-400 hover:shadow-sm dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{b.name}</span>
                    {b.status === 'verified' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        verified
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-neutral-500">
                    {[
                      b.country,
                      b._count.drops > 0
                        ? `${b._count.drops} drop${b._count.drops === 1 ? '' : 's'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Independent'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
