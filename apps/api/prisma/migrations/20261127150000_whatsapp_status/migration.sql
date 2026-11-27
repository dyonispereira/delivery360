-- WhatsApp do restaurante (QR Code) e controle dos avisos de status enviados ao cliente.
ALTER TABLE "order_status_history" ADD COLUMN "notified_at" TIMESTAMP(3);
-- O histórico antigo não deve disparar mensagens ao ligar o WhatsApp.
UPDATE "order_status_history" SET "notified_at" = "created_at";
CREATE INDEX "order_status_history_notified_at_created_at_idx" ON "order_status_history"("notified_at", "created_at");

CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "instance_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "phone" TEXT,
    "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_accounts_tenant_id_key" ON "whatsapp_accounts"("tenant_id");
CREATE UNIQUE INDEX "whatsapp_accounts_instance_name_key" ON "whatsapp_accounts"("instance_name");
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
