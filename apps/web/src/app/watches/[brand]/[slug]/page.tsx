import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWatch } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ brand: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { brand, slug } = await params;
  const watch = await getWatch(brand, slug);
  if (!watch) return { title: 'Watch not found' };

  const title = `${watch.brand.name} ${watch.name}`;
  const description = `${watch.name} by ${watch.brand.name} — where to buy it, and what it costs.`;
  const path = `/watches/${watch.brand.slug}/${watch.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      url: path,
      title,
      description,
      ...(watch.imageUrl ? { images: [watch.imageUrl] } : {}),
    },
    twitter: { card: 'summary_large_image' },
  };
}

/**
 * One Watch — the durable page.
 *
 * A drop is an event and makes a poor destination: "Baltic restocked on
 * 4 August" is a bad thing to rank for and a worse thing to land on three
 * months later. This is what people actually search for, and every way to buy
 * the watch sits on it, because a store listing one model as three products is
 * an implementation detail of that store rather than three things to want.
 */
export default async function WatchPage({ params }: Props) {
  const { brand, slug } = await params;
  const watch = await getWatch(brand, slug);
  if (!watch) notFound();

  const cheapest = watch.variants.find((v) => v.price !== null);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: watch.name,
    brand: { '@type': 'Brand', name: watch.brand.name },
    url: `${SITE_URL}/watches/${watch.brand.slug}/${watch.slug}`,
    ...(watch.imageUrl ? { image: watch.imageUrl } : {}),
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="pt-10">
        <Link
          href={`/brands/${watch.brand.slug}`}
          className="text-sm text-faint transition hover:text-ink"
        >
          ← {watch.brand.name}
        </Link>
      </div>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.2em] text-gold">
          {watch.brand.name}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
          {watch.name}
        </h1>
        {cheapest?.price && (
          <p className="mt-3 text-lg text-faint">
            from {formatPrice(cheapest.price, null, cheapest.currency)}
          </p>
        )}
      </header>

      {watch.imageUrl && (
        // Not next/image: these are third-party store URLs on arbitrary hosts,
        // which the optimiser would need configuring for one domain at a time.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={watch.imageUrl}
          alt={`${watch.brand.name} ${watch.name}`}
          className="mt-8 w-full rounded-2xl border border-line bg-panel object-cover"
        />
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl tracking-tight">
          {watch.variants.length === 1
            ? 'Where to buy it'
            : `${watch.variants.length} ways to buy it`}
        </h2>

        <ul className="mt-4 divide-y divide-line/50 rounded-2xl border border-line">
          {watch.variants.map((variant) => (
            <li
              key={variant.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {variant.reference ?? watch.name}
                </p>
                <p className="mt-0.5 text-xs text-faint">
                  {variant.available ? 'In stock' : 'Out of stock'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {variant.price && (
                  <span className="text-sm text-ink">
                    {formatPrice(variant.price, null, variant.currency)}
                  </span>
                )}
                <a
                  href={variant.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-gold/40 px-3.5 py-1.5 text-sm text-gold transition hover:border-gold hover:text-gold-bright"
                >
                  Buy ↗
                </a>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-faint">
          Prices and availability as of our last check of{' '}
          {watch.brand.website ? (
            <a
              href={watch.brand.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold transition hover:text-gold-bright"
            >
              {watch.brand.name}
            </a>
          ) : (
            watch.brand.name
          )}
          ’s own store.
        </p>
      </section>
    </main>
  );
}
