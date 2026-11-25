-- AlterTable
ALTER TABLE "couriers" ADD COLUMN     "last_accuracy" DOUBLE PRECISION,
ADD COLUMN     "last_lat" DOUBLE PRECISION,
ADD COLUMN     "last_lng" DOUBLE PRECISION,
ADD COLUMN     "last_location_at" TIMESTAMP(3);
