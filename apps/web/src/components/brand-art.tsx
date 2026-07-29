import { brandAvatarStyle, brandBannerStyle } from '@/lib/brand-art';
import { monogram } from '@/lib/format';

/**
 * The generated band behind a brand's name. Decorative, so it is hidden from
 * assistive technology — it carries no information a screen reader needs.
 */
export function BrandBanner({
  slug,
  className = '',
}: {
  slug: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      style={brandBannerStyle(slug)}
      className={`w-full ${className}`}
    />
  );
}

/**
 * The brand's lettermark, coloured to match its banner so the two read as one
 * piece rather than a circle dropped on a background.
 */
export function BrandAvatar({
  name,
  slug,
  className = 'h-11 w-11 text-sm',
}: {
  name: string;
  slug: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={brandAvatarStyle(slug)}
      className={`flex shrink-0 items-center justify-center rounded-full font-display text-gold ${className}`}
    >
      {monogram(name)}
    </span>
  );
}
