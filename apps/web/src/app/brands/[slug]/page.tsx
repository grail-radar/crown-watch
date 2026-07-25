import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DropCard } from '@/components/cards';
import { getBrand } from '@/lib/api';
import { monogram } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return { title: 'Brand not found — Crown Watch' };
  return {
    title: `${brand.name} — drops & releases | Crown Watch`,
    description: `New releases, pre-orders, waitlists and restocks from ${brand.name}, tracked by Crown Watch.`,
  };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="pt-10">
        <Link
          href="/#brands"
          className="text-sm text-faint transition hover:text-ink"
        >
          ← All brands
        </Link>
      </div>

      {/* Brand hero */}
      <section className="flex flex-wrap items-center gap-6 py-10">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-panel-2 to-night font-display text-2xl text-gold ring-1 ring-line">
          {monogram(brand.name)}
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-4xl font-medium tracking-tight">
            {brand.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
            {brand.status === 'verified' ? (
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 font-medium text-emerald-300 ring-1 ring-emerald-400/25">
                Verified
              </span>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-1">
                Independent
              </span>
            )}
            {brand.country && (
              <span className="rounded-full border border-line px-2.5 py-1">
                {brand.country}
              </span>
            )}
            {brand.foundedYearEst && (
              <span className="rounded-full border border-line px-2.5 py-1">
                est. {brand.foundedYearEst}
              </span>
            )}
            {brand.website && (
              <a
                href={brand.website}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-gold/40 px-2.5 py-1 text-gold transition hover:border-gold hover:text-gold-bright"
              >
                Website ↗
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Drops */}
      <section className="border-t border-line/70 pt-10">
        <h2 className="mb-6 font-display text-2xl tracking-tight">Drops</h2>
        {brand.drops.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
            No published drops from {brand.name} yet — they&apos;re on the
            radar, and new releases will appear here once verified.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {brand.drops.map((d) => (
              <DropCard
                key={d.id}
                drop={d}
                brand={{ name: brand.name, slug: brand.slug }}
                showBrand={false}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
