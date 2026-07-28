'use client';

import { useEffect, useRef, useState } from 'react';
import { TELEGRAM_CHANNELS } from '@/lib/channels';
import { TelegramIcon } from './telegram-icon';

/**
 * Bump this when there is a new note to show. Dismissals are stored per key, so
 * a new key shows the note again to everyone — and an old key stays dismissed
 * forever, which is what stops this becoming a nag.
 */
const RELEASE_KEY = 'crown-watch:release:2026-07-telegram';

const HIGHLIGHTS = [
  {
    icon: '🆕',
    title: 'New releases, the moment they land',
    body: 'We watch brands’ own stores directly — you hear about a watch when it appears, not when an article gets written about it.',
  },
  {
    icon: '♻️',
    title: 'Restock alerts',
    body: 'A sold-out reference coming back in stock is its own alert. That’s the one people miss.',
  },
  {
    icon: '🔗',
    title: 'Everything in one message',
    body: 'Brand, model, price, and a link straight to the source — no digging.',
  },
  {
    icon: '🔕',
    title: 'Never the same drop twice',
    body: 'Each drop is posted once and only once. No repeats, no noise.',
  },
];

export function ReleaseNote() {
  // Starts closed and opens after mount: the server has no idea what this
  // visitor has already dismissed, so rendering it open would flash the note at
  // people who closed it days ago.
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(RELEASE_KEY)) setOpen(true);
    } catch {
      // Private mode or storage disabled — skip the note rather than risk
      // showing it on every single page view.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(RELEASE_KEY, new Date().toISOString());
    } catch {
      // Not being able to remember the dismissal is survivable; failing to
      // close the dialog is not.
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-note-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-faint transition hover:bg-panel-2 hover:text-ink"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="border-b border-line/70 px-6 py-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gold">
            New
          </p>
          <h2
            id="release-note-title"
            className="mt-1.5 font-display text-2xl leading-tight tracking-tight"
          >
            Crown Watch is now on Telegram
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-faint">
            Drop alerts now reach your phone the moment we spot them — in
            English and Ukrainian.
          </p>
        </div>

        <ul className="divide-y divide-line/50 px-6">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title} className="flex gap-3 py-3.5">
              <span aria-hidden="true" className="mt-0.5 text-base leading-none">
                {item.icon}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-faint">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-2 px-6 pb-5 pt-4">
          {TELEGRAM_CHANNELS.map((channel) => (
            <a
              key={channel.url}
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/40 px-4 py-3 transition hover:border-gold hover:bg-gold/5"
            >
              <span className="flex items-center gap-2.5">
                <TelegramIcon className="h-4 w-4 text-gold" />
                <span className="text-sm font-medium text-ink">
                  Join {channel.label}
                </span>
              </span>
              <span className="text-xs text-faint">{channel.handle}</span>
            </a>
          ))}
          <button
            type="button"
            onClick={dismiss}
            className="w-full pt-1 text-center text-xs text-faint transition hover:text-ink"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
