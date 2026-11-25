-- AlterTable
ALTER TABLE "financial_entries" ADD COLUMN     "payment_method" TEXT;

-- AlterTable
ALTER TABLE "options" ADD COLUMN     "cost_cents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "unit_cost_cents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cost_items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "extra_cost_bps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "finance_settings" (
    "tenant_id" UUID NOT NULL,
    "sales_tax_bps" INTEGER NOT NULL DEFAULT 0,
    "pix_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "credit_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "card_on_delivery_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "target_margin_bps" INTEGER NOT NULL DEFAULT 2000,
    "tax_due_day" INTEGER NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
