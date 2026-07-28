-- Public Telegram broadcast log — one row per (drop, channel), the guard that
-- makes once-only delivery true rather than merely intended. Idempotent so a
-- re-applied migration is harmless.

DO $$ BEGIN
    CREATE TYPE "BroadcastStatus" AS ENUM ('pending', 'sent', 'failed');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "drop_broadcasts" (
    "id" TEXT NOT NULL,
    "drop_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'pending',
    "message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "drop_broadcasts_pkey" PRIMARY KEY ("id")
);

-- The dedup guard: a drop reaches a given channel at most once, ever.
CREATE UNIQUE INDEX IF NOT EXISTS "drop_broadcasts_drop_id_chat_id_key"
    ON "drop_broadcasts"("drop_id", "chat_id");
CREATE INDEX IF NOT EXISTS "drop_broadcasts_drop_id_idx"
    ON "drop_broadcasts"("drop_id");

DO $$ BEGIN
    ALTER TABLE "drop_broadcasts"
        ADD CONSTRAINT "drop_broadcasts_drop_id_fkey"
        FOREIGN KEY ("drop_id") REFERENCES "drops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
