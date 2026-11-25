-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('CLT', 'PJ', 'DIARISTA', 'ESTAGIO');

-- CreateEnum
CREATE TYPE "AbsenceKind" AS ENUM ('FOLGA', 'FERIAS', 'ATESTADO', 'FALTA');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'CLOSED');

-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN     "employer_inss_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fgts_bps" INTEGER NOT NULL DEFAULT 800,
ADD COLUMN     "pay_day" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "type" "EmploymentType" NOT NULL,
    "phone" TEXT,
    "document" TEXT,
    "pix_key" TEXT,
    "salary_cents" INTEGER NOT NULL DEFAULT 0,
    "daily_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "transport_cents" INTEGER NOT NULL DEFAULT 0,
    "meal_cents" INTEGER NOT NULL DEFAULT 0,
    "weekly_day_off" INTEGER,
    "admission_date" DATE NOT NULL,
    "termination_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "AbsenceKind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "payroll_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "base_cents" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "extras_cents" INTEGER NOT NULL DEFAULT 0,
    "bonus_cents" INTEGER NOT NULL DEFAULT 0,
    "absence_cents" INTEGER NOT NULL DEFAULT 0,
    "absence_days" INTEGER NOT NULL DEFAULT 0,
    "advance_cents" INTEGER NOT NULL DEFAULT 0,
    "benefits_cents" INTEGER NOT NULL DEFAULT 0,
    "charges_cents" INTEGER NOT NULL DEFAULT 0,
    "provision_cents" INTEGER NOT NULL DEFAULT 0,
    "net_cents" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_tenant_id_active_idx" ON "employees"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "absences_tenant_id_start_date_idx" ON "absences"("tenant_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_tenant_id_month_key" ON "payrolls"("tenant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_payroll_id_employee_id_key" ON "payroll_items"("payroll_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

