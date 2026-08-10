-- The facts a human needs in front of them to write a Brand's Annotation.
--
-- Never the Annotation itself: a model assembles facts, a person writes the
-- judgement, and there is deliberately no column here for a sentence (ADR-0009).
--
-- A table of its own rather than columns on `brands`, and that is the point:
-- drafting never writes to the Brand, so rejecting a draft is a delete and
-- cannot leave a Brand half-annotated (#30).
--
-- `status` keeps the two failures apart, because what happens next differs.
-- `failed` means we could not ask — a transient API error — so the Brand stays
-- in the queue and is asked again. `empty` means we asked and got nothing
-- usable, which is an answer: asking again would spend money to be told the
-- same thing. Both are recorded, so neither looks like a Brand nobody tried.

CREATE TYPE "DraftStatus" AS ENUM ('usable', 'empty', 'failed');

CREATE TABLE IF NOT EXISTS "brand_annotation_drafts" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'usable',
    "note" TEXT,
    -- Named for the language model rather than `model`, which in this
    -- codebase's vocabulary means a Watch (CONTEXT.md §9).
    "drafted_by_model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_annotation_drafts_pkey" PRIMARY KEY ("id")
);

-- One draft per Brand; re-drafting replaces it rather than piling up.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_annotation_drafts_brand_id_key"
    ON "brand_annotation_drafts"("brand_id");

CREATE INDEX IF NOT EXISTS "brand_annotation_drafts_status_idx"
    ON "brand_annotation_drafts"("status");

ALTER TABLE "brand_annotation_drafts"
    ADD CONSTRAINT "brand_annotation_drafts_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
