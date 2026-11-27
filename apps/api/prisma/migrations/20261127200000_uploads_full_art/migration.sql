-- Banner com arte completa (sem texto por cima) e fotos enviadas pelo painel.
ALTER TABLE "campaigns" ADD COLUMN "full_art" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "uploads_tenant_id_idx" ON "uploads"("tenant_id");
