/**
 * Broadcast message templates.
 *
 * A drop alert is a template with substituted fields, never written prose:
 * adding a language is translating the handful of strings in `STRINGS` once,
 * not writing a post per drop. `renderDropAlert` is the only thing that knows
 * how a message is laid out, and it is the same layout in every language — the
 * locales differ solely in the strings they supply.
 */
import { DropType } from '@prisma/client';
import { PurchaseLink } from '../drops/purchase-link';

/** Languages we broadcast in. One public Telegram channel per locale. */
export type AlertLocale = 'uk' | 'en';

export const ALERT_LOCALES: readonly AlertLocale[] = ['uk', 'en'] as const;

/** Everything a drop alert says, minus the drop's own data. */
interface AlertStrings {
  /** Headline per drop type — the "what kind of event is this" line. */
  headline: Record<DropType, string>;
  price: string;
  /** Label when the link goes to the brand's own product page. */
  productLink: string;
  /**
   * Label when the link goes to the brand's homepage rather than the watch.
   * Distinct from both the others on purpose: it is not somewhere to buy this
   * particular watch, and it is not coverage.
   */
  brandSiteLink: string;
  /** Label when the link goes to a publication's article about the drop. */
  coverageLink: string;
  /** Label for the brand's page on Crown Watch itself. */
  brandLink: string;
}

const STRINGS: Record<AlertLocale, AlertStrings> = {
  uk: {
    headline: {
      pre_order: '🆕 Новий реліз',
      restock: '♻️ Знову в наявності',
      waitlist_open: '📋 Відкрито лист очікування',
      kickstarter_launch: '🚀 Старт на Kickstarter',
    },
    price: 'Ціна',
    productLink: 'Купити в бренда',
    brandSiteLink: 'Сайт бренда',
    coverageLink: 'Читати огляд',
    brandLink: 'Бренд на Crown Watch',
  },
  en: {
    headline: {
      pre_order: '🆕 New release',
      restock: '♻️ Back in stock',
      waitlist_open: '📋 Waitlist open',
      kickstarter_launch: '🚀 Kickstarter launch',
    },
    price: 'Price',
    productLink: 'Buy from the brand',
    brandSiteLink: 'Visit the brand',
    coverageLink: 'Read the coverage',
    brandLink: 'Brand on Crown Watch',
  },
};

/** The drop data a message is built from — `title` is the drop's own title. */
export interface DropAlert {
  brandName: string;
  brandSlug: string;
  title: string;
  type: DropType;
  price: number | null;
  currency: string | null;
  /**
   * Where a reader can act, decided by the shared rule so the channels and the
   * website can never classify the same drop differently. Null when there is
   * nothing honest to offer.
   */
  purchase: PurchaseLink | null;
  /**
   * The publication's article, when the drop came from one. Kept separate from
   * `purchase` because it is attribution, not somewhere to buy (CONTEXT.md §6):
   * telling a reader to buy and handing them a magazine is a lie.
   */
  coverageUrl: string | null;
}

/**
 * Telegram parses our messages as HTML, and both titles and product URLs come
 * from a third-party store. Quotes are escaped as well as angle brackets
 * because a URL is interpolated into an `href="..."` attribute below, where a
 * bare quote would end the attribute and let the rest of the URL become markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The whole price string, currency included. Prices arrive as a Decimal(12,2)
 * and so render as "650.00"; trailing zeros read as noise in a chat.
 */
function priceLine(alert: DropAlert): string | null {
  if (alert.price === null || !Number.isFinite(alert.price)) return null;
  const amount = String(alert.price);
  return alert.currency ? `${amount} ${alert.currency}` : amount;
}

/**
 * Render one drop as a Telegram HTML message in the given language.
 *
 * Pure: the same drop always renders the same bytes, which is what lets the
 * dispatcher be tested by asserting on the strings it would have sent.
 */
export function renderDropAlert(
  locale: AlertLocale,
  alert: DropAlert,
  publicWebUrl: string,
): string {
  const s = STRINGS[locale];
  const brandUrl = `${publicWebUrl.replace(/\/$/, '')}/brands/${alert.brandSlug}`;
  const price = priceLine(alert);

  const lines = [
    s.headline[alert.type],
    `<b>${escapeHtml(alert.brandName)}</b> — ${escapeHtml(alert.title)}`,
  ];
  if (price) lines.push(`${s.price}: ${escapeHtml(price)}`);

  // Where to act comes first, because it is what the reader wants; the article
  // follows as attribution. A drop can carry both — a brand's own site plus the
  // coverage that surfaced it — and they are never the same link.
  if (alert.purchase) {
    const label =
      alert.purchase.kind === 'store' ? s.productLink : s.brandSiteLink;
    lines.push(`<a href="${escapeHtml(alert.purchase.url)}">${label}</a>`);
  }
  if (alert.coverageUrl) {
    lines.push(`<a href="${escapeHtml(alert.coverageUrl)}">${s.coverageLink}</a>`);
  }
  lines.push(`<a href="${escapeHtml(brandUrl)}">${s.brandLink}</a>`);

  return lines.join('\n');
}
