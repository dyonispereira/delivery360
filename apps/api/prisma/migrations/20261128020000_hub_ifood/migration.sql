-- CreateEnum
CREATE TYPE "ChannelEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "channel_merchants" (
    "channel" "SalesChannel" NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_merchants_pkey" PRIMARY KEY ("channel","merchant_id")
);

-- CreateTable
CREATE TABLE "channel_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "channel" "SalesChannel" NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "merchant_id" TEXT,
    "order_external_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ChannelEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_order_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "order_id" UUID,
    "external_status" TEXT NOT NULL,
    "external_amounts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_order_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_merchants_tenant_id_channel_key" ON "channel_merchants"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "channel_events_tenant_id_channel_order_external_id_idx" ON "channel_events"("tenant_id", "channel", "order_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_events_channel_event_id_key" ON "channel_events"("channel", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_order_links_order_id_key" ON "channel_order_links"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_order_links_tenant_id_channel_external_id_key" ON "channel_order_links"("tenant_id", "channel", "external_id");

-- AddForeignKey
ALTER TABLE "channel_merchants" ADD CONSTRAINT "channel_merchants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_events" ADD CONSTRAINT "channel_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_order_links" ADD CONSTRAINT "channel_order_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_order_links" ADD CONSTRAINT "channel_order_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Códigos de loja já cadastrados: o primeiro restaurante de cada código fica com ele.
INSERT INTO "channel_merchants" ("channel", "merchant_id", "tenant_id")
SELECT DISTINCT ON ("channel", "merchant_id") "channel", "merchant_id", "tenant_id"
FROM "channel_settings"
WHERE "merchant_id" IS NOT NULL AND "merchant_id" <> ''
ORDER BY "channel", "merchant_id", "updated_at" ASC
ON CONFLICT DO NOTHING;
