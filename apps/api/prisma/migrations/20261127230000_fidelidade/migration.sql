-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('FIXED', 'FREE_DELIVERY', 'PRODUCT');

-- CreateEnum
CREATE TYPE "LoyaltyKind" AS ENUM ('EARN', 'REDEEM', 'REFUND', 'REFERRAL', 'ADJUST', 'EXPIRE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referred_by_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "club_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "club_level_name" TEXT,
ADD COLUMN     "loyalty_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_spent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referral_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reward_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reward_id" UUID,
ADD COLUMN     "reward_name" TEXT;

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "points_per_real" INTEGER NOT NULL DEFAULT 1,
    "expire_days" INTEGER NOT NULL DEFAULT 0,
    "club_enabled" BOOLEAN NOT NULL DEFAULT false,
    "referral_enabled" BOOLEAN NOT NULL DEFAULT false,
    "referral_friend_cents" INTEGER NOT NULL DEFAULT 1000,
    "referral_min_order_cents" INTEGER NOT NULL DEFAULT 3000,
    "referral_referrer_points" INTEGER NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "points_cost" INTEGER NOT NULL,
    "type" "RewardType" NOT NULL,
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "product_id" UUID,
    "min_order_cents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_points" INTEGER NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "free_delivery" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" "LoyaltyKind" NOT NULL,
    "order_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_rewards_tenant_id_position_idx" ON "loyalty_rewards"("tenant_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "club_levels_tenant_id_name_key" ON "club_levels"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "loyalty_transactions_tenant_id_customer_id_created_at_idx" ON "loyalty_transactions"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_order_id_kind_key" ON "loyalty_transactions"("order_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_referral_code_key" ON "customers"("tenant_id", "referral_code");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_levels" ADD CONSTRAINT "club_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

