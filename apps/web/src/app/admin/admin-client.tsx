'use client';

import { useCallback, useEffect, useState } from 'react';
import { dropTypeBadgeClass, dropTypeLabel, formatPrice, monogram, relTime } from '@/lib/format';

interface QueueDrop {
  id: string;
  title: string;
  type: string;
  priceLow: string | null;
  priceHigh: string | null;
  currency: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  confidenceScore: number | null;
  createdAt: string;
  brand: { name: string; slug: string };
}

type Decision = 'approved' | 'rejected';

const TOKEN_KEY = 'cw-admin-token';

export function AdminClient({ apiUrl }: { apiUrl: string }) {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<QueueDrop[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Decision>>({});

  const load = useCallback(
    async (tok: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/moderation/queue?take=100`, {
          headers: { 'x-admin-token': tok },
        });
        if (res.status === 401) throw new Error('Invalid admin token.');
        if (res.status === 503)
          throw new Error('Moderation is disabled on the API (ADMIN_TOKEN not set).');
        if (!res.ok) throw new Error(`Could not load the queue (HTTP ${res.status}).`);
        const data = (await res.json()) as { total: number; drops: QueueDrop[] };
        setQueue(data.drops);
        setTotal(data.total);
        setDecided({});
        setAuthed(true);
        window.sessionStorage.setItem(TOKEN_KEY, tok);
      } catch (e) {
        setAuthed(false);
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'Network error — if this persists, allow this site origin via WEB_ORIGIN on the API.',
        );
      } finally {
        setLoading(false);
      }
    },
    [apiUrl],
  );

  // Resume a saved session token.
  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      void load(saved);
    }
  }, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/moderation/drops/${id}/${action}`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      if (!res.ok) throw new Error(`${action} failed (HTTP ${res.status}).`);
      setDecided((d) => ({ ...d, [id]: action === 'approve' ? 'approved' : 'rejected' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-24">
        <h1 className="font-display text-3xl tracking-tight">Moderation</h1>
        <p className="mt-2 text-sm text-faint">
          Enter the admin token (the API&apos;s <code>ADMIN_TOKEN</code>) to review
          pending drops.
        </p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void load(token.trim());
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin token"
            className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm outline-none transition placeholder:text-faint/60 focus:border-gold/60"
          />
          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="shrink-0 rounded-xl bg-gold px-4 py-2.5 text-sm font-medium text-on-gold transition hover:bg-gold-bright disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </main>
    );
  }

  const remaining = queue.filter((d) => !decided[d.id]).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-12">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Moderation queue</h1>
          <p className="mt-1 text-sm text-faint">
            {remaining} of {total} pending — approving publishes to the live feed.
          </p>
        </div>
        <button
          onClick={() => void load(token)}
          disabled={loading}
          className="rounded-xl border border-line px-4 py-2 text-sm text-faint transition hover:border-gold/50 hover:text-ink disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="mb-6 text-sm text-red-400">{error}</p>}

      {queue.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-faint">
          Queue is clear — nothing pending. 🎉
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {queue.map((d) => {
            const decision = decided[d.id];
            const price = formatPrice(d.priceLow, d.priceHigh, d.currency);
            return (
              <article
                key={d.id}
                className={`overflow-hidden rounded-2xl border bg-panel transition ${
                  decision === 'approved'
                    ? 'border-emerald-400/50'
                    : decision === 'rejected'
                      ? 'border-red-400/40 opacity-60'
                      : 'border-line/80'
                }`}
              >
                <div className="relative aspect-[16/10] bg-panel-2">
                  {d.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={d.imageUrl}
                      alt={d.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-display text-5xl text-gold/30">
                        {monogram(d.brand.name)}
                      </span>
                    </div>
                  )}
                  <span
                    className={`absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${dropTypeBadgeClass(d.type)}`}
                  >
                    {dropTypeLabel(d.type)}
                  </span>
                  {d.confidenceScore !== null && (
                    <span className="absolute right-3 top-3 rounded-full bg-scrim/80 px-2.5 py-1 text-[11px] text-faint">
                      conf {Math.round(d.confidenceScore * 100)}%
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold">
                    {d.brand.name}
                  </p>
                  <p className="mt-1 font-medium leading-snug">{d.title}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-faint">
                    <span>{price ?? '—'}</span>
                    <span>{relTime(d.createdAt)}</span>
                  </div>
                  {d.sourceUrl && (
                    <a
                      href={d.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-faint underline decoration-line underline-offset-4 transition hover:text-ink"
                    >
                      Check original coverage ↗
                    </a>
                  )}

                  <div className="mt-4">
                    {decision ? (
                      <p
                        className={`text-sm font-medium ${
                          decision === 'approved' ? 'text-emerald-300' : 'text-red-300'
                        }`}
                      >
                        {decision === 'approved' ? 'Published ✓' : 'Rejected'}
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void act(d.id, 'approve')}
                          disabled={busy === d.id}
                          className="flex-1 rounded-xl bg-gold px-3 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-bright disabled:opacity-50"
                        >
                          {busy === d.id ? '…' : 'Approve & publish'}
                        </button>
                        <button
                          onClick={() => void act(d.id, 'reject')}
                          disabled={busy === d.id}
                          className="rounded-xl border border-line px-3 py-2 text-sm text-faint transition hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
