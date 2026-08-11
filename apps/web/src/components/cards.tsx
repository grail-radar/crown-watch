import Link from 'next/link';
import type {
  BrandSummary,
  BrandWatchSummary,
  DropSummary,
} from '@/lib/api';
import {
  brandTally,
  dropTypeLabel,
  formatPrice,
  relTime,
} from '@/lib/format';
import { Plate } from './plate';
import { PurchaseTag } from './purchase-button';

/**
 * The mark on a Brand we have written about.
 *
 * A drawn square rather than a badge or a colour: this world has one ink and no
 * chips, and "there is a view on this one" is worth exactly this much space in
 * a directory. Its meaning is stated once in the directory's legend.
 */
export function CuratedMark() {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.42em] inline-block h-[0.42em] w-[0.42em] shrink-0 self-start bg-ink"
    />
  );
}

/**
 * One event about a Watch.
 *
 * No card: a plate, then text under it. The grid's gutters do the separating
 * that a border used to, which is what lets the photographs sit next to each
 * other without forty rectangles competing with them.
 */
export function DropCard({
  drop,
  brand,
  showBrand = true,
}: {
  drop: DropSummary;
  brand: { name: string; slug: string };
  showBrand?: boolean;
}) {
  const price = formatPrice(drop.priceLow, drop.priceHigh, drop.currency);
  const added = relTime(drop.publishedAt);
  // Straight to the Watch where there is one. The Drop URL redirects there
  // anyway, so this only avoids the hop — but it also stops us asking a search
  // engine to crawl a 308 to reach a page we are linking from regardless. A
  // Drop with no Watch came from a publication's prose and keeps its own page.
  const href = drop.watch
    ? `/watches/${drop.watch.brandSlug}/${drop.watch.watchSlug}`
    : `/drops/${drop.id}`;

  return (
    <article className="group flex h-full flex-col">
      <Link href={href} aria-label={`${brand.name} — ${drop.title}`}>
        <Plate
          src={drop.imageUrl}
          alt={`${brand.name} — ${drop.title}`}
          className="aspect-[16/10]"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </Link>

      <div className="mt-4 flex flex-1 flex-col">
        <p className="text-xs text-muted">
          {showBrand && (
            <>
              <Link
                href={`/brands/${brand.slug}`}
                className="text-ink transition hover:underline hover:underline-offset-4"
              >
                {brand.name}
              </Link>
              {' · '}
            </>
          )}
          {dropTypeLabel(drop.type)}
          {added && ` · ${added}`}
        </p>

        <Link
          href={href}
          className="mt-2 block leading-snug transition group-hover:underline group-hover:underline-offset-4"
        >
          {drop.title}
        </Link>

        <div className="mt-auto flex items-baseline justify-between gap-3 pt-4 text-sm">
          <span className="tabular-nums text-muted">{price ?? ''}</span>
          {/* Lets a reader see which drops they can act on without opening
              each one. Renders nothing when there is nowhere honest to send
              them. */}
          <PurchaseTag purchase={drop.purchase} brandName={brand.name} />
        </div>

        {drop.sourceName && (
          <p className="mt-2 text-xs text-muted">via {drop.sourceName} ↗</p>
        )}
      </div>
    </article>
  );
}

/**
 * One Watch as the brand page lists it — a photograph, what it is called, and
 * what the cheapest way to have it costs.
 *
 * However many store products sit beneath it, this is one card: the API
 * collapses them, so YEMA's three listings for the Superman Bronze CMM.10 read
 * "3 options" rather than filling a row with the same name (#28).
 */
export function WatchCard({
  watch,
  brand,
}: {
  watch: BrandWatchSummary;
  brand: { name: string; slug: string };
}) {
  const price = formatPrice(watch.priceLow, null, watch.currency);
  return (
    <Link
      href={`/watches/${brand.slug}/${watch.slug}`}
      className="group flex h-full flex-col"
    >
      <Plate
        src={watch.imageUrl}
        alt={`${brand.name} ${watch.name}`}
        className="aspect-square"
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
      />
      <span className="mt-4 block text-sm leading-snug transition group-hover:underline group-hover:underline-offset-4">
        {watch.name}
      </span>
      <span className="mt-1.5 block text-sm tabular-nums text-muted">
        {price ? `${watch.variantCount > 1 ? 'from ' : ''}${price}` : 'Price not listed'}
      </span>
      {(watch.variantCount > 1 || !watch.available) && (
        <span className="mt-0.5 block text-xs text-muted">
          {watch.variantCount > 1 && `${watch.variantCount} options`}
          {watch.variantCount > 1 && !watch.available && ' · '}
          {!watch.available && 'Out of stock'}
        </span>
      )}
    </Link>
  );
}

/**
 * One Brand in the directory.
 *
 * Typographic rather than pictorial. The old card carried art generated from
 * the slug because no logo exists in the data; on paper that decoration
 * competed with the only pictures worth showing, which are the watches. What a
 * reader needs here is the name, whether we have a view, and enough facts to
 * decide whether to open it.
 */
export function BrandCard({ brand }: { brand: BrandSummary }) {
  // Only the facts we actually hold. A card promising four drops in front of a
  // page showing two watches is the same inconsistency #28 fixed, one click
  // earlier — so both read from the same rule.
  const facts = [
    brand.country,
    brand.foundedYearEst ? `est. ${brand.foundedYearEst}` : null,
    brandTally(brand._count.watches ?? 0, brand._count.drops) ?? 'On the radar',
  ].filter(Boolean);

  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="group flex h-full items-start gap-2.5 border-b border-rule py-5"
    >
      {/* Only Curated carries a mark. Listed gets none rather than a "not
          reviewed" label: it is not a lesser tier, and marking the absence on
          a directory card would read as a warning about the brand. */}
      {brand.status === 'curated' && <CuratedMark />}
      <span className="min-w-0 flex-1">
        <span className="display block truncate text-lg transition group-hover:underline group-hover:underline-offset-4">
          {brand.name}
        </span>
        <span className="mt-1 block truncate text-sm text-muted">
          {facts.join(' · ')}
        </span>
      </span>
    </Link>
  );
}
