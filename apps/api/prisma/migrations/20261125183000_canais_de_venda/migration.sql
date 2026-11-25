-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('LOJA', 'IFOOD', 'FOOD99', 'KEETA');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'APP_ONLINE';

-- AlterTable
ALTER TABLE "options" ADD COLUMN     "pdv_code" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "SalesChannel" NOT NULL DEFAULT 'LOJA',
ADD COLUMN     "delivery_code" TEXT,
ADD COLUMN     "external_code" TEXT,
ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "channel_prices" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "pdv_code" TEXT;

-- CreateTable
CREATE TABLE "channel_settings" (
    "tenant_id" UUID NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "merchant_id" TEXT,
    "commission_bps" INTEGER NOT NULL DEFAULT 0,
    "payment_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "payout_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_settings_pkey" PRIMARY KEY ("tenant_id","channel")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_channel_external_id_key" ON "orders"("tenant_id", "channel", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_pdv_code_key" ON "products"("tenant_id", "pdv_code");

-- AddForeignKey
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "channel" "SalesChannel";

-- Lançamentos de pedidos já existentes vêm da loja própria
UPDATE "financial_entries" SET "channel" = 'LOJA' WHERE "source" = 'cardapio' AND "external_key" LIKE 'order:%' AND "channel" IS NULL;
