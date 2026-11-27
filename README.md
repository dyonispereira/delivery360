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

## Salão (garçom)

- Em **Salão (garçom)** o dono cadastra as mesas (Mesa 1 a N de uma vez) e a taxa de serviço.
- O garçom toca na mesa, escolhe os itens no celular e envia: cada envio é um pedido de mesa que cai na
  cozinha e na impressora com o nome da mesa. A conta da mesa soma os envios até o fechamento.
- Conta da mesa: taxa de serviço opcional e quantos pagamentos precisar (vários cartões, Pix, dinheiro com troco),
  cada um dando baixa no que falta. A mesa só é liberada quando a conta está quitada.
- No financeiro, cada pagamento entra já pago com a sua forma: o consumo em 1.1 Salão e a parte da taxa de serviço
  em 11.3, fora da DRE (11.4 fica a repassar à equipe).

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

## Gestão (financeiro)

- Em **Gestão**, só dono e gerente: resumo do mês, contas a pagar, contas a receber, DRE e plano de contas.
- O plano de contas de restaurante (grupos 1 a 11) é criado sozinho para cada restaurante. Contas padrão
  podem ser renomeadas; contas novas ganham o próximo código do grupo.
- Lançamentos automáticos (fila `domain_events`, processada a cada 30 s e antes de cada consulta):
  venda do pedido (1.2), recebimento na entrega, cancelamento ou devolução de PIX (2.5),
  custo do motoboy por entrega (6.1) e gorjetas (11.1 entra, 11.2 repassa, fora da DRE).
  Cada lançamento automático tem chave única, então reprocessar não duplica.
- **Ficha técnica (CMV)** no cadastro do produto: custo item por item (ingredientes, embalagem, outros),
  custo dos adicionais, impostos e taxas (Gestão > Impostos e taxas), lucro em R$, % de resultado e preço sugerido.
  O custo fica gravado em cada venda; Gestão > Margem dos produtos mostra o lucro por produto e a DRE compara
  o CMV da ficha com as compras lançadas. Cada venda lança a taxa da forma de pagamento (2.3) e o imposto (2.1).
- Contas manuais podem repetir todo mês (ex.: aluguel 12x). A DRE usa a competência; o caixa usa a data da baixa.

## Canais de venda (iFood, 99Food, Keeta)

- Cada produto (e adicional) tem um **código PDV**, o mesmo cadastrado no portal de cada app. O pedido do app é reconhecido pelo código, com o nome e a ficha técnica do nosso cardápio; item sem código entra pelo nome e aparece como "sem código".
- Preço por app no produto (vazio = preço da loja) e "Resultado por canal" na ficha técnica.
- Cardápio › **Canais de venda**: liga cada app e informa comissão, taxa do pagamento online, dias para o repasse e o código da loja no app. Botão "Simular pedido" (só com `PAYMENTS_FAKE_ENABLED=true`).
- Entrada de pedidos: `POST /cardapio/canais/pedidos` no formato único (`ChannelOrderDto`); repetir o mesmo `externalId` não duplica. Os conectores de cada app (quando tivermos o acesso de parceiro) só convertem o pedido do app para este formato.
- Financeiro: receita na conta do app (1.3 iFood, 1.6 99Food, 1.7 Keeta), comissão 2.2 e taxa 2.3; pago no app vence no dia do repasse, pago na entrega é recebido ao finalizar. Gestão › **Canais de venda** mostra vendas, comissão, taxas, CMV e sobra por canal, e registra o repasse recebido (baixa da venda, comissão e taxa juntas). Margem dos produtos filtra por canal.
- Motoboy: pedido de app com código de entrega próprio pede ao cliente o código do app (em vez dos 4 últimos dígitos do telefone).

## Pessoas e folha (Gestão)

- Funcionários (CLT, PJ, diarista, estágio) com salário ou diária, vale-transporte e alimentação, folga fixa, admissão e desligamento.
- Escala do mês com folga fixa, folga extra, férias, atestado e falta (falta desconta 1/30 do salário de CLT e estágio).
- Folha gerencial do mês: extras, prêmio e adiantamento digitados; encargos (FGTS e INSS patronal, em Impostos e taxas) e reserva de férias + 1/3 e 13º calculados. Não substitui o eSocial nem os descontos de INSS/IR do funcionário (contador).
- Fechar a folha gera as contas a pagar: 4.1 salários (vence no dia do pagamento do mês seguinte), 4.2 extras e prêmios, 4.3 diárias, 4.4 encargos (dia 20), 4.5 benefícios, 4.6 reserva (20/12); adiantamento entra já pago. Folha fechada trava folgas e valores do mês; reabrir apaga os lançamentos se nada foi pago.

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
