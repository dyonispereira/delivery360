-- Preço de/por
ALTER TABLE "products" ADD COLUMN "promo_price_cents" INTEGER,
ADD COLUMN "promo_starts_at" TIMESTAMP(3),
ADD COLUMN "promo_ends_at" TIMESTAMP(3);
ALTER TABLE "order_items" ADD COLUMN "list_unit_price_cents" INTEGER;
ALTER TABLE "orders" ADD COLUMN "promo_discount_cents" INTEGER NOT NULL DEFAULT 0;
