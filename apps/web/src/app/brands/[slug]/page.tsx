import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandAvatar, BrandBanner } from '@/components/brand-art';
import { DropCard } from '@/components/cards';
import { getBrand } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) return { title: 'Brand not found' };
  const description = `New releases, pre-orders, waitlists and restocks from ${brand.name}, tracked by Crown Watch.`;
  return {
    title: `${brand.name} — drops & releases`,
    description,
    alternates: { canonical: `/brands/${brand.slug}` },
    openGraph: {
      type: 'website',
      url: `/brands/${brand.slug}`,
      title: `${brand.name} — drops & releases`,
      description,
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: brand.name,
    url: `${SITE_URL}/brands/${brand.slug}`,
    ...(brand.website ? { sameAs: [brand.website] } : {}),
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="pt-10">
        <Link
          href="/#brands"
          className="text-sm text-faint transition hover:text-ink"
        >
          ← All brands
        </Link>
      </div>

      {/* Brand hero. The banner is generated from the slug: no logo exists in
          the data, and a publisher's photo behind a brand's name would be
          borrowing their rights for decoration rather than attribution. */}
      <section className="mt-4">
        <BrandBanner slug={brand.slug} className="h-32 rounded-2xl sm:h-44" />

        <div className="flex flex-wrap items-end gap-5 px-1 pb-10">
          <BrandAvatar
            name={brand.name}
            slug={brand.slug}
            className="-mt-10 h-20 w-20 text-2xl ring-4 ring-night sm:-mt-12 sm:h-24 sm:w-24"
          />
          <div className="min-w-0 flex-1 pb-1">
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
                  aria-label={`Visit ${brand.name}'s own site — opens in a new tab`}
                  className="rounded-full border border-gold/40 px-2.5 py-1 text-gold transition hover:border-gold hover:text-gold-bright"
                >
                  Visit {brand.name} ↗
                </a>
              )}
              <span className="rounded-full border border-line px-2.5 py-1">
                {brand.drops.length > 0
                  ? `${brand.drops.length} drop${brand.drops.length === 1 ? '' : 's'} tracked`
                  : 'On the radar'}
              </span>
            </div>
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
