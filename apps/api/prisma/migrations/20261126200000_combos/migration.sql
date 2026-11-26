-- Combos: produto combo com etapas; cada opção pode apontar para um produto do cardápio.
-- AlterTable
ALTER TABLE "options" ADD COLUMN     "linked_product_id" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_combo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "options_linked_product_id_idx" ON "options"("linked_product_id");

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_linked_product_id_fkey" FOREIGN KEY ("linked_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

