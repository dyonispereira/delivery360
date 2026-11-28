# Delivery360: panorama do projeto

Documento para passar a qualquer chat (Claude, ChatGPT etc.) e ele entender o projeto sem ler o código.
Atualizado em 28/11/2026. Repositório: github.com/dyonispereira/delivery360.

---

## 1. O que é

Delivery360 é um sistema modular para restaurantes e deliverys, vendido por uma empresa de gestão (do Dyonis) que vai
além do "gestor de iFood". Ela junta:

- **Venda:** loja online própria (Cardápio Digital), salão com garçom, PDV de balcão, iFood, 99Food e Keeta.
- **Operação:** painel de pedidos, cozinha (KDS), impressão térmica, entregas com motoboy e mapa ao vivo.
- **Gestão:** ficha técnica e CMV, margem por produto e por canal, financeiro (contas a pagar e receber), DRE,
  funcionários, folgas e folha.
- **Marketing:** cupons, campanhas da rede, fidelidade (pontos, clube, indicação) e tráfego pago (em construção).

**Diferencial:** "não só vende mais, mostra quanto você ganhou em cada pedido". Concorrentes como Anota AI, degusta.ai
e Saipos vendem o pedido; a Delivery360 mostra o lucro real (ficha técnica, taxa de cada canal, DRE e caixa que bate).

Cada restaurante é um *tenant* isolado. O painel admin da Delivery360 liga ou desliga módulos por cliente:
`gestao`, `cardapio`, `entregas` e `trafego`.

### Modelo de negócio (sugerido, não validado)
- Cardápio Digital: R$ 149/mês.
- Essencial: R$ 997.
- Crescimento: R$ 1.890 + verba.
- Gestão 360: R$ 2.990 a R$ 4.500 (todos com setup).

Referências de mercado:
- Anota AI: R$ 250 a 390.
- degusta.ai: R$ 310 a 400.
- Gestores de iFood: R$ 1 mil a 2,2 mil por mês.

---

## 2. Tecnologia

| Parte | Tecnologia |
| --- | --- |
| API | NestJS 11 + Prisma 6 + PostgreSQL (`apps/api`) |
| Site e painel | Next.js 16 + Tailwind 4 (`apps/web`) |
| Código comum | `packages/shared` (tipos e regras puras) |
| Pagamento | Asaas (conta de cada restaurante), Pix e cartão com checkout transparente |
| WhatsApp | Evolution API (número da loja via QR Code) |
| NFC-e | Interface pronta, emissor **simulado** (o emissor real ainda vai ser escolhido) |
| Hospedagem de teste | Render, plano grátis: https://delivery360-wgi4.onrender.com (deploy manual) |
| Testes | Jest: cerca de 110 unitários e 119 e2e; o CI roda em todo PR |

Dinheiro sempre em centavos. O fuso é Brasília. Os textos do sistema são em português simples.

---

## 3. Módulos e telas (o que já existe)

### 3.1 Cardápio Digital (loja online): `/loja/<slug>`
- Cardápio com categorias, adicionais, combos, preço de/por, "mais pedidos", banners e avaliações.
- Entrega por bairro (taxa por zona) ou retirada.
- Pagamento por Pix ou cartão online (Asaas), ou dinheiro ou maquininha na entrega.
- Cupons do restaurante e campanhas da rede; parte delas é bancada pela Delivery360 ("Impulso").
- **Fidelidade:** pontos por real gasto, prêmios, clube de níveis com desconto ou entrega grátis, e "Indique e Ganhe".
- **Pedido agendado:** o cliente escolhe dia e hora (funciona com a loja fechada). O pedido fica em "Agendados" e só
  entra na cozinha perto da hora.
- Acompanhamento em `/pedido/<código>`: status, mapa do motoboy, avaliação e gorjeta via Pix.

### 3.1b Totem de autoatendimento: `/totem/<slug>?t=<id>` (real) e `/totem/<slug>` (demonstração)
- Fluxo por toque: boas-vindas, comer aqui ou levar, cardápio com fotos, adicionais, carrinho, pagamento e senha.
- **Real (PR #36):** cadastro em PDV > Totens (nome, ligado/desligado, comer aqui/levar; modelo `Totem`). O pedido nasce
  `COUNTER` + `AWAITING_PAYMENT` com `totemId`, `consumption`, `ticket` (senha 100 a 999 pelo número) e `payHint`.
  **Sem maquininha integrada:** o cliente paga no caixa (maquininha comum, Pix ou dinheiro); o caixa toca em "Receber"
  na fila do PDV (Vender) e registra o que entrou. Só aí vai para painel/cozinha e entra no caixa (`CounterPayment`).
  Idempotente por `requestKey` (único por loja). Não pago some da fila em 3 h e não entra em nada; "Descartar" cancela.
- Financeiro: `pdv.venda_paga` → **1.9 Totem (autoatendimento)**, linha própria para medir o totem (Dyonis, 28/11). Migração `20261128040000_conta_totem` renumera conta própria 1.9 que já existia.
- Cupom e comanda: "Origem: Totem (autoatendimento)" (`orderOrigin(type, channel, !!totemId)`) + "Senha 136 · Comer aqui".
- Fornalha: totem fixo `7a0e0000-0000-4000-8000-000000000001`.
- **Demonstração:** sem `?t`, não cria pedido nem cobra. Opções `?consumo=aqui|levar|ambos` e `?observacao=nao`.
- Aviso de inatividade em 60 s; sem resposta em mais 20 s, limpa o carrinho e volta ao início.

### 3.2 Painel do restaurante: `/app`
- **Painel de pedidos:** colunas por status, alerta sonoro, impressão automática e detalhe do pedido.
- **Cozinha (KDS):** tela grande com os pedidos em preparo.
- **PDV (balcão):** veja a seção 4.
- **Salão (garçom):**
  - pensado para o celular: mesas, rodadas para a cozinha, "pronto para servir";
  - conta da mesa com taxa de serviço opcional, divisão e vários pagamentos;
  - o garçom só vê as mesas dele.
- **Fidelidade:** programa, prêmios, níveis, clientes e extrato.
- **Cardápio e pedidos:** cardápio, loja online, horários de agendamento, bairros, cupons, canais (iFood, 99Food, Keeta),
  pagamento online (Asaas) e WhatsApp.
- **Entregas:** motoboys (link secreto `/entregador/<token>`), lotes, código de 4 dígitos, ocorrências, histórico e mapa ao vivo.
- **Gestão (dono e gerente):**
  - plano de contas, lançamentos e DRE;
  - margem dos produtos e canais de venda (repasses);
  - impostos e taxas;
  - pessoas: funcionários, folgas e folha gerencial.
- **Admin Delivery360** (`/admin`): restaurantes, módulos por cliente, usuários e campanhas da rede.

### 3.3 Papéis
- Dono (OWNER).
- Gerente (MANAGER).
- Funcionário (STAFF): sem financeiro.
- Garçom (WAITER): só o salão.
- Equipe Delivery360: super admin e gestor de conta.

---

## 4. PDV e nota fiscal (PR #32)

- **Caixa:**
  - abre com o fundo de troco e registra sangria (tirar) e suprimento (colocar);
  - fecha contando a gaveta e mostra se bateu, faltou ou sobrou;
  - o resumo por forma de pagamento soma balcão e salão.
- **Venda:**
  - itens do cardápio, cliente opcional, CPF/CNPJ na nota e desconto;
  - vai para a cozinha ou sai entregue na hora.
- **Pagamento:**
  - Dinheiro (com troco), Pix, Débito ou Crédito;
  - **vários cartões** na mesma venda;
  - **rateio entre clientes** (divide o total por N pessoas, cada uma com a sua forma e o seu nome).
- **Cupom:** em cada venda, **não fiscal ou NFC-e**. Sai na térmica (58 ou 80 mm, com vias e rodapé) e em **PDF**.
- **Origem em todo cupom:** PDV (balcão), Cardápio Digital, Salão, iFood, 99Food ou Keeta.
- **NFC-e:**
  - dados fiscais (CNPJ, IE, UF, regime, CSC, série, NCM/CFOP/CSOSN padrão e por produto);
  - chave de acesso, QR Code, cancelamento em até 30 min;
  - **emissor simulado** por enquanto (homologação, sem valor fiscal).
- **Financeiro:** cada pagamento do balcão entra pago na conta 1.8 Balcão (PDV).

---

## 5. Regras de negócio do Dono (não mudar sem falar com o Dyonis)

1. **O caixa e as contas a receber mostram o valor que o cliente pagou de fato**, para bater no fechamento.
   Descontos, cupons, promoções e fidelidade aparecem só como dedução na DRE (conta 2.4).
2. **Pagamento online pelo Asaas, na conta de cada restaurante.** A Delivery360 não guarda dinheiro. Pix e cartão com
   checkout transparente (sem telas do Asaas).
3. **WhatsApp de status** sai do número da própria loja (QR Code, Evolution API), não da API oficial da Meta.
4. **Todo cupom (fiscal ou não) mostra a origem do pedido.**
5. **No PDV, a loja escolhe cupom não fiscal ou NFC-e** em cada venda (há donos que não emitem nota).
6. **No PDV pode haver vários cartões e rateio entre clientes.**
7. Escolhas feitas por mim e ainda não confirmadas pelo Dyonis:
   - o clube da fidelidade não soma com cupom;
   - os pontos só entram com o pedido entregue;
   - o pedido agendado continua "pago", com marcação de "agendado".

### Plano de contas (resumo)
- **Receita:**
  - 1.1 Salão;
  - 1.2 Loja online;
  - 1.3 iFood;
  - 1.6 99Food;
  - 1.7 Keeta;
  - 1.8 Balcão (PDV).
- **Deduções:**
  - 2.1 Impostos;
  - 2.2 Comissão de apps;
  - 2.3 Taxas de cartão e Pix;
  - 2.4 Descontos (só DRE);
  - 2.5 Cancelamentos.
- **Custos e despesas:**
  - 3.x CMV;
  - 4.x Pessoal;
  - 5.x Ocupação;
  - 6.x Entrega;
  - 7.x Marketing;
  - 8.x Administrativas.
- **Fora da DRE:** 11.x Valores de terceiros (gorjetas e taxa de serviço).

---

## 6. Histórico de entregas (PRs)

| PR | O que entregou |
| --- | --- |
| #1 a #5 | Fundação, loja online, painel e cozinha, entregas com motoboy, mapa ao vivo |
| #7 a #11 | Ocorrências e avaliação, Gestão financeira, ficha técnica e CMV, canais (iFood, 99Food, Keeta), pessoas e folha, Pizzaria Simulada |
| #12 a #26 | Ajustes de loja, cupons e campanhas, Asaas (Pix e cartão), WhatsApp, Fornalha (loja modelo com fotos), financeiro pelo valor pago |
| #27, #29, #31 | Salão e garçom, papel Garçom, mesas por garçom |
| #28 | Fidelidade |
| #30 | Pedido agendado |
| #32 | PDV, caixa, cupom não fiscal e NFC-e, PDF, impressoras, origem no cupom, rateio |
| #33 | Totem de autoatendimento em modo demonstração |
| #38 | Importação simulada do cardápio do iFood (prévia, sem duplicar, preço do iFood separado) |
| #36, #37 | Totem real: cadastro, pedido com senha e comer aqui/levar, paga no caixa (sem maquininha), fila no PDV, cozinha; receita em 1.9 Totem |
| #34 | Hub iFood (1º PR, simulado): webhook `POST /public/webhooks/ifood` assinado (`IFOOD_WEBHOOK_SECRET`), restaurante pelo merchantId, eventos com estado e reprocessamento, vínculo com situação do iFood, cancelamento, comissão/taxa/desconto do iFood no financeiro |

---

## 7. O que falta (ordem combinada)

Lista de diferenças para a degusta.ai, um item por vez:
1. ~~Fidelidade~~ (feito)
2. ~~Pedido agendado~~ (feito)
3. ~~PDV e NFC-e~~ (PR #32; falta escolher o **emissor real** de NFC-e: Focus NFe recomendado, ou Nuvem Fiscal ou PlugNotas)
4. **Hub iFood**: 1º PR (#34, simulado) feito; importação do cardápio simulada (PR #38: Cardápio > Canais de venda, prévia + confirmação, tabela `ifood_catalog_links`, reimportar não duplica, preço novo só em `channelPrices.IFOOD`); falta a ligação real (conta de parceiro, OAuth, catálogo real, confirmar/despachar pela API)
5. **Marketing extra:** domínio próprio, Meta Pixel e Google Analytics, mapa de calor, várias impressoras
6. **Robô de WhatsApp com IA** (por último, a pedido do Dyonis)

Divisão de trabalho: o Dyonis alterna entre esta thread e outro chat. Se o outro chat não conseguir dar push, ele manda um `.patch` (`git format-patch`), que aplicamos com `git am` e viramos PR. O estado de cada item fica na descrição do PR e neste arquivo.

Outras pendências:
- Servidor Evolution (WhatsApp) no ar.
- App nativo do entregador (contas Apple e Google).
- NFC-e do salão.
- Transferir mesa.
- Pedido por QR Code na mesa.
- Teste real de entrega.

---

## 8. Acessos de teste

- Link: https://delivery360-wgi4.onrender.com (dorme após 15 min; o 1º acesso demora cerca de 1 min).
- Loja modelo: `/loja/fornalha`. Dono `dono@fornalha.local` (senha na variável `SEED_DEMO_PASSWORD` do Render).
  A Fornalha já vem com NFC-e em homologação para testar o PDV.
- As senhas ficam no Render (Environment). Nunca coloque senhas ou chaves em chat.
- Guia de deploy: `docs/deploy-teste.md`.

---

## 9. Como pedir trabalho (para gastar menos)

- Peça **um item por vez**, com tudo o que importa na mesma mensagem (regras, exemplos, telas).
  Pedido fatiado em várias mensagens faz o trabalho ser refeito.
- Prefira **texto ou .md** a muitas imagens. Use print só quando a tela importa.
- Para ideias, estratégia, preço e textos de venda, use um chat comum com este arquivo anexado.
  Deixe o projeto de código só para construir.
- Ao começar um assunto novo, abra uma conversa nova: ela lê o `CLAUDE.md` e a memória em vez de carregar o histórico inteiro.
