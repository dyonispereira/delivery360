-- Salão: mesas, conta da mesa e pedidos lançados pelo garçom.
-- CreateEnum
CREATE TYPE "TabStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'DINE_IN';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "tab_id" UUID,
ADD COLUMN     "table_name" TEXT,
ADD COLUMN     "waiter_name" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "service_fee_bps" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_tabs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "table_name" TEXT NOT NULL,
    "open_key" UUID,
    "status" "TabStatus" NOT NULL DEFAULT 'OPEN',
    "people" INTEGER,
    "opened_by_id" UUID,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "payment_method" "PaymentMethod",
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "service_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dining_tables_tenant_id_position_idx" ON "dining_tables"("tenant_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_tenant_id_name_key" ON "dining_tables"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "table_tabs_open_key_key" ON "table_tabs"("open_key");

-- CreateIndex
CREATE INDEX "table_tabs_tenant_id_status_idx" ON "table_tabs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "table_tabs_table_id_idx" ON "table_tabs"("table_id");

-- CreateIndex
CREATE INDEX "orders_tab_id_idx" ON "orders"("tab_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "table_tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tabs" ADD CONSTRAINT "table_tabs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tabs" ADD CONSTRAINT "table_tabs_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Vários pagamentos por conta (vários cartões, Pix, dinheiro); a mesa só fecha quitada.
-- AlterTable
ALTER TABLE "table_tabs" ADD COLUMN     "service_fee" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "tab_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tab_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "label" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tab_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tab_payments_tab_id_idx" ON "tab_payments"("tab_id");

-- AddForeignKey
ALTER TABLE "tab_payments" ADD CONSTRAINT "tab_payments_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "table_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

