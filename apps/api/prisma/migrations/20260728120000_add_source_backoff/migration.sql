-- Politeness state per source: how many times in a row it has failed, when it
-- may be polled again, and why it is unhealthy. Persisted rather than held in
-- memory so a store's "leave me alone" survives a restart. Idempotent.

ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "consecutive_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
