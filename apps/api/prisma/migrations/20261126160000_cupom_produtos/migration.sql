-- Cupom que vale só para alguns produtos ou combos.
ALTER TABLE "coupons" ADD COLUMN "product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
