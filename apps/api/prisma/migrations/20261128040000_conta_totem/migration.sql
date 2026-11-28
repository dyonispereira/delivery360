-- Conta 1.9 "Totem (autoatendimento)" entra no plano padrão (criada pelo sistema quando faltar).
-- Se o restaurante já criou uma conta própria com o código 1.9, ela ganha o próximo número livre do grupo 1
-- (os lançamentos continuam nela; só o código muda).
UPDATE "accounts" a
SET "code" = '1.' || (
  SELECT COALESCE(MAX(NULLIF(split_part(b."code", '.', 2), '')::int), 0) + 1
  FROM "accounts" b
  WHERE b."tenant_id" = a."tenant_id" AND b."group" = 1 AND split_part(b."code", '.', 2) ~ '^[0-9]+$'
)
WHERE a."code" = '1.9' AND a."system" = false;
