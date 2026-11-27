-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "scheduled_for" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "schedule_closes_at" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "schedule_lead_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "schedule_max_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "schedule_opens_at" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "schedule_slot_minutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "schedule_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "scheduling_enabled" BOOLEAN NOT NULL DEFAULT false;

