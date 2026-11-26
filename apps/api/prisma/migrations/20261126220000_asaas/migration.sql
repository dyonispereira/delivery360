-- Pagamento online com Asaas: conta do restaurante (chave cifrada), QR Code do Pix e CPF do cliente.
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "api_key_encrypted" TEXT NOT NULL,
    "api_key_last4" TEXT NOT NULL,
    "account_name" TEXT,
    "webhook_token" TEXT NOT NULL,
    "webhook_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_accounts_tenant_id_key" ON "payment_accounts"("tenant_id");
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "pix_qr_image" TEXT;
ALTER TABLE "tips" ADD COLUMN "pix_qr_image" TEXT;
ALTER TABLE "customers" ADD COLUMN "document" TEXT, ADD COLUMN "gateway_customer_id" TEXT;
