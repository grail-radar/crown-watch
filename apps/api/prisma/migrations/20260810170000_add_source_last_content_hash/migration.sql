-- What a Tier 4 source last showed us, whether or not it was worth storing.
--
-- A poll whose only movement is a price, a currency label or a photograph now
-- stores no snapshot (ADR-0008). That leaves the stored payload as a record of
-- the last *announceable* state rather than the last observed one — so a store
-- that moves a price once and then settles would compare against a stale
-- baseline, read as changed at every poll from then on, and re-upsert its whole
-- catalogue hourly for ever.
--
-- Kept on the source rather than by rewriting the snapshot row in place: that
-- row is a Drop's `source_event_id`, and overwriting it would rewrite the
-- provenance of an announcement that had already been sent.
--
-- Null for every existing row. The first poll after this ships sees a null
-- hash, treats the store as moved, refreshes the catalogue once, and settles.

ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "last_content_hash" TEXT;
