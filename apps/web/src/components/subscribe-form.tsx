'use client';

import { useState } from 'react';

type Status = 'idle' | 'busy' | 'ok' | 'error';

export function SubscribeForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'busy') return;
    setStatus('busy');
    setMessage(null);
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setStatus('ok');
        setMessage("You're on the list — the first digest lands soon.");
        setEmail('');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Something went wrong — try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error — try again shortly.');
    }
  }

  // Success replaces the form rather than appending to it, and says what
  // happens next rather than congratulating anybody.
  if (status === 'ok') {
    return <p className="mt-8 border-t border-ink pt-4 text-sm">{message}</p>;
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="block text-sm text-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 w-full border-b border-rule bg-transparent py-2 outline-none transition placeholder:text-muted focus:border-ink"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'busy'}
          className="shrink-0 bg-ink px-5 py-2.5 text-sm text-inverse transition hover:opacity-80 disabled:opacity-50"
        >
          {status === 'busy' ? 'Joining…' : 'Join the digest'}
        </button>
      </div>
      {status === 'error' && message && (
        <p className="mt-3 text-sm text-danger">{message}</p>
      )}
    </form>
  );
}
