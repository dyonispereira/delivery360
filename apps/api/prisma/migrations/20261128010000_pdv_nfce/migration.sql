-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'COUNTER';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_document" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cfop" TEXT,
ADD COLUMN     "ncm" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "kitchen_width_mm" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "receipt_auto_print" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receipt_copies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "receipt_footer" TEXT,
ADD COLUMN     "receipt_width_mm" INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "open_key" UUID,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_cents" INTEGER NOT NULL,
    "opened_by_id" UUID,
    "opened_by_name" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" UUID,
    "closed_by_name" TEXT,
    "closed_at" TIMESTAMP(3),
    "counted_cents" INTEGER,
    "expected_cents" INTEGER,
    "difference_cents" INTEGER,
    "notes" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT,
    "user_id" UUID,
    "user_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "session_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "card_kind" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "received_cents" INTEGER,
    "change_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'simulado',
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
    "cnpj" TEXT,
    "state_registration" TEXT,
    "legal_name" TEXT,
    "uf" TEXT,
    "tax_regime" INTEGER NOT NULL DEFAULT 1,
    "csc_id" TEXT,
    "csc_token_encrypted" TEXT,
    "series" INTEGER NOT NULL DEFAULT 1,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "default_ncm" TEXT NOT NULL DEFAULT '21069090',
    "default_cfop" TEXT NOT NULL DEFAULT '5102',
    "default_csosn" TEXT NOT NULL DEFAULT '102',
    "pdv_receipt" TEXT NOT NULL DEFAULT 'NAO_FISCAL',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" "FiscalStatus" NOT NULL,
    "series" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "access_key" TEXT,
    "protocol" TEXT,
    "qr_code_url" TEXT,
    "consult_url" TEXT,
    "document" TEXT,
    "total_cents" INTEGER NOT NULL,
    "message" TEXT,
    "authorized_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_open_key_key" ON "cash_sessions"("open_key");

-- CreateIndex
CREATE INDEX "cash_sessions_tenant_id_opened_at_idx" ON "cash_sessions"("tenant_id", "opened_at");

-- CreateIndex
CREATE INDEX "cash_movements_session_id_idx" ON "cash_movements"("session_id");

-- CreateIndex
CREATE INDEX "counter_payments_order_id_idx" ON "counter_payments"("order_id");

-- CreateIndex
CREATE INDEX "counter_payments_session_id_idx" ON "counter_payments"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_ref_key" ON "fiscal_documents"("ref");

-- CreateIndex
CREATE INDEX "fiscal_documents_order_id_idx" ON "fiscal_documents"("order_id");

-- CreateIndex
CREATE INDEX "fiscal_documents_tenant_id_created_at_idx" ON "fiscal_documents"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_tenant_id_environment_series_number_key" ON "fiscal_documents"("tenant_id", "environment", "series", "number");

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_payments" ADD CONSTRAINT "counter_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_payments" ADD CONSTRAINT "counter_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counter_payments" ADD CONSTRAINT "counter_payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

