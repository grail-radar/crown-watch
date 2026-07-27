-- Tier 4 site-watch: per-source adapter selection and settings.
-- Idempotent so a re-applied migration is harmless.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "watch_config" JSONB;
