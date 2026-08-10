/**
 * Command-line arguments, the way this repo's maintenance scripts take them.
 *
 * Extracted at the third copy: `retract-drops.ts`, `purge-broadcasts.ts` and
 * `sweep-broadcast-claims.ts` had written the same `--name=value` parsing out
 * by hand. These scripts are pointed at production, so the argument that
 * decides *what* they touch is not a good place for three slightly different
 * implementations to drift.
 *
 * Deliberately tiny and dependency-free. Nothing here needs a parser library:
 * the whole vocabulary is `--flag` and `--name=value`.
 */

/** Is `--name` present? */
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * The value of `--name=value`, or undefined.
 *
 * Splits on the first `=` only, so a value may itself contain one — a URL with
 * a query string is the case that matters.
 */
export function option(name: string): string | undefined {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found?.split('=').slice(1).join('=');
}

/** Every value of a repeatable `--name=value`, in the order given. */
export function options(name: string): string[] {
  return process.argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => arg.split('=').slice(1).join('='));
}

/**
 * A required `--name=<ISO timestamp>`.
 *
 * Refuses a date it cannot read rather than passing `Invalid Date` down into a
 * query, where it would silently match nothing and look like a clean run.
 */
export function requireDate(name: string): Date {
  const raw = option(name);
  if (!raw) throw new Error(`--${name}=<ISO timestamp> is required`);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--${name}="${raw}" is not a date I can read`);
  }
  return date;
}
