import type { Metadata } from 'next';
import Link from 'next/link';
import { Fraunces, Instrument_Sans } from 'next/font/google';
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
    <html lang="en" className={`${fraunces.variable} ${instrument.variable}`}>
      <body className="flex min-h-screen flex-col">
        <header className="border-b border-line/70">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-display text-lg tracking-tight">
              <span className="text-gold">Crown</span> Watch
            </Link>
            <nav className="flex items-center gap-5 text-sm text-faint sm:gap-6">
              <Link href="/drops" className="transition hover:text-ink">
                Drops
              </Link>
              <Link href="/#brands" className="transition hover:text-ink">
                Brands
              </Link>
              <Link href="/submit" className="hidden transition hover:text-ink sm:inline">
                Submit
              </Link>
              <Link
                href="/#digest"
                className="rounded-full border border-gold/40 px-3.5 py-1.5 text-gold transition hover:border-gold hover:text-gold-bright"
              >
                Get the digest
              </Link>
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
            <p className="mt-3">
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
      </body>
    </html>
  );
}
