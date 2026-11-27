-- Financeiro pelo valor real: a venda da loja passa a ser o que o cliente pagou.
-- Preço cheio e descontos (promoção e cupom do restaurante) viram lançamentos só de DRE (memo), fora do caixa.
ALTER TABLE "financial_entries" ADD COLUMN "memo" BOOLEAN NOT NULL DEFAULT false;

-- Descontos já lançados viram memo.
UPDATE "financial_entries"
SET "memo" = true
WHERE "source" = 'cardapio'
  AND "external_key" ~ '^order:[^:]+:(promo|coupon)$';

-- Para cada venda com desconto: cria o "preço cheio" (memo) e reduz a venda ao valor pago.
WITH d AS (
  SELECT "tenant_id", split_part("external_key", ':', 2) AS order_id, SUM("amount_cents") AS cents
  FROM "financial_entries"
  WHERE "source" = 'cardapio' AND "external_key" ~ '^order:[^:]+:(promo|coupon)$'
  GROUP BY "tenant_id", split_part("external_key", ':', 2)
), s AS (
  SELECT f.*, d.cents
  FROM "financial_entries" f
  JOIN d ON d."tenant_id" = f."tenant_id" AND f."external_key" = 'order:' || d.order_id || ':sale'
  WHERE f."source" = 'cardapio'
), ins AS (
  INSERT INTO "financial_entries" (
    "id", "tenant_id", "type", "account_id", "description", "counterparty", "amount_cents", "competence_date", "due_date",
    "status", "paid_at", "notes", "payment_method", "channel", "source", "external_key", "memo", "created_at", "updated_at"
  )
  SELECT gen_random_uuid(), s."tenant_id", s."type", s."account_id",
         'Preço cheio (antes dos descontos) · ' || regexp_replace(s."description", ' \(retirada\)$', ''),
         s."counterparty", s.cents, s."competence_date", s."due_date", s."status", s."paid_at", s."notes",
         s."payment_method", s."channel", s."source", replace(s."external_key", ':sale', ':gross'), true, NOW(), NOW()
  FROM s
  ON CONFLICT ("tenant_id", "external_key") DO NOTHING
  RETURNING "tenant_id", "external_key"
)
UPDATE "financial_entries" f
SET "amount_cents" = f."amount_cents" - s.cents, "updated_at" = NOW()
FROM s
WHERE f."id" = s."id";
