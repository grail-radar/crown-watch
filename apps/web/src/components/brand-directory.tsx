'use client';

import { useMemo, useState } from 'react';
import type { BrandSummary } from '@/lib/api';
import { BrandCard, CuratedMark } from './cards';

/** Brand grid with instant client-side name search. */
export function BrandDirectory({ brands }: { brands: BrandSummary[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(needle));
  }, [brands, query]);

  if (brands.length === 0) {
    return (
      <p className="max-w-xl text-muted">
        No brands to show yet — the ingestion pipeline may still be warming up
        (the API sleeps when idle). Refresh in a moment.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands…"
          aria-label="Search brands"
          className="w-full max-w-xs border-b border-rule bg-transparent py-2 text-sm outline-none transition placeholder:text-muted focus:border-ink"
        />
        {/* The mark's meaning, stated once. Without this the square is
            decoration; with it, it is the directory's most useful column. */}
        <p className="flex items-center gap-2 text-sm text-muted">
          <CuratedMark />
          <span>We&apos;ve written about these</span>
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-10 text-muted">No brands match “{query}”.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <BrandCard key={b.id} brand={b} />
          ))}
        </div>
      )}
    </>
  );
}
