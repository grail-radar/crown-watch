'use client';

import { useEffect, useState } from 'react';
import {
  DARK_QUERY,
  ThemePreference,
  applyTheme,
  readPreference,
  resolveTheme,
  writePreference,
} from '@/lib/theme';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: 'M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M18.4 5.6l-1.1 1.1M6.7 17.3l-1.1 1.1M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z' },
  { value: 'dark', label: 'Dark', icon: 'M20 13.2A8.2 8.2 0 1110.8 4a6.6 6.6 0 009.2 9.2z' },
  { value: 'system', label: 'System', icon: 'M4 5.5h16v10H4zM9 20h6M12 15.5V20' },
];

/**
 * Light / dark / system, as three toggle buttons.
 *
 * Buttons with `aria-pressed` rather than a radiogroup: a radiogroup owes the
 * reader arrow-key roving focus, and three targets do not earn that complexity
 * over plain tabbing. Each button announces its own state.
 *
 * The boot script in the root layout has already applied the right theme by the
 * time this mounts — this component only changes it. Which state is *shown* as
 * active does depend on `localStorage`, which the server cannot know, so it is
 * left unset until after mount rather than guessed at and corrected: a wrong
 * highlight that flips is worse than a moment with none, and guessing would be
 * a hydration mismatch.
 */
export function ThemeSwitch() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(readPreference());
  }, []);

  // Only while following the system: an explicit choice must not be overridden
  // when the OS flips. Re-subscribes when the preference changes, so switching
  // to system starts following immediately without a reload.
  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => applyTheme(resolveTheme('system', media.matches));
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [preference]);

  function choose(next: ThemePreference) {
    setPreference(next);
    writePreference(next);
    applyTheme(resolveTheme(next, window.matchMedia(DARK_QUERY).matches));
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center rounded-full border border-line/70 p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={preference === null ? undefined : active}
            title={`${option.label} theme`}
            className={`rounded-full p-1.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
              active
                ? 'bg-panel-2 text-gold'
                : 'text-faint hover:text-ink'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d={option.icon} />
            </svg>
            <span className="sr-only">{option.label} theme</span>
          </button>
        );
      })}
    </div>
  );
}
