-- Digest sender: unsubscribe tokens + send audit log. Idempotent.
ALTER TABLE "digest_subscribers" ADD COLUMN IF NOT EXISTS "unsubscribe_token" TEXT;
UPDATE "digest_subscribers" SET "unsubscribe_token" = gen_random_uuid()::text WHERE "unsubscribe_token" IS NULL;
ALTER TABLE "digest_subscribers" ALTER COLUMN "unsubscribe_token" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "digest_subscribers_unsubscribe_token_key" ON "digest_subscribers"("unsubscribe_token");
ALTER TABLE "digest_subscribers" ADD COLUMN IF NOT EXISTS "unsubscribed_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "digest_sends" (
    "id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drop_count" INTEGER NOT NULL,
    "recipient_count" INTEGER NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "digest_sends_pkey" PRIMARY KEY ("id")
);
