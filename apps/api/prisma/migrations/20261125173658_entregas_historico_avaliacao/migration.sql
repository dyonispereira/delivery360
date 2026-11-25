-- CreateEnum
CREATE TYPE "DeliveryOutcome" AS ENUM ('DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryFailReason" AS ENUM ('ADDRESS_NOT_FOUND', 'CUSTOMER_ABSENT', 'CUSTOMER_REFUSED', 'OTHER');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_issue" "DeliveryFailReason",
ADD COLUMN     "delivery_issue_at" TIMESTAMP(3),
ADD COLUMN     "rated_at" TIMESTAMP(3),
ADD COLUMN     "rating_comment" TEXT,
ADD COLUMN     "rating_delivery" INTEGER,
ADD COLUMN     "rating_store" INTEGER;

-- AlterTable
ALTER TABLE "couriers" ADD COLUMN     "plate" TEXT;

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "batch_id" UUID,
    "batch_number" INTEGER,
    "outcome" "DeliveryOutcome" NOT NULL,
    "fail_reason" "DeliveryFailReason",
    "note" TEXT,
    "receiver_name" TEXT,
    "code" TEXT,
    "courier_name" TEXT NOT NULL,
    "courier_plate" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_attempts_order_id_idx" ON "delivery_attempts"("order_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_courier_id_created_at_idx" ON "delivery_attempts"("courier_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_tenant_id_created_at_idx" ON "delivery_attempts"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

