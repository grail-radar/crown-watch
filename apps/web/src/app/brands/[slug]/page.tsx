import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DropCard, WatchCard } from '@/components/cards';
import { Plate } from '@/components/plate';
import { getBrand } from '@/lib/api';
import { brandTally, formatPrice } from '@/lib/format';
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

/**
 * The Brand page — the screen this product is judged on (#28).
 *
 * The order is the argument. A reader arrives asking whether this brand is
 * worth their attention, so the page answers in that order: the judgement, what
 * it costs, what the brand makes, and only then what recently happened.
 *
 * **Two compositions, one world.** A Curated Brand leads with the judgement at
 * display scale: it is the page, and everything under it is support. A Listed
 * Brand leads with the brand's own photograph and admits the absence beneath it
 * in one small line. No Brand in the catalogue is Curated yet, so the second is
 * the page every reader currently lands on — and a page whose largest element
 * is an admission of having nothing to say is a worse page than one that shows
 * the work and notes the gap plainly.
 */
export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = await getBrand(slug);
  if (!brand) notFound();

  // An older API build does not send these fields at all, and a brand page is
  // not worth a crash over one section.
  const accessories = brand.accessories ?? [];
  const watches = brand.watches ?? [];
  // The count the API holds, not `watches.length` — that list is capped, and
  // the headline figure has to be the true one.
  const watchCount = brand.watchCount ?? 0;
  const priceBand = brand.priceBand ?? null;
  const band = priceBand
    ? formatPrice(priceBand.low, priceBand.high, priceBand.currency)
    : null;
  const tally = brandTally(watchCount, brand.drops.length);
  // The API withholds an unapproved draft, so anything that arrives here has
  // been approved by a person and can be shown as-is (#22).
  const annotation = brand.annotation ?? null;
  // The one photograph the page leads on. Borrowed from the first Watch that
  // has one: no logo exists in the data, and a publisher's article photo behind
  // a brand's name would be borrowing their rights for decoration.
  const lead = watches.find((w) => w.imageUrl)?.imageUrl ?? null;

  const facts = [
    brand.country,
    brand.foundedYearEst ? `est. ${brand.foundedYearEst}` : null,
    tally ? `${tally} tracked` : null,
  ].filter(Boolean);

  /*
    `cover`, not `contain`, and the only place on the site that crops. This is
    the lead photograph rather than a grid thumbnail: letterboxing a packshot
    here fills the first viewport with plate instead of watch, and a store's own
    product shot carries its margins in exactly the area a crop takes.
  */
  const leadPlate = lead ? (
    // A figure column rather than a full-width banner. At container width any
    // honest ratio is 600-700px tall, which is a masthead, not a photograph;
    // and `max-height` cannot rescue it, because a box with an aspect ratio
    // answers a height clamp by narrowing, leaving a ragged right edge.
    <section className="mt-12 max-w-3xl">
      <Plate
        src={lead}
        alt={`A watch by ${brand.name}`}
        className="aspect-[3/2]"
        fit="cover"
        priority
        sizes="(min-width: 768px) 768px, 100vw"
        caption={`From ${brand.name}'s own store.`}
      />
    </section>
  ) : null;

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

      <div className="pt-8">
        <Link href="/#brands" className="text-sm text-muted transition hover:text-ink">
          ← All brands
        </Link>
      </div>

      <header className="mt-10">
        <h1 className="display text-[clamp(2.5rem,7vw,5rem)]">{brand.name}</h1>
        <p className="mt-5 text-sm text-muted">
          {facts.join(' · ')}
          {facts.length > 0 && brand.website ? ' · ' : ''}
          {brand.website && (
            <a
              href={brand.website}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Visit ${brand.name}'s own site — opens in a new tab`}
              className="text-ink underline decoration-rule underline-offset-4 transition hover:decoration-ink"
            >
              {brand.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} ↗
            </a>
          )}
        </p>
      </header>

      {/*
        The Annotation — the differentiator (`CONTEXT.md` §2). It carries no
        label above it: the sentence is the largest prose on the page and the
        line beneath says who wrote it, which is more than a heading would.

        Rendered exactly as written — no truncation, no line clamp, nothing
        appended. An Annotation that says the lume is poor has to say the lume
        is poor, or the whole exercise is marketing.
      */}
      {annotation ? (
        <>
          <section className="mt-12 border-t border-rule pt-12">
            {/* `break-words` so a long unbroken token cannot push the page
                sideways — the one thing that could mangle a sentence we promised
                to show as written. */}
            <p className="display max-w-4xl break-words text-[clamp(1.75rem,3.6vw,3.25rem)]">
              {annotation}
            </p>
            <p className="mt-8 max-w-[30rem] text-sm leading-relaxed text-muted">
              Written and approved by a person. Nobody can pay to appear here, to
              change what it says, or to have it removed.
            </p>
          </section>
          {leadPlate}
        </>
      ) : (
        /*
          The Listed composition, and the one that actually ships: no Brand in
          the catalogue is Curated yet, so this is the page a reader lands on.
          The photograph leads, because with no judgement to carry the viewport
          the brand's own work is the strongest true thing we have — and the
          absence follows it in one plain line, at the size of every other fact
          about us. Deliberately not the largest thing on the page: a
          full-scale apology would make the whole catalogue read as broken.
        */
        <>
          {leadPlate}
          <p className="mt-8 max-w-[34rem] leading-relaxed text-muted">
            We haven&apos;t formed a view on {brand.name} yet. Everything below
            is tracked in full — we just have nothing considered to say about
            the brand itself, and would rather admit that than pad it.
          </p>
        </>
      )}

      {/* What it costs. Every figure is read off the store's own Variants:
          there is no field to type one into, deliberately, because a hand-kept
          price band is a price band that goes stale and starts lying. */}
      {watchCount > 0 && (
        <section className="mt-14 border-t border-rule pt-10">
          <h2 className="display text-2xl">What it costs</h2>
          {band ? (
            <>
              <p className="mt-3 text-3xl font-medium tabular-nums sm:text-4xl">
                {band}
              </p>
              <p className="mt-3 max-w-[30rem] text-sm leading-relaxed text-muted">
                The cheapest and the dearest we hold a price for, read from{' '}
                {brand.name}&apos;s own store at our last check
                {priceBand?.currency
                  ? '.'
                  : ' — which lists prices without a currency, so these are the numbers as given.'}
              </p>
            </>
          ) : (
            <p className="mt-3 max-w-xl text-lg text-muted">
              {brand.name}&apos;s store doesn&apos;t publish prices, so we
              don&apos;t have one to quote.
            </p>
          )}
        </section>
      )}

      {/* What the brand makes. Each Watch exactly once, however many store
          products sit beneath it — the API collapses them, so three YEMA
          listings for the Superman Bronze CMM.10 are one card reading
          "3 options" rather than three cards reading the same name. */}
      <section className="mt-14 border-t border-rule pt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-2xl">What {brand.name} makes</h2>
          {watchCount > watches.length && (
            // Honest about the cap rather than quietly showing a slice.
            <span className="text-sm text-muted">
              Showing {watches.length} of {watchCount}
            </span>
          )}
        </div>
        {watches.length === 0 ? (
          <p className="mt-6 max-w-xl text-muted">
            We haven&apos;t indexed {brand.name}&apos;s catalogue yet — we follow
            them through the press rather than their own store, so what they make
            isn&apos;t here. Drops still land below.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {watches.map((watch) => (
              <li key={watch.id}>
                <WatchCard
                  watch={watch}
                  brand={{ name: brand.name, slug: brand.slug }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What has recently happened. Last of the four, because an event is the
          least of what a reader deciding about a brand needs — and each Watch
          appears once here too: the API keeps the most recent Drop per Watch,
          so a release announced once per store product is one entry
          (ADR-0003). */}
      <section className="mt-14 border-t border-rule pt-10">
        <h2 className="display text-2xl">Recent drops</h2>
        {brand.drops.length === 0 ? (
          <p className="mt-6 max-w-xl text-muted">
            {/* A literal ’ rather than `&apos;`: the JSX transform drops the
                leading space from a text run that also decodes an entity, and
                this one used to render "from YEMAyet". */}
            No published drops from {brand.name} yet — they’re on the radar, and
            new drops will appear here as their store publishes them.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {brand.drops.map((d) => (
              <li key={d.id}>
                <DropCard
                  drop={d}
                  brand={{ name: brand.name, slug: brand.slug }}
                  showBrand={false}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Everything else the shop sells. Deliberately below the drops and
          deliberately quiet: a strap is never an event, and this section is
          context rather than news (ADR-0006). */}
      {accessories.length > 0 && (
        <section className="mt-14 border-t border-rule pt-10">
          <h2 className="display text-2xl">Also from {brand.name}</h2>
          <p className="mt-3 max-w-[30rem] text-sm text-muted">
            Straps, bracelets and the rest of the shop. We track these, but they
            are never Drops — nothing here is announced.
          </p>

          <ul className="mt-8 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {accessories.map((accessory) => (
              <li key={accessory.id}>
                <Link
                  href={`/watches/${brand.slug}/${accessory.slug}`}
                  className="group flex h-full items-center gap-4 border-b border-rule pb-4"
                >
                  <Plate
                    src={accessory.imageUrl}
                    alt=""
                    className="h-14 w-14 shrink-0"
                    sizes="56px"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm transition group-hover:underline group-hover:underline-offset-4">
                      {accessory.name}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {accessory.priceLow
                        ? `${accessory.variantCount > 1 ? 'from ' : ''}${formatPrice(
                            accessory.priceLow,
                            null,
                            accessory.currency,
                          )}`
                        : 'Price not listed'}
                      {accessory.variantCount > 1 &&
                        ` · ${accessory.variantCount} options`}
                      {!accessory.available && ' · Out of stock'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
