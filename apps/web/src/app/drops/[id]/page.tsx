import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { DropCard } from '@/components/cards';
import { Plate } from '@/components/plate';
import { PurchaseButton } from '@/components/purchase-button';
import { getBrand, getDrop, getDropWatch } from '@/lib/api';
import { dropTypeLabel, formatPrice, relTime } from '@/lib/format';
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

/**
 * A Drop URL.
 *
 * Every one of these has to keep resolving. They were in the sitemap, so
 * search engines hold them, and readers may have shared them. What they
 * resolve *to* has changed: a Drop is an event and makes a poor landing page,
 * so a Drop about a Watch now redirects there — permanently, so the ranking
 * moves to the Watch instead of being split across both.
 *
 * A Drop about no Watch — one extracted from a publication's prose, which names
 * a watch but has no store product — keeps this page. It is the only thing that
 * Drop has, and it carries the coverage link.
 */
export default async function DropPage({ params }: Props) {
  const { id } = await params;

  // Asked before the drop itself, because this also answers for the accessory
  // Drops the feed no longer serves — whose URLs were indexed just the same.
  const destination = await getDropWatch(id);
  if (destination?.watch) {
    permanentRedirect(
      `/watches/${destination.watch.brandSlug}/${destination.watch.watchSlug}`,
    );
  }

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

      <div className="pt-8">
        <Link href="/#drops" className="text-sm text-muted transition hover:text-ink">
          ← All drops
        </Link>
      </div>

      <section className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">
        <div>
          <Plate
            src={drop.imageUrl}
            alt={`${drop.brand.name} — ${drop.title}`}
            className="aspect-[16/10]"
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
          {drop.sourceName && (
            <p className="mt-3 text-xs text-muted">
              Photo via {drop.sourceName} — all rights belong to the publisher.
            </p>
          )}
        </div>

        <div>
          <p className="text-sm text-muted">
            <Link
              href={`/brands/${drop.brand.slug}`}
              className="text-ink transition hover:underline hover:underline-offset-4"
            >
              {drop.brand.name}
            </Link>
            {` · ${dropTypeLabel(drop.type)}`}
            {drop.publishedAt && ` · added ${relTime(drop.publishedAt)}`}
          </p>
          <h1 className="display mt-4 text-[clamp(2rem,4.5vw,3.25rem)]">
            {drop.title}
          </h1>

          {(price || eventDate) && (
            <p className="mt-6 text-lg tabular-nums">
              {price}
              {price && eventDate ? <span className="text-muted"> · </span> : null}
              {eventDate && <span className="text-muted">{eventDate}</span>}
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-sm">
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
                    ? 'underline decoration-rule underline-offset-4 transition hover:decoration-ink'
                    : 'bg-ink px-5 py-2.5 text-inverse transition hover:opacity-80'
                }
              >
                Read the original coverage ↗
              </a>
            )}
            <Link
              href={`/brands/${drop.brand.slug}`}
              className="text-muted underline decoration-rule underline-offset-4 transition hover:text-ink"
            >
              More from {drop.brand.name}
            </Link>
          </div>
        </div>
      </section>

      {more.length > 0 && (
        <section className="mt-20 border-t border-rule pt-10">
          <h2 className="display text-2xl">More from {drop.brand.name}</h2>
          <ul className="mt-8 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((d) => (
              <li key={d.id}>
                <DropCard
                  drop={d}
                  brand={{ name: drop.brand.name, slug: drop.brand.slug }}
                  showBrand={false}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
