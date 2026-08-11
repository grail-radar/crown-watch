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
      <div className="pt-8">
        <Link href="/" className="text-sm text-muted transition hover:text-ink">
          ← Back to the radar
        </Link>
      </div>

      <header className="border-b border-rule py-12">
        <h1 className="display text-[clamp(2.25rem,5vw,3.5rem)]">All drops</h1>
        <p className="mt-4 max-w-xl text-muted">
          {feed.total} published {feed.total === 1 ? 'drop' : 'drops'} from
          independent watchmakers, newest first.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link
          href="/drops"
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
            href={`/drops?type=${t}`}
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

      {feed.drops.length === 0 ? (
        <p className="mt-12 max-w-xl text-muted">
          Nothing here yet — try another filter, or{' '}
          <Link href="/submit" className="text-ink underline underline-offset-4">
            submit a drop
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {feed.drops.map((d) => (
            <li key={d.id}>
              <DropCard drop={d} brand={d.brand} />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="mt-16 flex items-center justify-between border-t border-rule pt-6 text-sm">
          {currentPage > 1 ? (
            <Link
              href={qs(currentPage - 1)}
              className="text-muted underline decoration-rule underline-offset-4 transition hover:text-ink"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={qs(currentPage + 1)}
              className="text-muted underline decoration-rule underline-offset-4 transition hover:text-ink"
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
