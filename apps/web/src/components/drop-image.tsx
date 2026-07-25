'use client';

import { useState } from 'react';

/**
 * Article thumbnail with a graceful monogram fallback when the image is
 * missing or fails to load (publisher CDNs occasionally block hotlinks).
 */
export function DropImage({
  src,
  alt,
  fallback,
}: {
  src: string | null;
  alt: string;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-night">
        <span className="font-display text-5xl text-gold/30">{fallback}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
    />
  );
}
