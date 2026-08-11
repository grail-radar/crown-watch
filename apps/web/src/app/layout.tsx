import type { Metadata } from 'next';
import Link from 'next/link';
import { Golos_Text, Noto_Serif_Display } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ReleaseNote } from '@/components/release-note';
import { SiteNav } from '@/components/site-nav';
import { TelegramIcon } from '@/components/telegram-icon';
import { TELEGRAM_CHANNELS } from '@/lib/channels';
import { themeBootScript } from '@/lib/theme';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';
import './globals.css';

/*
 * Both faces carry Cyrillic. That is a requirement, not a bonus: the site is
 * getting a Ukrainian locale, and a display face that cannot set a Brand's name
 * in Ukrainian would have to be replaced the week that lands.
 */
const displaySerif = Noto_Serif_Display({
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400'],
  variable: '--font-display-serif',
  display: 'swap',
});

const text = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-text',
  display: 'swap',
});

const DIRECTION_CONTRACT = `<!--
THESIS: A reference you consult about brands, not a shop that sells them; it
refuses the dark luxury-watch arrangement where atmosphere stands in for having
a view.
OWN-WORLD: Paper white, near-black ink, one hairline rule; no accent colour, no
radius, no shadow. A light high-contrast serif for the two things a person wrote
— a Brand's name and the judgement — and a neutral grotesque for every gathered
fact. Photographs are the only colour on the page.
STORY: The reader asks whether a Brand is worth their attention, reads one
honest sentence, sees what it costs and what they make, and leaves able to
decide.
FIRST VIEWPORT: two compositions, one world. Curated: Brand name at display
scale on paper, the judgement directly beneath it at 1.75-3.25rem in the same
serif with no label above it, the facts as one small grey line, then the plate.
Listed — the branch every live page currently renders, since no Brand is
Curated yet: name, facts, then the photograph as a 3:2 figure column leading
the viewport, and the missing judgement admitted under it in one plain line at
the size of every other fact.
FORM: The category standard, taken deliberately over six dealt directions; bar
set by A Collected Man and Hodinkee. Seed d14b9f0b.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, and DESIGN.md
-->`;

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
      className={`${displaySerif.variable} ${text.variable}`}
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
        {/*
          The direction contract, emitted as a real HTML comment.

          A JSX comment would not do: it is compile-time only and never reaches
          the markup, so nobody could audit the built page against the direction
          it was supposed to keep.
        */}
        <div hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <header className="relative border-b border-rule">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
            <Link href="/" className="display whitespace-nowrap text-xl">
              {SITE_NAME}
            </Link>
            <SiteNav />
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="mt-24 border-t border-rule">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 text-sm text-muted sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <p className="display text-lg text-ink">{SITE_NAME}</p>
              <p className="mt-3 max-w-sm leading-relaxed">
                An independent reference for microbrand watchmaking. Nothing on
                this site is paid for or sponsored.
              </p>
              <p className="mt-4 max-w-sm leading-relaxed">
                Sourced from Worn &amp; Wound, aBlogtoWatch, Monochrome Watches,
                Fratello and Hodinkee. Headlines and images belong to their
                publishers and link to the original coverage.
              </p>
            </div>

            <div>
              <p className="text-ink">Browse</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/#brands" className="transition hover:text-ink">
                    Brands
                  </Link>
                </li>
                <li>
                  <Link href="/drops" className="transition hover:text-ink">
                    All drops
                  </Link>
                </li>
                <li>
                  <Link href="/submit" className="transition hover:text-ink">
                    Submit a drop
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-ink">Instant alerts</p>
              <ul className="mt-3 space-y-2">
                {TELEGRAM_CHANNELS.map((channel) => (
                  <li key={channel.url}>
                    <a
                      href={channel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 transition hover:text-ink"
                    >
                      <TelegramIcon className="h-3.5 w-3.5" />
                      {channel.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </footer>

        <ReleaseNote />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
