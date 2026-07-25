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

/** Badge color classes per drop type (muted, editorial). */
const TYPE_BADGES: Record<string, string> = {
  kickstarter_launch: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  waitlist_open: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
  restock: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
  pre_order: 'bg-gold/10 text-gold-bright ring-gold/30',
};

export function dropTypeBadgeClass(type: string): string {
  return TYPE_BADGES[type] ?? 'bg-panel-2 text-faint ring-line';
}

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
