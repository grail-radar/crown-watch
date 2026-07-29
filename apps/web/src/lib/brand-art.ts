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
 * Banner background.
 *
 * Three layers: a soft off-centre highlight, a diagonal base gradient, and a
 * faint pinstripe for texture. Lightness stays low throughout — this sits in a
 * dark editorial palette, and anything brighter would fight the gold accent and
 * the white text sitting on it.
 */
export function brandBannerStyle(slug: string): React.CSSProperties {
  const h = brandHue(slug);
  const h2 = (h + 35) % 360;
  const { angle, highlightX } = brandGeometry(slug);

  return {
    backgroundImage: [
      `radial-gradient(120% 120% at ${highlightX}% 0%, hsl(${h} 42% 24% / 0.95), transparent 62%)`,
      `repeating-linear-gradient(${angle}deg, hsl(0 0% 100% / 0.028) 0 1px, transparent 1px 15px)`,
      `linear-gradient(135deg, hsl(${h} 34% 16%), hsl(${h2} 28% 9%))`,
    ].join(','),
  };
}

/** Avatar that belongs to the same banner rather than sitting on it by accident. */
export function brandAvatarStyle(slug: string): React.CSSProperties {
  const h = brandHue(slug);
  return {
    backgroundImage: `linear-gradient(150deg, hsl(${h} 30% 18%), hsl(${h} 26% 10%))`,
    boxShadow: `inset 0 0 0 1px hsl(${h} 38% 34% / 0.55)`,
  };
}
