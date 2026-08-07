/**
 * A visual identity for every brand, derived from its slug.
 *
 * Brands have no logo in the data, and the images we do hold belong to the
 * publications the drops came from — a thumbnail linking back to an article is
 * attribution, the same photo stretched behind a brand's name is not. So the
 * art is generated rather than borrowed: nothing is scraped, no rights are
 * used, and a brand we know almost nothing about still gets a page that looks
 * deliberate.
 *
 * Derived from the slug rather than the name, because the slug is stable — a
 * brand renamed from "Lorier" to "Lorier Watch Co." keeps its colours.
 */

/** FNV-1a. Small, stable across runs and platforms, good enough spread. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The brand's hue, 0–359.
 *
 * Multiplied by a large step before wrapping so that slugs sharing a prefix —
 * of which a watch directory has plenty — land far apart on the wheel instead
 * of looking like the same brand.
 */
export function brandHue(slug: string): number {
  return (hash(slug) * 47) % 360;
}

/**
 * Angle and highlight position, from bits of the hash the hue does not use.
 *
 * Hue alone is not enough: 25 brands drawn from 360 hues collide more often
 * than not, and the directory already has one exact pair. Varying the geometry
 * independently means two brands sharing a hue still look like two brands.
 */
function brandGeometry(slug: string): { angle: number; highlightX: number } {
  const h = hash(slug);
  return {
    angle: 105 + ((h >>> 7) % 70),
    highlightX: 8 + ((h >>> 13) % 62),
  };
}

/**
 * The brand's own variables: hue and geometry, and nothing else.
 *
 * The gradients themselves live in `globals.css`, against `.brand-banner` and
 * `.brand-avatar`. The split is deliberate — **hue belongs to the brand,
 * lightness belongs to the theme**. Baked-in lightness was correct while the
 * site was dark-only, and became a near-black band sitting on a white card the
 * moment a light theme existed. An inline style cannot answer to `data-theme`;
 * a custom property can.
 */
export function brandBannerStyle(slug: string): React.CSSProperties {
  const h = brandHue(slug);
  const { angle, highlightX } = brandGeometry(slug);

  return {
    '--brand-h': String(h),
    // The second hue keeps the diagonal from reading as a flat wash.
    '--brand-h2': String((h + 35) % 360),
    '--brand-angle': `${angle}deg`,
    '--brand-x': `${highlightX}%`,
  } as React.CSSProperties;
}

/** Avatar that belongs to the same banner rather than sitting on it by accident. */
export function brandAvatarStyle(slug: string): React.CSSProperties {
  return { '--brand-h': String(brandHue(slug)) } as React.CSSProperties;
}
