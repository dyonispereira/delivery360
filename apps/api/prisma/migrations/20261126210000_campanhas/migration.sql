-- Campanhas da rede (banner + cupom opcional com custo dividido entre Delivery360 e restaurante).
ALTER TYPE "CouponFunding" ADD VALUE 'MIXED';

CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "image_url" TEXT NOT NULL,
    "tenant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opted_out_tenant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "coupon_code" TEXT,
    "type" "CouponType" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL DEFAULT 0,
    "max_discount_cents" INTEGER,
    "min_order_cents" INTEGER NOT NULL DEFAULT 0,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "max_uses" INTEGER,
    "max_uses_per_customer" INTEGER DEFAULT 1,
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "combines_with_promo" BOOLEAN NOT NULL DEFAULT false,
    "platform_share_bps" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaigns_coupon_code_key" ON "campaigns"("coupon_code");

ALTER TABLE "orders" ADD COLUMN "campaign_id" UUID, ADD COLUMN "coupon_platform_cents" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "orders_campaign_id_idx" ON "orders"("campaign_id");
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
