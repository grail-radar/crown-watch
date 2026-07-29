-- Attempt tracking for the brand enrichment pass, so it converges instead of
-- re-asking about the same unresolvable brands on every run. Idempotent.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "enrichment_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "enrichment_asked_at" TIMESTAMP(3);
