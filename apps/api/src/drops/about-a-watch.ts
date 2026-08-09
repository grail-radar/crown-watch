import { Prisma, WatchKind } from '@prisma/client';

/**
 * Drops the public may be told about: the ones that are about a **watch**.
 *
 * #38 stopped the watcher creating a Drop for a strap. This is the other half —
 * the Drops it created before that are real history and stay in the database,
 * so every path that *serves* or *sends* one has to agree to leave them alone
 * (ADR-0006).
 *
 * Shared rather than copied because the paths are far apart and the failure is
 * silent in different ways at each: the website shows a strap as a release, the
 * weekly email does the same to an inbox, and a Telegram backfill posts it to a
 * Channel that cannot unsend (ADR-0002). One of those three getting it wrong is
 * exactly what happens when three places each define "public" for themselves.
 *
 * The `OR` is load-bearing: a Drop read out of a publication's RSS names a
 * watch in prose and has no `watch_id` at all, so excluding accessories without
 * it would silently take the whole of Tier 1 with them.
 *
 * Nested under `AND` on purpose. At the top level of a `where`, a caller that
 * spread this alongside its own `OR:` would replace this one and quietly widen
 * the query back out — which is the kind of mistake nobody notices until a
 * strap is in a Channel.
 */
export const ABOUT_A_WATCH: Prisma.DropWhereInput = {
  AND: [{ OR: [{ watchId: null }, { watch: { kind: WatchKind.watch } }] }],
};

/**
 * True when this Drop may be announced.
 *
 * The row-level form, for the paths that already hold a Drop rather than
 * building a query — chiefly the dispatcher, which is handed a drop id by the
 * moderation queue and has to decide before it sends.
 */
export function isAboutAWatch(drop: {
  watch?: { kind: WatchKind } | null;
}): boolean {
  return !drop.watch || drop.watch.kind === WatchKind.watch;
}
