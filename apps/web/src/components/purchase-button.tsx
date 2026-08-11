import type { PurchaseLink } from '@/lib/api';

/**
 * Where to go to act on a drop.
 *
 * Renders whatever the API decided and nothing more — the honesty of the label
 * is the API's job, shared with the Telegram channels, so this component holds
 * no rule about what counts as buyable. Given `null` it renders nothing, which
 * is the correct answer for a drop we only have a magazine article for.
 *
 * A store link is the primary action and is the one filled element on a page.
 * A brand-site link is deliberately quieter: it is honest but weaker, since the
 * reader still has to find the watch when they arrive, and dressing it up as a
 * buy button would overpromise.
 */
export function PurchaseButton({
  purchase,
  brandName,
  className = '',
}: {
  purchase: PurchaseLink | null;
  brandName: string;
  className?: string;
}) {
  if (!purchase) return null;

  const isStore = purchase.kind === 'store';
  const label = isStore ? `Buy from ${brandName}` : `Visit ${brandName}`;

  return (
    <a
      href={purchase.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        isStore
          ? `Buy ${brandName} — opens the brand's store in a new tab`
          : `Visit ${brandName}'s own site — opens in a new tab`
      }
      className={`inline-block text-sm transition ${
        isStore
          ? 'bg-ink px-5 py-2.5 text-inverse hover:opacity-80'
          : 'text-ink underline decoration-rule underline-offset-4 hover:decoration-ink'
      } ${className}`}
    >
      {label} ↗
    </a>
  );
}

/** The same decision, sized for a card in the feed rather than a page. */
export function PurchaseTag({
  purchase,
  brandName,
}: {
  purchase: PurchaseLink | null;
  brandName: string;
}) {
  if (!purchase) return null;

  const isStore = purchase.kind === 'store';
  return (
    <a
      href={purchase.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        isStore
          ? `Buy ${brandName} — opens the brand's store in a new tab`
          : `Visit ${brandName}'s own site — opens in a new tab`
      }
      className={`shrink-0 underline underline-offset-4 transition ${
        isStore
          ? 'text-ink decoration-ink'
          : 'text-muted decoration-rule hover:text-ink'
      }`}
    >
      {isStore ? 'Buy ↗' : 'Brand site ↗'}
    </a>
  );
}
