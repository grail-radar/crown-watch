-- What each Watch actually is: a watch, or one of the other things a watch shop
-- sells. Only a watch raises a Drop.
--
-- Stored rather than derived at render time so that "which Drops should never
-- have gone out" is a join. `kind_override` is the operator's correction and
-- null means "trust the rule". Why, and what it costs, is ADR-0006.
--
-- Additive and idempotent.

DO $$
BEGIN
  CREATE TYPE "WatchKind" AS ENUM ('watch', 'accessory');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "watches" ADD COLUMN IF NOT EXISTS "kind" "WatchKind" NOT NULL DEFAULT 'watch';

ALTER TABLE "watches" ADD COLUMN IF NOT EXISTS "kind_override" "WatchKind";
