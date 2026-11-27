-- Garçom responsável pela mesa: recebe os avisos de prato pronto ("Minhas mesas").
ALTER TABLE "table_tabs" ADD COLUMN "waiter_id" UUID;
ALTER TABLE "table_tabs" ADD COLUMN "waiter_name" TEXT;
CREATE INDEX "table_tabs_waiter_id_idx" ON "table_tabs"("waiter_id");

-- Contas abertas antes disso: o responsável é quem abriu.
UPDATE "table_tabs" t
SET "waiter_id" = t."opened_by_id",
    "waiter_name" = NULLIF(array_to_string((regexp_split_to_array(trim(u."name"), '\s+'))[1:2], ' '), '')
FROM "users" u
WHERE u."id" = t."opened_by_id" AND t."waiter_id" IS NULL;
