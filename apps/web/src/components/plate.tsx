'use client';

import { useState } from 'react';

/**
 * A photograph, mounted.
 *
 * Every image on the site goes through here, and that is the point. The sources
 * are brands' own stores plus publishers' article images, which arrive as
 * everything from a white packshot to a wrist shot on a beach. On a world with
 * no card, no border and no radius to hide behind, an unnormalised grid is the
 * failure mode — so one rule is applied to all of them:
 *
 * - `contain` by default, which is every grid on the site: a packshot cropped
 *   to fill loses the watch, and a wide shot letterboxed on the plate loses
 *   nothing. `cover` is opt-in and used in exactly one place — the Brand
 *   page's lead — where letterboxing would fill the first viewport with plate
 *   instead of subject.
 * - a plate ground a hair off the page, so a white packshot still has an edge
 *   and a dark one does not read as a hole.
 *
 * A missing or blocked image renders the bare plate rather than a placeholder
 * graphic: an empty frame is honest, and publisher CDNs do block hotlinks.
 */
export function Plate({
  src,
  alt,
  className = '',
  priority = false,
  sizes,
  fit = 'contain',
  caption,
}: {
  src: string | null;
  alt: string;
  /** Aspect and any layout classes. The plate always fills its box. */
  className?: string;
  /** True for the one image above the fold; it is the LCP element. */
  priority?: boolean;
  sizes?: string;
  /**
   * `contain` in grids, where a cropped packshot loses the watch. `cover` on a
   * lead photograph, where the image is the subject and the letterboxing would
   * be the largest thing above the fold.
   */
  fit?: 'contain' | 'cover';
  /** Whose photograph this is. Shown under the plate, quietly. */
  caption?: string;
}) {
  const [failed, setFailed] = useState(false);
  const empty = !src || failed;

  const plate = (
    <div className={`relative overflow-hidden bg-plate ${className}`}>
      {!empty && (
        // Not next/image: these are third-party URLs on arbitrary hosts, which
        // the optimiser needs configuring one domain at a time.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          sizes={sizes}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="plate-img"
          style={{ objectFit: fit }}
        />
      )}
    </div>
  );

  if (!caption) return plate;

  // Provenance at the image rather than only in the footer: every photograph on
  // this site belongs to somebody else, and the caption is where a reference
  // work says so.
  return (
    <figure>
      {plate}
      <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
