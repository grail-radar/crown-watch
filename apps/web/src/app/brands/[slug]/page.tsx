import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandAvatar, BrandBanner } from '@/components/brand-art';
import { DropCard } from '@/components/cards';
import { getBrand } from '@/lib/api';
import { formatPrice } from '@/lib/format';
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

  // An older API build does not send these fields at all, and a brand page is
  // not worth a crash over a section that is only ever context.
  const accessories = brand.accessories ?? [];
  // The API withholds an unapproved draft, so anything that arrives here has
  // been approved by a person and can be shown as-is (#22).
  const annotation = brand.annotation ?? null;

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
            {brand.status === 'curated' ? (
              <span className="rounded-full bg-gold/10 px-2.5 py-1 font-medium text-gold ring-1 ring-gold/25">
                Curated
              </span>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-1">
                Listed
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

      {/* The Annotation — the first thing on the page after the brand's own
          name, and above every other section. `CONTEXT.md` §2 makes this the
          differentiator: a much larger competitor tracks ten times as many
          brands and cannot tell you whether any of them is worth your money.
          If a reader screenshots one thing off this page, it should be this.
          (#28 orders what follows it.)

          Rendered exactly as written — no truncation, no line clamp, nothing
          appended. An Annotation that says the lume is poor has to say the
          lume is poor, or the whole exercise is marketing. */}
      {annotation ? (
        <section className="border-t border-line/70 pt-10">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-gold">
            Our take
          </h2>
          {/* `break-words` so a long unbroken token cannot push the page
              sideways — the one thing that could mangle a sentence we promised
              to show as written. */}
          <p className="mt-4 max-w-3xl break-words font-display text-2xl leading-snug tracking-tight text-ink sm:text-3xl">
            {annotation}
          </p>
          <p className="mt-4 text-xs text-faint">
            Written and approved by a person. Nobody can pay to appear here, to
            change what it says, or to have it removed.
          </p>
        </section>
      ) : (
        <section className="border-t border-line/70 pt-10">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-faint">
            Our take
          </h2>
          {/* Readable absence, not an empty gap — and deliberately not a
              judgement. Listed means nobody has written one yet, which is a
              statement about us rather than about the brand. */}
          <p className="mt-4 max-w-3xl text-lg leading-snug text-faint">
            We haven&apos;t reviewed {brand.name} yet. It is tracked in full and
            every drop below is real — we just have nothing considered to say
            about the brand itself, and would rather admit that than pad it.
          </p>
        </section>
      )}

      {/* Drops */}
      <section className="mt-14 border-t border-line/70 pt-10">
        <h2 className="mb-6 font-display text-2xl tracking-tight">Drops</h2>
        {brand.drops.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
            No published drops from {brand.name} yet — they&apos;re on the
            radar, and new releases will appear here as their store publishes
            them.
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

      {/* Everything else the shop sells. Deliberately below the drops and
          deliberately quiet: a strap is never an event, and this section is
          context rather than news (ADR-0006). A brand with none renders the
          page exactly as it did before. */}
      {accessories.length > 0 && (
        <section className="mt-14 border-t border-line/70 pt-10">
          <h2 className="font-display text-2xl tracking-tight">
            Also from {brand.name}
          </h2>
          <p className="mt-2 text-sm text-faint">
            Straps, bracelets and the rest of the shop. We track these, but they
            are never Drops — nothing here is announced.
          </p>

          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accessories.map((accessory) => (
              <li key={accessory.id}>
                <Link
                  href={`/watches/${brand.slug}/${accessory.slug}`}
                  className="flex h-full items-center gap-3 rounded-xl border border-line bg-panel/40 p-3 transition hover:border-gold/40"
                >
                  {accessory.imageUrl ? (
                    // Not next/image: third-party store URLs on arbitrary
                    // hosts, which the optimiser needs configuring per domain.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={accessory.imageUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="h-12 w-12 shrink-0 rounded-lg border border-dashed border-line"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {accessory.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-faint">
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
