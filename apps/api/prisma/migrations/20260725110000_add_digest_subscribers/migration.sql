-- Weekly-digest email capture (CONTEXT.md §7.4). Idempotent.
CREATE TABLE IF NOT EXISTS "digest_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_subscribers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "digest_subscribers_email_key" ON "digest_subscribers"("email");
