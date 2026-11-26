-- Impulso Delivery360: desconto automático bancado pela Delivery360, separado do cupom do restaurante.
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "platform_coupon_id" UUID,
ADD COLUMN     "platform_discount_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "orders_platform_coupon_id_idx" ON "orders"("platform_coupon_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_platform_coupon_id_fkey" FOREIGN KEY ("platform_coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

