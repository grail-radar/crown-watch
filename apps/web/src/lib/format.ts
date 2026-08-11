/** Display helpers shared across the site. */

const TYPE_LABELS: Record<string, string> = {
  kickstarter_launch: 'Kickstarter',
  waitlist_open: 'Waitlist open',
  restock: 'Restock',
  pre_order: 'Pre-order',
};

export function dropTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

/*
 * There is deliberately no per-type colour here any more. Four tinted chips
 * were four accent colours on a site whose only colour is its photographs, and
 * a Restock is not a warning: the type is a fact about the event and reads as
 * one word beside the date.
 */

/** "299–349 USD" → localized "\$299–\$349" when a currency is known. */
export function formatPrice(
  low: string | null,
  high: string | null,
  currency: string | null,
): string | null {
  if (!low && !high) return null;
  const fmt = (value: string): string => {
    const n = Number(value);
    if (Number.isNaN(n)) return value;
    if (currency) {
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        }).format(n);
      } catch {
        // unknown currency code — fall through to plain formatting
      }
    }
    return n.toLocaleString('en-US');
  };
  if (low && high && low !== high) return `${fmt(low)}–${fmt(high)}`;
  return fmt((low ?? high) as string);
}

/**
 * What a brand has to show for itself, in one phrase — "12 watches", "3 drops",
 * or null when it has neither yet.
 *
 * Watches first, because that is what a reader counts on the page: YEMA read
 * "4 drops tracked" for what a reader sees as two watches (#28). A brand we
 * follow only through a publication's RSS has no catalogue of its own indexed,
 * and falls back to its drops rather than claiming to make nothing.
 *
 * One function rather than the same cascade written out on the brand page, the
 * directory card and the social image — three places that have to agree, and
 * had drifted apart once already.
 */
export function brandTally(watches: number, drops: number): string | null {
  if (watches > 0) return `${watches} watch${watches === 1 ? '' : 'es'}`;
  if (drops > 0) return `${drops} drop${drops === 1 ? '' : 's'}`;
  return null;
}

/** Coarse relative time: "3 hours ago", "yesterday", "2 months ago". */
export function relTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = then - Date.now();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const mins = Math.round(Math.abs(diff) / 60000);
  const sign = diff < 0 ? -1 : 1;
  if (mins < 60) return rtf.format(sign * mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(sign * hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(sign * days, 'day');
  return rtf.format(sign * Math.round(days / 30), 'month');
}

/** Up to two initials for monogram avatars: "Lebois & Co" → "LC". */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '·';
}
