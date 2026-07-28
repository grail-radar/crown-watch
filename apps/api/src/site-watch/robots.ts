/**
 * The slice of the robots.txt convention this crawler needs.
 *
 * Deliberately small and pure. We fetch one known URL per brand on a slow
 * schedule, so the parts that matter are: does a group apply to us, is this
 * path disallowed, and how long does the site want between hits. Wildcards and
 * `$` anchors are supported because real stores use them; sitemaps, host
 * directives and crawl budgeting are ignored because nothing here would act on
 * them.
 */

export interface RobotsRules {
  /** Path patterns the applicable group forbids. */
  disallow: string[];
  /** Path patterns that carve exceptions out of `disallow`. */
  allow: string[];
  /** Seconds the site asks crawlers to wait between requests, if stated. */
  crawlDelay: number | null;
}

const EMPTY: RobotsRules = { disallow: [], allow: [], crawlDelay: null };

/** The token a bot matches itself against, e.g. `CrownWatchBot/0.1 (…)`. */
export function userAgentToken(userAgent: string): string {
  return (userAgent.split('/')[0] || userAgent).trim().toLowerCase();
}

/**
 * Rules that apply to us.
 *
 * A robots.txt is a series of groups. The most specific group naming our bot
 * wins; failing that, the `*` group. Groups that name someone else are ignored
 * entirely — a `Disallow: /` aimed at a different crawler is not aimed at us.
 */
export function parseRobots(body: string, userAgent: string): RobotsRules {
  const token = userAgentToken(userAgent);
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  // Consecutive User-agent lines share one group; a rule line ends the run.
  let collectingAgents = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: { disallow: [], allow: [], crawlDelay: null } };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    collectingAgents = false;

    if (field === 'disallow') {
      // "Disallow:" with no value is the explicit way to allow everything.
      if (value) current.rules.disallow.push(value);
    } else if (field === 'allow') {
      if (value) current.rules.allow.push(value);
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.rules.crawlDelay = seconds;
    }
  }

  const named = groups.find((g) => g.agents.some((a) => a === token));
  if (named) return named.rules;
  const wildcard = groups.find((g) => g.agents.includes('*'));
  return wildcard ? wildcard.rules : EMPTY;
}

/** Does `pattern` (robots glob: `*` any run, trailing `$` anchors the end) match `path`? */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether we may fetch `path`.
 *
 * The longest matching pattern wins, and `Allow` beats `Disallow` at equal
 * length — the de-facto rule Google and Bing both implement, and the one that
 * makes `Disallow: /` plus `Allow: /products.json` mean what its author meant.
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (patterns: string[]) =>
    patterns
      .filter((p) => matches(p, path))
      .reduce((best, p) => Math.max(best, p.length), -1);

  const disallowed = longest(rules.disallow);
  if (disallowed === -1) return true;
  return longest(rules.allow) >= disallowed;
}
