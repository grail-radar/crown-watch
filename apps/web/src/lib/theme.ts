/**
 * Colour theme: what the reader asked for, and what that resolves to.
 *
 * Two different things, deliberately kept apart. The **preference** is one of
 * three — light, dark, or system — and only an explicit one is stored. The
 * **resolved** theme is always light or dark, and is what `data-theme` on the
 * root element carries.
 *
 * Storing "system" as a value would be a third state that can drift: a reader
 * who picks system today and changes their OS tomorrow expects the site to
 * follow, so the absence of a stored value is what "system" means.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cw-theme';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The script that runs before the first paint.
 *
 * The root layout is a server component and the stored preference lives in the
 * browser, so without this the page renders in the default palette and corrects
 * itself a moment later — a flash of the wrong theme on every load. It has to be
 * inline and blocking for the same reason: anything deferred is too late.
 *
 * Kept as a string rather than a function so it can be inlined verbatim, and
 * deliberately small — it blocks rendering.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=p==='light'||p==='dark'?p:(window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}).matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})();`;

/** What a preference means right now, given the operating system's setting. */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark ? 'dark' : 'light';
}

/** The stored preference, or `system` when there is none or it is unreadable. */
export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private browsing and blocked storage both throw here. Following the OS is
    // a better failure than refusing to render.
    return 'system';
  }
}

/** Persist an explicit choice; `system` clears it rather than storing a value. */
export function writePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The theme still applies for this page view; it just will not survive.
  }
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}
