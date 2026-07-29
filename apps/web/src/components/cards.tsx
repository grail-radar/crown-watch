import Link from 'next/link';
import type { BrandSummary, DropSummary } from '@/lib/api';
import {
  dropTypeBadgeClass,
  dropTypeLabel,
  formatPrice,
  monogram,
  relTime,
} from '@/lib/format';
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
      <Link href={`/drops/${drop.id}`} aria-label={`${brand.name} — ${drop.title}`}>
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
          href={`/drops/${drop.id}`}
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

export function BrandCard({ brand }: { brand: BrandSummary }) {
  const published = brand._count.drops;
  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="group flex items-center gap-4 rounded-2xl border border-line/80 bg-panel p-4 transition duration-300 hover:-translate-y-0.5 hover:border-gold/40"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-panel-2 to-night font-display text-sm text-gold ring-1 ring-line">
        {monogram(brand.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{brand.name}</span>
          {brand.status === 'verified' && (
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/25">
              Verified
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-faint">
          {published > 0
            ? `${published} published drop${published === 1 ? '' : 's'}`
            : 'Tracked — no published drops yet'}
        </span>
      </span>
      <span className="text-faint transition group-hover:translate-x-0.5 group-hover:text-gold">
        →
      </span>
    </Link>
  );
}
