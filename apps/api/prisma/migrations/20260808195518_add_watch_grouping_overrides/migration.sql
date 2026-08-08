-- Where the grouping rule is wrong, and what it should say instead.
--
-- ADR-0003 accepted a deliberately simple identity rule on the condition that
-- corrections are cheap. This table is that condition: one row re-homes one
-- store product, so giving two products the same watch_key forces a merge and
-- giving one its own forces a split. Editing rows is the whole interface — no
-- deploy, no restart.

CREATE TABLE IF NOT EXISTS "watch_grouping_overrides" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "watch_key" TEXT NOT NULL,
    "watch_name" TEXT,
    "note" TEXT,
    "last_matched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_grouping_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "watch_grouping_overrides_product_url_key" ON "watch_grouping_overrides"("product_url");

CREATE INDEX IF NOT EXISTS "watch_grouping_overrides_brand_id_idx" ON "watch_grouping_overrides"("brand_id");

DO $$
BEGIN
  ALTER TABLE "watch_grouping_overrides" ADD CONSTRAINT "watch_grouping_overrides_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
