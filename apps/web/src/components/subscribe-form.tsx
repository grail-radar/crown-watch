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
        setMessage("You're on the list — first digest lands soon.");
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

  if (status === 'ok') {
    return (
      <p className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex max-w-md flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-xl border border-line bg-night px-4 py-2.5 text-sm outline-none transition placeholder:text-faint/60 focus:border-gold/60"
      />
      <button
        type="submit"
        disabled={status === 'busy'}
        className="shrink-0 rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-night transition hover:bg-gold-bright disabled:opacity-50"
      >
        {status === 'busy' ? 'Joining…' : 'Join the digest'}
      </button>
      {status === 'error' && message && (
        <p className="text-sm text-red-400 sm:absolute sm:mt-12">{message}</p>
      )}
    </form>
  );
}
