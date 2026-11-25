-- CreateTable
CREATE TABLE "tips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "pix_copy_paste" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_out_at" TIMESTAMP(3),
    "paid_out_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tips_order_id_key" ON "tips"("order_id");

-- CreateIndex
CREATE INDEX "tips_tenant_id_status_paid_out_at_idx" ON "tips"("tenant_id", "status", "paid_out_at");

-- CreateIndex
CREATE INDEX "tips_courier_id_idx" ON "tips"("courier_id");

-- CreateIndex
CREATE UNIQUE INDEX "tips_provider_external_id_key" ON "tips"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "tips" ADD CONSTRAINT "tips_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tips" ADD CONSTRAINT "tips_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
