-- Why a Drop is waiting for a human instead of having published itself.
--
-- Tier 4 publishes on detection (ADR-0001). When the store will not serve the
-- product page a candidate points at, the Drop is written unpublished and waits
-- in the moderation queue instead (ADR-0007) — and until now the only record of
-- *why* was a log line and a poll response body that nobody reads under the
-- hourly scheduler.
--
-- Durable because this refusal, unlike a held Source (ADR-0005), cannot
-- re-derive itself: the snapshot has moved on, so no later poll raises the same
-- candidate again.
--
-- Null for every existing row, and for every Drop from extraction: those are
-- pending because that is where extracted Drops start, which is not a reason.

ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "held_reason" TEXT;
