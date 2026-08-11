import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plate } from '@/components/plate';
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

      <div className="pt-8">
        <Link
          href={`/brands/${watch.brand.slug}`}
          className="text-sm text-muted transition hover:text-ink"
        >
          ← {watch.brand.name}
        </Link>
      </div>

      <header className="mt-10">
        <h1 className="display text-[clamp(2rem,5vw,3.5rem)]">{watch.name}</h1>
        <p className="mt-4 text-sm text-muted">
          <Link
            href={`/brands/${watch.brand.slug}`}
            className="text-ink transition hover:underline hover:underline-offset-4"
          >
            {watch.brand.name}
          </Link>
          {cheapest?.price &&
            ` · from ${formatPrice(cheapest.price, null, cheapest.currency)}`}
        </p>
      </header>

      <div className="mt-10">
        <Plate
          src={watch.imageUrl}
          alt={`${watch.brand.name} ${watch.name}`}
          className="aspect-[3/2]"
          fit="cover"
          priority
          sizes="(min-width: 896px) 896px, 100vw"
          caption={`Photographed by ${watch.brand.name}, from their own store.`}
        />
      </div>

      <section className="mt-14 border-t border-rule pt-10">
        <h2 className="display text-2xl">
          {watch.variants.length === 1
            ? 'Where to buy it'
            : `${watch.variants.length} ways to buy it`}
        </h2>

        <ul className="mt-6">
          {watch.variants.map((variant) => (
            <li
              key={variant.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {variant.reference ?? watch.name}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {variant.available ? 'In stock' : 'Out of stock'}
                </p>
              </div>
              <div className="flex items-baseline gap-6 text-sm">
                {variant.price && (
                  <span className="tabular-nums">
                    {formatPrice(variant.price, null, variant.currency)}
                  </span>
                )}
                <a
                  href={variant.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Buy the ${variant.reference ?? watch.name} — opens the brand's store in a new tab`}
                  className="underline decoration-ink underline-offset-4 transition hover:opacity-70"
                >
                  Buy ↗
                </a>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-xl text-xs leading-relaxed text-muted">
          Prices and availability as of our last check of{' '}
          {watch.brand.website ? (
            <a
              href={watch.brand.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline decoration-rule underline-offset-4 transition hover:decoration-ink"
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
