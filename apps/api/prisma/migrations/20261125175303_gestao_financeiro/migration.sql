-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('REVENUE', 'DEDUCTION', 'EXPENSE', 'FINANCIAL', 'OFF_DRE');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "group" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "EntryType" NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "competence_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'OPEN',
    "paid_at" DATE,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_type_status_due_date_idx" ON "financial_entries"("tenant_id", "type", "status", "due_date");

-- CreateIndex
CREATE INDEX "financial_entries_tenant_id_competence_date_idx" ON "financial_entries"("tenant_id", "competence_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entries_tenant_id_external_key_key" ON "financial_entries"("tenant_id", "external_key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
