-- Article media for drops: thumbnail + link back to the original coverage.
-- IF NOT EXISTS so the migration is idempotent (may be pre-applied out of band).
ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "source_url" TEXT;
