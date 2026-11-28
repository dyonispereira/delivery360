# Delivery360: guia rápido para o Claude

Lido automaticamente em toda sessão. Mantenha curto. O panorama completo do produto está em `docs/PROJETO.md`.

## Stack
- Monorepo pnpm + Turborepo.
- `apps/api`: NestJS 11, Prisma 6 e Postgres (centavos em `Int`). Os módulos ficam em `src/<modulo>`.
- `apps/web`: Next 16 (app router, client components) e Tailwind 4. Utilitários `card`, `btn-primary`, `btn-ghost`, `input` e `label` em `globals.css`.
- `packages/shared`: tipos e regras puras usados pela API e pela web. **Recompile depois de mudar** (`pnpm --filter @delivery360/shared build`).

## Comandos
```bash
service postgresql start                       # container: Postgres local (delivery/delivery; bancos delivery360 e delivery360_test)
pnpm --filter @delivery360/shared build
pnpm typecheck                                 # o CI roda: typecheck, test, test:e2e e web build
pnpm --filter @delivery360/api test            # unitários (*.spec.ts ao lado do código)
pnpm --filter @delivery360/api test:e2e        # e2e no delivery360_test (trunca o banco)
pnpm --filter @delivery360/web build
```
Migração nova:
1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<AAAAMMDDhhmmss>_<nome>/migration.sql`
2. `migrate deploy` nos dois bancos.

Nunca use `migrate reset` nem `migrate dev`.

## Convenções
- Textos de tela, erros e comentários em **português do Brasil**, simples (o dono não é técnico).
- Dinheiro sempre em centavos. O fuso é Brasília (UTC−3 fixo); veja `cardapio/schedule.ts` e `gestao/chart.ts`.
- Acesso:
  - `@RequireModule('cardapio')` e cabeçalho `x-tenant-id`;
  - papéis com `@TenantRoles('OWNER','MANAGER')`;
  - o garçom (`WAITER`) só usa o salão (`@WaiterAllowed`).
- Financeiro por eventos de domínio:
  - `events.publish(...)` alimenta o `GestaoSyncService`, que gera `FinancialEntry` idempotente por `externalKey`;
  - `memo: true` = só DRE.
- Regras puras em módulos próprios com spec (`order-pricing.ts`, `coupon-rules.ts`, `loyalty-rules.ts`, `schedule.ts`, `fiscal/nfce.ts`).
- Demonstração: a Fornalha (`prisma/showcase.ts`, `addExtras()` idempotente, roda com `SEED_DEMO=true`). Login `dono@fornalha.local`.
- Não comite `apps/web/AGENTS.md` nem `apps/web/tsconfig.tsbuildinfo` (gerados pelo `next dev`).

## Regras do dono (Dyonis): não quebrar
1. **Caixa e contas a receber = valor que o cliente pagou de fato.** Descontos, cupons e fidelidade aparecem só como dedução na DRE (2.4).
2. **Pagamento online: Asaas**, na conta de cada restaurante (checkout transparente, Pix e cartão). A Delivery360 não guarda dinheiro.
3. **WhatsApp de status:** número da própria loja via QR Code (Evolution API).
4. **Todo cupom (fiscal ou não, térmica ou PDF) mostra a ORIGEM do pedido:**
   - PDV (balcão), Cardápio Digital, Salão, iFood, 99Food ou Keeta;
   - use `orderOrigin()` de `@delivery360/shared`.
5. No PDV, cada venda escolhe **cupom não fiscal ou NFC-e**. O pagamento pode ter vários cartões e rateio entre clientes.

## Fluxo de trabalho
- Um PR por item, com prints em `/mnt/project-files/<item>/`.
- Respostas ao dono curtas e em português.
- O deploy no Render (link de teste) é **manual**: lembre o Dyonis depois de cada merge.
