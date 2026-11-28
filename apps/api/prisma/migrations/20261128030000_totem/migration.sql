-- CreateEnum
CREATE TYPE "TotemConsumption" AS ENUM ('EAT_IN', 'TAKEAWAY');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "consumption" "TotemConsumption",
ADD COLUMN     "pay_hint" TEXT,
ADD COLUMN     "request_key" TEXT,
ADD COLUMN     "ticket" TEXT,
ADD COLUMN     "totem_id" UUID;

-- CreateTable
CREATE TABLE "totems" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eat_in" BOOLEAN NOT NULL DEFAULT true,
    "takeaway" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "totems_tenant_id_idx" ON "totems"("tenant_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_totem_id_status_idx" ON "orders"("tenant_id", "totem_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_request_key_key" ON "orders"("tenant_id", "request_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_totem_id_fkey" FOREIGN KEY ("totem_id") REFERENCES "totems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totems" ADD CONSTRAINT "totems_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

