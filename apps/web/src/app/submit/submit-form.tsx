'use client';

import { useState } from 'react';
import { dropTypeLabel } from '@/lib/format';

const TYPES = [
  'pre_order',
  'kickstarter_launch',
  'waitlist_open',
  'restock',
] as const;

const FIELD =
  'w-full rounded-xl border border-line bg-night px-4 py-2.5 text-sm outline-none transition placeholder:text-faint/60 focus:border-gold/60';

export function SubmitForm() {
  const [status, setStatus] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'busy') return;
    setStatus('busy');
    setError(null);

    const form = new FormData(e.currentTarget);
    const payload = {
      brand_name: form.get('brand_name'),
      title: form.get('title'),
      url: form.get('url'),
      type: form.get('type'),
      price: form.get('price'),
      currency: form.get('currency'),
      note: form.get('note'),
    };

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus('ok');
      } else {
        setStatus('error');
        setError(data.error ?? 'Something went wrong.');
      }
    } catch {
      setStatus('error');
      setError('Network error — please try again.');
    }
  }

  if (status === 'ok') {
    return (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6">
        <h2 className="font-display text-xl text-emerald-300">
          Thanks — it&apos;s in the queue
        </h2>
        <p className="mt-2 text-sm text-faint">
          Every submission is checked by a human before it appears on the radar,
          so give it a little time. Spotted another one?{' '}
          <button
            onClick={() => setStatus('idle')}
            className="text-gold underline underline-offset-4 transition hover:text-gold-bright"
          >
            Submit another drop
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm text-faint">
            Brand <span className="text-gold">*</span>
          </span>
          <input
            name="brand_name"
            required
            maxLength={80}
            placeholder="e.g. Baltic"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-faint">
            Watch / drop name <span className="text-gold">*</span>
          </span>
          <input
            name="title"
            required
            maxLength={140}
            placeholder="e.g. Aquascaphe Titanium"
            className={FIELD}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm text-faint">
          Link to the announcement or product page
        </span>
        <input
          name="url"
          type="url"
          placeholder="https://…"
          className={FIELD}
        />
      </label>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-faint">Type</span>
          <select name="type" defaultValue="pre_order" className={FIELD}>
            {TYPES.map((t) => (
              <option key={t} value={t} className="bg-night">
                {dropTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-faint">Price</span>
          <input name="price" inputMode="decimal" placeholder="499" className={FIELD} />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-faint">Currency</span>
          <input
            name="currency"
            maxLength={3}
            placeholder="USD"
            className={`${FIELD} uppercase`}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm text-faint">
          Anything else we should know?
        </span>
        <textarea
          name="note"
          rows={3}
          maxLength={500}
          placeholder="Launch date, limited run, where you saw it…"
          className={FIELD}
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={status === 'busy'}
          className="rounded-xl bg-gold px-6 py-2.5 text-sm font-medium text-night transition hover:bg-gold-bright disabled:opacity-50"
        >
          {status === 'busy' ? 'Submitting…' : 'Submit drop'}
        </button>
        <span className="text-xs text-faint">
          Reviewed by a human before publishing. No account needed.
        </span>
      </div>
    </form>
  );
}
