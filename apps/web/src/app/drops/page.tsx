import type { Metadata } from 'next';
import Link from 'next/link';
import { DropCard } from '@/components/cards';
import { getDrops } from '@/lib/api';
import { dropTypeLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PER_PAGE = 24;
const FILTER_TYPES = [
  'pre_order',
  'kickstarter_launch',
  'waitlist_open',
  'restock',
] as const;

export const metadata: Metadata = {
  title: 'All drops',
  description:
    'Every published microbrand watch drop on the radar — new launches, Kickstarter campaigns, waitlist openings and restocks from independent watchmakers.',
  alternates: { canonical: '/drops' },
  openGraph: {
    type: 'website',
    url: '/drops',
    title: 'All drops | Crown Watch',
    description:
      'Every published microbrand watch drop on the radar, newest first.',
  },
};

export default async function DropsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const { page, type } = await searchParams;
  const activeType = FILTER_TYPES.includes(type as never) ? type : undefined;
  const parsed = page ? parseInt(page, 10) : 1;
  const currentPage = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;

  const feed = await getDrops(PER_PAGE, (currentPage - 1) * PER_PAGE, activeType);
  const totalPages = Math.max(1, Math.ceil(feed.total / PER_PAGE));
  const qs = (p: number) =>
    `/drops?${new URLSearchParams({
      ...(activeType ? { type: activeType } : {}),
      ...(p > 1 ? { page: String(p) } : {}),
    }).toString()}`.replace(/\?$/, '');

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="pt-10">
        <Link href="/" className="text-sm text-faint transition hover:text-ink">
          ← Back to the radar
        </Link>
      </div>

      <header className="py-10">
        <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
          All drops
        </h1>
        <p className="mt-3 text-faint">
          {feed.total} published {feed.total === 1 ? 'drop' : 'drops'} from
          independent watchmakers, newest first.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap gap-2 text-xs">
        <Link
          href="/drops"
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
            href={`/drops?type=${t}`}
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

      {feed.drops.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
          Nothing here yet — try another filter, or{' '}
          <Link href="/submit" className="text-gold underline underline-offset-4">
            submit a drop
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {feed.drops.map((d) => (
            <DropCard key={d.id} drop={d} brand={d.brand} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-12 flex items-center justify-between border-t border-line/70 pt-6 text-sm">
          {currentPage > 1 ? (
            <Link
              href={qs(currentPage - 1)}
              className="rounded-xl border border-line px-4 py-2 text-faint transition hover:border-gold/50 hover:text-ink"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-faint">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={qs(currentPage + 1)}
              className="rounded-xl border border-line px-4 py-2 text-faint transition hover:border-gold/50 hover:text-ink"
            >
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
