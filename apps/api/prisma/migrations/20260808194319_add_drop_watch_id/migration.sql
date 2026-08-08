-- A Drop becomes an event about a Watch, so one release is one alert however
-- many references the store lists for it (ADR-0003).
--
-- Nullable and additive: nothing is merged and no existing row is touched.
-- Drops extracted from a publication's RSS have no store product to tie to and
-- keep a null; the rest are assigned by `backfill:drop-watches`. SET NULL on
-- delete, never CASCADE — a Watch is a grouping we may revise, and losing the
-- announcement (and with it the drop_broadcasts evidence, ADR-0002) because we
-- regrouped would be the expensive kind of mistake. Idempotent.

ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "watch_id" TEXT;

CREATE INDEX IF NOT EXISTS "drops_watch_id_idx" ON "drops"("watch_id");

DO $$
BEGIN
  ALTER TABLE "drops" ADD CONSTRAINT "drops_watch_id_fkey"
    FOREIGN KEY ("watch_id") REFERENCES "watches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
