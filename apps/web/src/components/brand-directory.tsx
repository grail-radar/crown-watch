'use client';

import { useMemo, useState } from 'react';
import type { BrandSummary } from '@/lib/api';
import { BrandCard } from './cards';

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
      <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
        No brands to show yet — the ingestion pipeline may still be warming up
        (the API sleeps when idle). Refresh in a moment.
      </p>
    );
  }

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search brands…"
        aria-label="Search brands"
        className="mb-6 w-full max-w-sm rounded-xl border border-line bg-panel px-4 py-2.5 text-sm outline-none transition placeholder:text-faint/60 focus:border-gold/60"
      />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
          No brands match “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <BrandCard key={b.id} brand={b} />
          ))}
        </div>
      )}
    </>
  );
}
