-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OUT', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "batch_id" UUID,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_code_fails" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "couriers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fee_cents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "access_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "courier_id" UUID NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OUT',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "delivery_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "couriers_access_token_key" ON "couriers"("access_token");

-- CreateIndex
CREATE INDEX "couriers_tenant_id_idx" ON "couriers"("tenant_id");

-- CreateIndex
CREATE INDEX "delivery_batches_courier_id_status_idx" ON "delivery_batches"("courier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_batches_tenant_id_number_key" ON "delivery_batches"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "orders_batch_id_idx" ON "orders"("batch_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "delivery_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_batches" ADD CONSTRAINT "delivery_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_batches" ADD CONSTRAINT "delivery_batches_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
