import type { Metadata } from 'next';
import Link from 'next/link';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ReleaseNote } from '@/components/release-note';
import { TelegramIcon } from '@/components/telegram-icon';
import { ThemeSwitch } from '@/components/theme-switch';
import { TELEGRAM_CHANNELS } from '@/lib/channels';
import { themeBootScript } from '@/lib/theme';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the reader's theme before the first paint. Inline and blocking
          on purpose: anything deferred renders the default palette first, and
          the correction is visible as a flash on every load.

          It sets `data-theme` on <html>, which React did not render — hence
          suppressHydrationWarning above, scoped to this one element.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <header className="border-b border-line/70">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-4">
            <Link
              href="/"
              className="whitespace-nowrap font-display text-lg tracking-tight"
            >
              <span className="text-gold">Crown</span> Watch
            </Link>
            <nav className="flex items-center gap-3.5 text-sm text-faint sm:gap-6">
              <Link href="/drops" className="transition hover:text-ink">
                Drops
              </Link>
              <Link href="/#brands" className="transition hover:text-ink">
                Brands
              </Link>
              <Link href="/submit" className="hidden transition hover:text-ink sm:inline">
                Submit
              </Link>
              {/* Telegram is the instant channel; the digest is the weekly one.
                  Both live in the header so neither is buried. */}
              <a
                href={TELEGRAM_CHANNELS[0].url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Crown Watch on Telegram — ${TELEGRAM_CHANNELS[0].handle}`}
                className="flex items-center gap-1.5 transition hover:text-ink"
              >
                <TelegramIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Telegram</span>
              </a>
              {/* The theme switch costs about 80px of header. Below `sm` the
                  CTA gives back roughly that much rather than the row wrapping
                  onto three lines. */}
              <Link
                href="/#digest"
                className="whitespace-nowrap rounded-full border border-gold/40 px-3.5 py-1.5 text-gold transition hover:border-gold hover:text-gold-bright"
              >
                <span className="sm:hidden">Digest</span>
                <span className="hidden sm:inline">Get the digest</span>
              </Link>
              <ThemeSwitch />
            </nav>
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-line/70">
          <div className="mx-auto w-full max-w-6xl px-6 py-8 text-xs leading-relaxed text-faint">
            <p>
              <span className="font-display text-sm text-ink">
                <span className="text-gold">Crown</span> Watch
              </span>{' '}
              — an independent radar for microbrand watch drops.
            </p>
            <p className="mt-2">
              Sourced from Worn &amp; Wound, aBlogtoWatch, Monochrome Watches,
              Fratello and Hodinkee. Headlines and images belong to their
              publishers and link to the original coverage.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-faint">Instant alerts on Telegram:</span>
              {TELEGRAM_CHANNELS.map((channel) => (
                <a
                  key={channel.url}
                  href={channel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-ink transition hover:border-gold/50 hover:text-gold-bright"
                >
                  <TelegramIcon className="h-3.5 w-3.5 text-gold" />
                  {channel.label}
                  <span className="text-faint">{channel.handle}</span>
                </a>
              ))}
            </div>

            <p className="mt-4">
              <Link href="/submit" className="text-gold transition hover:text-gold-bright">
                Submit a drop
              </Link>
              <span className="mx-2 text-line">·</span>
              <Link href="/drops" className="transition hover:text-ink">
                All drops
              </Link>
            </p>
          </div>
        </footer>

        <ReleaseNote />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
