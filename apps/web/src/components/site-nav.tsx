'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TelegramIcon } from './telegram-icon';
import { ThemeSwitch } from './theme-switch';
import { TELEGRAM_CHANNELS } from '@/lib/channels';

const LINKS = [
  { href: '/drops', label: 'Drops' },
  { href: '/#brands', label: 'Brands' },
  { href: '/submit', label: 'Submit' },
];

/**
 * The header's navigation.
 *
 * Laid out twice rather than shrunk: the row that fits a desktop does not fit
 * 375px, and shaving gaps until it *almost* fits is how a header ends up with
 * its last control off-screen. Below `sm` everything collapses behind a named
 * Menu — a word rather than a hamburger, because this world draws no icons it
 * does not need.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page beneath must not scroll under an open panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Desktop */}
      <nav className="hidden items-center gap-7 text-sm text-muted sm:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="transition hover:text-ink">
            {l.label}
          </Link>
        ))}
        <a
          href={TELEGRAM_CHANNELS[0].url}
          target="_blank"
          rel="noopener noreferrer"
          title={`Crown Watch on Telegram — ${TELEGRAM_CHANNELS[0].handle}`}
          className="flex items-center gap-1.5 transition hover:text-ink"
        >
          <TelegramIcon className="h-4 w-4" />
          Telegram
        </a>
        {/*
          A text link, not a filled button. A black rectangle here would be the
          loudest object in every first viewport on the site, and what it sells
          is a mailing list — on a page whose subject is a brand, that outranks
          the brand's own name. A fill is earned only where the action is the
          section's own subject: the digest form, and a store link on a Drop.
        */}
        <Link
          href="/#digest"
          className="whitespace-nowrap text-ink underline decoration-rule underline-offset-4 transition hover:decoration-ink"
        >
          Get the digest
        </Link>
        <ThemeSwitch />
      </nav>

      {/* Mobile */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-menu"
        className="text-sm text-muted transition hover:text-ink sm:hidden"
      >
        {open ? 'Close' : 'Menu'}
      </button>

      {open && (
        <div
          id="site-menu"
          ref={panelRef}
          className="absolute inset-x-0 top-full z-40 border-b border-rule bg-paper px-6 py-6 sm:hidden"
        >
          <ul className="flex flex-col gap-4 text-lg">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={TELEGRAM_CHANNELS[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <TelegramIcon className="h-4 w-4" />
                Telegram
              </a>
            </li>
          </ul>

          <Link
            href="/#digest"
            onClick={() => setOpen(false)}
            className="mt-6 block bg-ink px-4 py-3 text-center text-inverse"
          >
            Get the digest
          </Link>

          <div className="mt-6 flex items-center justify-between border-t border-rule pt-4 text-sm text-muted">
            <span>Theme</span>
            <ThemeSwitch />
          </div>
        </div>
      )}
    </>
  );
}
