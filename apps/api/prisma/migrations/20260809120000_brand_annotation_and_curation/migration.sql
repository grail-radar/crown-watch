-- A Brand carries an Annotation, and is Listed or Curated.
--
-- The states replace `watchlist|verified`. "Watchlist" is a *user's* list of
-- Brands they follow and was never a state a Brand is in (CONTEXT.md §9), and
-- "verified" claimed something nobody had checked.
--
-- **Every existing row becomes `listed`, including the ones that said
-- `verified`.** Curated means a human approved that Brand's Annotation, and no
-- human has approved any yet — promoting them here would make the state a lie
-- on the day it was introduced.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "annotation" TEXT;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "annotation_approved_at" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'BrandStatus' AND e.enumlabel = 'watchlist'
  ) THEN
    -- Dropped first so a re-run after a part-applied attempt starts clean;
    -- nothing references it while the old type is still in place.
    DROP TYPE IF EXISTS "BrandStatus_new";
    CREATE TYPE "BrandStatus_new" AS ENUM ('listed', 'curated');

    ALTER TABLE "brands" ALTER COLUMN "status" DROP DEFAULT;
    -- Everything lands on `listed`, whatever it said before.
    ALTER TABLE "brands"
      ALTER COLUMN "status" TYPE "BrandStatus_new"
      USING ('listed'::"BrandStatus_new");
    ALTER TABLE "brands" ALTER COLUMN "status" SET DEFAULT 'listed';

    DROP TYPE "BrandStatus";
    ALTER TYPE "BrandStatus_new" RENAME TO "BrandStatus";
  END IF;
END $$;
