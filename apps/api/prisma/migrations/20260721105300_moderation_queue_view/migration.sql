-- moderation_queue: a view over `drops` awaiting human review (CONTEXT.md §5).
-- Prisma Migrate does not manage views, so the DDL lives here by hand; the
-- `view ModerationQueue` block in schema.prisma provides the typed client model.
CREATE VIEW "moderation_queue" AS
SELECT
    "id",
    "brand_id",
    "title",
    "type",
    "confidence_score",
    "moderation_status",
    "reviewer_id",
    "reviewed_at",
    "published_at",
    "created_at"
FROM "drops"
WHERE "moderation_status" = 'pending';
