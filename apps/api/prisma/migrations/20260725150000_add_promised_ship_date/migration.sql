-- Promised ship date on drops — foundation for the future brand reliability
-- score (CONTEXT.md §2). Idempotent.
ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "promised_ship_date" TIMESTAMP(3);
