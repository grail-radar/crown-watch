import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DropCard, TypeBadge } from '@/components/cards';
import { DropImage } from '@/components/drop-image';
import { PurchaseButton } from '@/components/purchase-button';
import { getBrand, getDrop } from '@/lib/api';
import { dropTypeLabel, formatPrice, monogram, relTime } from '@/lib/format';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const AVAILABILITY: Record<string, string> = {
  pre_order: 'https://schema.org/PreOrder',
  kickstarter_launch: 'https://schema.org/PreOrder',
  waitlist_open: 'https://schema.org/PreOrder',
  restock: 'https://schema.org/InStock',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const drop = await getDrop(id);
  if (!drop) return { title: 'Drop not found' };
  const price = formatPrice(drop.priceLow, drop.priceHigh, drop.currency);
  const description = `${dropTypeLabel(drop.type)} from ${drop.brand.name}${
    price ? ` · ${price}` : ''
  }${drop.sourceName ? ` — spotted via ${drop.sourceName}` : ''}. Track every microbrand drop on Crown Watch.`;
  return {
    title: `${drop.brand.name} ${drop.title}`,
    description,
    alternates: { canonical: `/drops/${drop.id}` },
    openGraph: {
      type: 'website',
      url: `/drops/${drop.id}`,
      title: `${drop.brand.name} ${drop.title}`,
      description,
      // Use the article's own photo when we have one; otherwise the root
      // branded OG card applies automatically.
      ...(drop.imageUrl ? { images: [drop.imageUrl] } : {}),
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function DropPage({ params }: Props) {
  const { id } = await params;
  const drop = await getDrop(id);
  if (!drop) notFound();

  const [price, brandDetail] = [
    formatPrice(drop.priceLow, drop.priceHigh, drop.currency),
    await getBrand(drop.brand.slug),
  ];
  const more = (brandDetail?.drops ?? []).filter((d) => d.id !== drop.id);
  const eventDate = drop.eventDate
    ? new Date(drop.eventDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: drop.title,
    brand: { '@type': 'Brand', name: drop.brand.name },
    url: `${SITE_URL}/drops/${drop.id}`,
    ...(drop.imageUrl ? { image: drop.imageUrl } : {}),
    ...(drop.priceLow && drop.currency
      ? {
          offers: {
            '@type': 'Offer',
            price: String(drop.priceLow),
            priceCurrency: drop.currency,
            availability: AVAILABILITY[drop.type] ?? 'https://schema.org/PreOrder',
            ...(drop.sourceUrl ? { url: drop.sourceUrl } : {}),
          },
        }
      : {}),
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="pt-10">
        <Link href="/#drops" className="text-sm text-faint transition hover:text-ink">
          ← All drops
        </Link>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-line/80 bg-panel">
          <div className="relative aspect-[16/10]">
            <DropImage
              src={drop.imageUrl}
              alt={`${drop.brand.name} — ${drop.title}`}
              fallback={monogram(drop.brand.name)}
            />
          </div>
          {drop.sourceName && (
            <p className="border-t border-line/70 px-4 py-2.5 text-[11px] text-faint">
              Photo via {drop.sourceName} — all rights belong to the publisher.
            </p>
          )}
        </div>

        <div className="flex flex-col justify-center">
          <div>
            <TypeBadge type={drop.type} />
          </div>
          <Link
            href={`/brands/${drop.brand.slug}`}
            className="mt-4 text-xs font-medium uppercase tracking-[0.2em] text-gold transition hover:text-gold-bright"
          >
            {drop.brand.name}
          </Link>
          <h1 className="mt-2 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            {drop.title}
          </h1>

          <div className="mt-6 flex flex-wrap gap-2 text-xs text-faint">
            {price && (
              <span className="rounded-full border border-line px-3 py-1.5">
                {price}
              </span>
            )}
            {eventDate && (
              <span className="rounded-full border border-line px-3 py-1.5">
                {eventDate}
              </span>
            )}
            {drop.publishedAt && (
              <span className="rounded-full border border-line px-3 py-1.5">
                Added {relTime(drop.publishedAt)}
              </span>
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {/* Where to act comes first — it is what the reader came for. The
                coverage follows as attribution, stepping down to a quieter
                style once it is no longer the only thing on offer. */}
            <PurchaseButton purchase={drop.purchase} brandName={drop.brand.name} />
            {drop.sourceUrl && (
              <a
                href={drop.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  drop.purchase
                    ? 'rounded-xl border border-line px-5 py-2.5 text-sm text-faint transition hover:border-gold/50 hover:text-ink'
                    : 'rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-on-gold transition hover:bg-gold-bright'
                }
              >
                Read the original coverage ↗
              </a>
            )}
            <Link
              href={`/brands/${drop.brand.slug}`}
              className="rounded-xl border border-line px-5 py-2.5 text-sm text-faint transition hover:border-gold/50 hover:text-ink"
            >
              More from {drop.brand.name}
            </Link>
          </div>
        </div>
      </section>

      {more.length > 0 && (
        <section className="mt-20 border-t border-line/70 pt-10">
          <h2 className="mb-6 font-display text-2xl tracking-tight">
            More from {drop.brand.name}
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((d) => (
              <DropCard
                key={d.id}
                drop={d}
                brand={{ name: drop.brand.name, slug: drop.brand.slug }}
                showBrand={false}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
