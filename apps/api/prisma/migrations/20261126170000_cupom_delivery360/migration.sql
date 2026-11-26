-- Cupom bancado pela Delivery360 (contrapartida para impulsionar um restaurante).
CREATE TYPE "CouponFunding" AS ENUM ('RESTAURANT', 'PLATFORM');
ALTER TABLE "coupons" ADD COLUMN "funded_by" "CouponFunding" NOT NULL DEFAULT 'RESTAURANT';
ALTER TABLE "orders" ADD COLUMN "coupon_funded_by" "CouponFunding";
