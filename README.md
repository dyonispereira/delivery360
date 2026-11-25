# Delivery360

Sistema modular de gestão para restaurantes e deliverys: loja online com pedido e pagamento,
painel de pedidos, cozinha, entregas com motoboys, gestão (funcionários, folha, folgas, financeiro, DRE)
e tráfego. Cada módulo é ligado ou desligado por restaurante no painel admin.

## Estrutura

```
apps/
  api/              NestJS + Prisma + PostgreSQL
  web/              Next.js: painel admin, sistema do restaurante (e, em breve, loja online e cozinha)
  app-entregador/   App iOS/Android (Expo) — Sprints 4 e 5
  app-gerente/      App iOS/Android (Expo) — Sprints 8 e 9
packages/
  shared/           Códigos de módulo, papéis e tipos usados pela API, web e apps
docs/               Plano de desenvolvimento
```

## Como rodar

Requisitos: Node 22+, pnpm 10+, PostgreSQL 16 (ou Docker).

```bash
pnpm install
docker compose up -d                # Postgres em localhost:5432 (ou use um Postgres seu)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @delivery360/shared build
pnpm db:migrate                     # cria as tabelas
pnpm db:seed                        # módulos, planos e o super admin
pnpm dev                            # API em :3333 e web em :3000
```

Login inicial (só desenvolvimento): `admin@delivery360.local` / `admin123`
(mude em `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` antes de rodar o seed em produção).

## Testes

```bash
pnpm --filter @delivery360/api test        # regras de acesso
pnpm --filter @delivery360/api test:e2e    # API completa contra o banco delivery360_test
```

Os testes e2e esvaziam o banco de teste a cada execução e se recusam a rodar se o nome do banco
não terminar em `_test`. Crie-o com `createdb delivery360_test` (ou ajuste `TEST_DATABASE_URL`).

## Loja online (módulo Cardápio)

- O restaurante monta o cardápio em **Cardápio e pedidos**: categorias, produtos, grupos de adicionais
  (mínimo e máximo de escolhas), bairros com taxa de entrega, formas de pagamento e abre/fecha a loja.
- A loja pública fica em `/loja/<endereço>` (ex.: `/loja/pizzaria-do-ze`). O cliente escolhe os
  produtos e adicionais, monta o carrinho e paga. Parâmetros `utm_source` e `utm_campaign` no link
  ficam gravados no pedido para o módulo de Tráfego medir de onde veio a venda.
- O acompanhamento fica em `/pedido/<código>` e atualiza sozinho.
- Os preços são sempre recalculados na API; o navegador só mostra.
- **Pagamento:** PIX, dinheiro e cartão na entrega. Enquanto o gateway real não entra, o PIX usa um
  gateway de teste, ligado por `PAYMENTS_FAKE_ENABLED="true"`, que mostra o botão "Simular pagamento".
  **Nunca ligue isso em produção.** PIX não pago expira em 15 minutos.

## Entregas (módulo Entregas)

- Em **Entregas > Motoboys**, o restaurante cadastra o motoboy (nome, celular e quanto paga por entrega)
  e envia pelo WhatsApp o link pessoal dele: `/entregador/<link>`. "Gerar novo link" derruba o antigo.
- Com o módulo ligado, o pedido de entrega para em "Pronto" no painel. Em **Entregas > Lotes**,
  marca-se os pedidos que saem juntos, escolhe-se o motoboy e eles passam para "Em entrega".
- Na tela do entregador (celular), ele vê endereço, mapa, quanto cobrar e troco. Para finalizar,
  digita os **4 últimos dígitos do telefone do cliente**. O motoboy não vê esses dígitos. Depois de
  5 erros o código trava até o dono ou gerente liberar.
- Cada entrega confirmada gera o evento `entrega.concluida` com o valor pago ao motoboy, para a Gestão.
- Ao confirmar, o motoboy informa **o nome de quem recebeu**. Cada tentativa fica registrada
  (motoboy, placa, data e hora, código conferido, quem recebeu, posição do celular). O motoboy não
  altera depois; só o dono ou gerente corrige, com auditoria. No painel, clique no pedido para ver a ficha.
- **Não consegui entregar**: endereço não localizado, cliente não atende (ex.: dormindo), cliente recusou,
  ou outro motivo. O pedido volta para "Pronto" marcado com a ocorrência, e o restaurante reenvia
  (novo lote) ou cancela. Evento `entrega.ocorrencia`.
- A tela do motoboy avisa com som e vibração quando chega pedido para ele e tem a aba **Histórico**
  (30 dias, só leitura).
- Depois de entregue, o cliente **avalia** restaurante e entrega (1 a 5 estrelas, com comentário) e pode
  dar **gorjeta por PIX** ao motoboy. A gorjeta entra no caixa do restaurante (evento `gorjeta.recebida`,
  valor a repassar, não receita) e em **Entregas > Gorjetas** o dono marca o repasse (`gorjeta.repassada`).

## Como funcionam os módulos

- Códigos: `gestao`, `cardapio`, `entregas`, `trafego` (`packages/shared/src/modules.ts`).
- O admin liga/desliga cada módulo por restaurante (com data de fim opcional, para teste grátis),
  ou troca o plano, que liga os módulos do plano e desliga os demais. Nada é apagado ao desligar.
- Na API, `@RequireModule('gestao')` bloqueia a rota se o módulo não estiver ativo para o restaurante
  do cabeçalho `x-tenant-id`. O menu da web usa a mesma lista (`GET /tenant/context`).

## Perfis

| Perfil | Pode |
| --- | --- |
| Super admin | Tudo: restaurantes, planos, módulos, status, equipe, auditoria |
| Gestor de conta | Ver e editar os restaurantes da sua carteira e seus usuários; entrar como cliente |
| Dono / Gerente / Funcionário | Usar o sistema do restaurante nos módulos contratados |
