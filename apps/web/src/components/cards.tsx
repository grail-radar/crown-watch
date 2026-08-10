import Link from 'next/link';
import type {
  BrandSummary,
  BrandWatchSummary,
  DropSummary,
} from '@/lib/api';
import {
  brandTally,
  dropTypeBadgeClass,
  dropTypeLabel,
  formatPrice,
  monogram,
  relTime,
} from '@/lib/format';
import { BrandAvatar, BrandBanner } from './brand-art';
import { DropImage } from './drop-image';
import { PurchaseTag } from './purchase-button';

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide ring-1 ${dropTypeBadgeClass(type)}`}
    >
      {dropTypeLabel(type)}
    </span>
  );
}

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
  const media = (
    <div className="relative aspect-[16/10] overflow-hidden bg-panel-2">
      <DropImage
        src={drop.imageUrl}
        alt={`${brand.name} — ${drop.title}`}
        fallback={monogram(brand.name)}
      />
      <div className="absolute left-3 top-3">
        <TypeBadge type={drop.type} />
      </div>
    </div>
  );

  return (
    <article className="group overflow-hidden rounded-2xl border border-line/80 bg-panel transition duration-300 hover:-translate-y-0.5 hover:border-gold/40">
      <Link href={href} aria-label={`${brand.name} — ${drop.title}`}>
        {media}
      </Link>

      <div className="p-4">
        {showBrand && (
          <Link
            href={`/brands/${brand.slug}`}
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold transition hover:text-gold-bright"
          >
            {brand.name}
          </Link>
        )}

        <Link
          href={href}
          className="mt-1 block font-medium leading-snug text-ink decoration-gold/50 underline-offset-4 transition hover:underline"
        >
          {drop.title}
        </Link>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-faint">
          <span>{price ?? dropTypeLabel(drop.type)}</span>
          <span className="flex items-center gap-2">
            {added && <span>{added}</span>}
            {/* Lets a reader see which drops they can act on without opening
                each one. Renders nothing when there is nowhere honest to send
                them. */}
            <PurchaseTag purchase={drop.purchase} brandName={brand.name} />
          </span>
        </div>

        {drop.sourceName && (
          <div className="mt-3 border-t border-line/70 pt-2.5 text-[11px] text-faint">
            via {drop.sourceName} ↗
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * One Watch as the brand page lists it — a photo, what it is called, and what
 * the cheapest way to have it costs.
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
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel transition duration-300 hover:-translate-y-0.5 hover:border-gold/40"
    >
      <span className="block aspect-square overflow-hidden bg-panel-2">
        {watch.imageUrl ? (
          // Not next/image: third-party store URLs on arbitrary hosts, which
          // the optimiser needs configuring for one domain at a time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={watch.imageUrl}
            alt={`${brand.name} ${watch.name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center font-display text-2xl text-faint">
            {monogram(brand.name)}
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col p-3">
        <span className="line-clamp-2 text-sm leading-snug text-ink">
          {watch.name}
        </span>
        <span className="mt-1.5 text-xs text-faint">
          {price
            ? `${watch.variantCount > 1 ? 'from ' : ''}${price}`
            : 'Price not listed'}
        </span>
        <span className="mt-0.5 text-xs text-faint">
          {watch.variantCount > 1 && `${watch.variantCount} options`}
          {watch.variantCount > 1 && !watch.available && ' · '}
          {!watch.available && 'Out of stock'}
        </span>
      </span>
    </Link>
  );
}

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
      className="group overflow-hidden rounded-2xl border border-line/80 bg-panel transition duration-300 hover:-translate-y-0.5 hover:border-gold/40"
    >
      {/* Generated from the slug, so two brands with no drops are still told
          apart at a glance — which a grid of identical lettermarks could not. */}
      <BrandBanner slug={brand.slug} className="h-14" />

      <span className="flex items-start gap-3 px-4 pb-4">
        <BrandAvatar
          name={brand.name}
          slug={brand.slug}
          className="-mt-5 h-11 w-11 text-sm ring-2 ring-panel"
        />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{brand.name}</span>
            {/* Only Curated carries a badge. Listed gets none rather than a
                grey "unreviewed" chip: it is not a lesser tier, and marking
                the absence on a directory card would read as a warning. */}
            {brand.status === 'curated' && (
              <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold ring-1 ring-gold/25">
                Curated
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-xs text-faint">
            {facts.join(' · ')}
          </span>
        </span>
        <span className="pt-0.5 text-faint transition group-hover:translate-x-0.5 group-hover:text-gold">
          →
        </span>
      </span>
    </Link>
  );
}
