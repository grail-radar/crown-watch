-- CreateTable
CREATE TABLE "watches" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_variants" (
    "id" TEXT NOT NULL,
    "watch_id" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "reference" TEXT,
    "price" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "image_url" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watches_brand_id_idx" ON "watches"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "watches_brand_id_key_key" ON "watches"("brand_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "watches_brand_id_slug_key" ON "watches"("brand_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "watch_variants_product_url_key" ON "watch_variants"("product_url");

-- CreateIndex
CREATE INDEX "watch_variants_watch_id_idx" ON "watch_variants"("watch_id");

-- AddForeignKey
ALTER TABLE "watches" ADD CONSTRAINT "watches_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_variants" ADD CONSTRAINT "watch_variants_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
