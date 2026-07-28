/**
 * Telegram's paper plane, inline.
 *
 * Drawn here rather than pulled from an icon package: it is the only icon the
 * site needs, and a dependency (or a remote SVG) would cost more than the path.
 */
export function TelegramIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M21.94 4.3 19.2 19.1c-.2 1.1-.9 1.4-1.8.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.35-5 9.1-8.2c.4-.35-.09-.55-.62-.2L6.68 13.1l-4.85-1.5c-1.05-.33-1.07-1.05.22-1.56L20.6 2.83c.88-.32 1.65.2 1.34 1.47Z" />
    </svg>
  );
}
