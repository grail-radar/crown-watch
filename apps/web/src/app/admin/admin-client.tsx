'use client';

import { useCallback, useEffect, useState } from 'react';
import { dropTypeLabel, formatPrice, monogram, relTime } from '@/lib/format';

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
        <h1 className="display text-3xl">Moderation</h1>
        <p className="mt-2 text-sm text-muted">
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
            className="w-full border border-rule bg-plate px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-ink"
          />
          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="shrink-0 bg-ink px-4 py-2.5 text-sm font-medium text-inverse transition hover:opacity-80 disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </main>
    );
  }

  const remaining = queue.filter((d) => !decided[d.id]).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-12">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Moderation queue</h1>
          <p className="mt-1 text-sm text-muted">
            {remaining} of {total} pending — approving publishes to the live feed.
          </p>
        </div>
        <button
          onClick={() => void load(token)}
          disabled={loading}
          className="border border-rule px-4 py-2 text-sm text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="mb-6 text-sm text-danger">{error}</p>}

      {queue.length === 0 ? (
        <p className="max-w-xl text-muted">
          Queue is clear — nothing pending.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {queue.map((d) => {
            const decision = decided[d.id];
            const price = formatPrice(d.priceLow, d.priceHigh, d.currency);
            return (
              <article
                key={d.id}
                className={`overflow-hidden border bg-plate transition ${
                  decision === 'approved'
                    ? 'border-ink'
                    : decision === 'rejected'
                      ? 'border-rule opacity-50'
                      : 'border-rule'
                }`}
              >
                <div className="relative aspect-[16/10] bg-plate">
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
                      <span className="display text-4xl text-muted">
                        {monogram(d.brand.name)}
                      </span>
                    </div>
                  )}
                  <span className="absolute left-3 top-3 bg-paper px-2 py-1 text-xs text-ink">
                    {dropTypeLabel(d.type)}
                  </span>
                  {d.confidenceScore !== null && (
                    <span className="absolute right-3 top-3 bg-paper px-2 py-1 text-xs text-muted">
                      conf {Math.round(d.confidenceScore * 100)}%
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <p className="text-xs text-muted">
                    {d.brand.name}
                  </p>
                  <p className="mt-1 font-medium leading-snug">{d.title}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span>{price ?? '—'}</span>
                    <span>{relTime(d.createdAt)}</span>
                  </div>
                  {d.sourceUrl && (
                    <a
                      href={d.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-muted underline decoration-rule underline-offset-4 transition hover:text-ink"
                    >
                      Check original coverage ↗
                    </a>
                  )}

                  <div className="mt-4">
                    {decision ? (
                      <p
                        className={`text-sm font-medium ${
                          decision === 'approved' ? 'text-ink' : 'text-danger'
                        }`}
                      >
                        {decision === 'approved' ? 'Published ✓' : 'Rejected'}
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void act(d.id, 'approve')}
                          disabled={busy === d.id}
                          className="flex-1 bg-ink px-3 py-2 text-sm font-medium text-inverse transition hover:opacity-80 disabled:opacity-50"
                        >
                          {busy === d.id ? '…' : 'Approve & publish'}
                        </button>
                        <button
                          onClick={() => void act(d.id, 'reject')}
                          disabled={busy === d.id}
                          className="border border-rule px-3 py-2 text-sm text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
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
