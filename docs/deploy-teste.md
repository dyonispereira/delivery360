# Link de teste no Render

Um serviço só (API + site) e um banco Postgres, nos planos grátis do Render. Serve para testar e
mostrar ao restaurante piloto; não é a hospedagem de produção.

## Passo a passo

1. Crie uma conta em https://render.com (pode entrar com o GitHub).
2. Em **New > Blueprint**, conecte o GitHub e escolha o repositório `delivery360`.
3. O Render lê o `render.yaml`, mostra o banco `delivery360-db` e o serviço `delivery360`. Clique em **Apply**.
4. A primeira publicação leva uns 5 a 10 minutos. O link aparece no serviço `delivery360`
   (algo como `https://delivery360-xxxx.onrender.com`).

## Acessos

As senhas são geradas pelo Render. Veja em **delivery360 > Environment**:

| Quem | E-mail | Senha (variável) |
| --- | --- | --- |
| Super admin | `admin@delivery360.app` | `SEED_ADMIN_PASSWORD` |
| Dono da Pizzaria Demo | `dono@pizzaria-demo.local` | `SEED_DEMO_PASSWORD` |
| Dono da Pizzaria Simulada | `dono@pizzaria-simulada.local` | `SEED_SIMULATION_PASSWORD` (sem a variável: `simulacao123`) |
| Dono da Fornalha Pizzaria (loja modelo) | `dono@fornalha.local` | `SEED_DEMO_PASSWORD` |

Loja de demonstração: `<link>/loja/pizzaria-demo`. O PIX é simulado (botão "Simular pagamento").

Loja modelo para apresentar a clientes: `<link>/loja/fornalha`. É uma pizzaria fictícia completa, com logo, capa, fotos ilustradas dos
produtos, banners, ofertas de/por, cupons, combo e avaliações. As imagens ficam em `apps/web/public/vitrine/fornalha` e são
geradas por `node apps/web/scripts/vitrine/render.mjs` (desenhadas em SVG, sem fotos de terceiros).

A **Pizzaria Simulada** (`<link>/loja/pizzaria-simulada`) é criada uma vez, no primeiro deploy, com 30 dias de operação
até aquele dia: cerca de R$ 80 mil em vendas (loja, iFood, 99Food e Keeta), 10 funcionários (2 de férias, 2 com férias
vencendo no mês seguinte), 5 motoboys, aluguel, energia, água, internet, compras de fornecedores, folha do mês anterior
fechada e a do mês atual em rascunho. Também deixa pedidos em andamento (novos, em preparo, prontos e na rua).
Para não criar, use `SEED_SIMULATION=false`. Localmente: `pnpm --filter @delivery360/api build && node apps/api/dist/simulation/run.js`.

## Limites do plano grátis

- O serviço dorme após 15 minutos sem uso; o primeiro acesso depois disso demora cerca de 1 minuto.
- O banco grátis do Render expira em 30 dias. Para continuar, troque para um plano pago ou outro banco.
- Cada `git push` na `main` publica de novo automaticamente.

## WhatsApp da loja (status do pedido)

O cliente recebe no WhatsApp cada etapa do pedido (aprovado, em preparo, aguardando entregador, saiu para entrega, entregue com o link da avaliação). As mensagens saem do número do próprio restaurante, conectado por QR Code em **Cardápio > Loja online > WhatsApp da loja**.

Para isso o Delivery360 usa um servidor [Evolution API](https://github.com/EvolutionAPI/evolution-api) (código aberto), que mantém o WhatsApp de cada loja conectado. Ele precisa ficar ligado o tempo todo, então **não** roda no plano grátis do Render (que dorme depois de 15 minutos).

1. Suba a Evolution API v2 (imagem Docker oficial, veja o README do projeto) num serviço sempre ligado, por exemplo Render Starter ou uma VPS. Ela precisa de um Postgres próprio (`DATABASE_PROVIDER=postgresql` e `DATABASE_CONNECTION_URI`) e de uma chave (`AUTHENTICATION_API_KEY`).
2. No serviço `delivery360` do Render, preencha `WHATSAPP_API_URL` (endereço da Evolution, por exemplo `https://evolution.suaempresa.com.br`) e `WHATSAPP_API_KEY` (a mesma `AUTHENTICATION_API_KEY`).
3. Faça o deploy e, no painel da loja, clique em **Conectar WhatsApp** e leia o QR Code com o celular da loja.

Observações:
- É uma conexão não oficial (como Anota AI e outros fazem). Use um número do restaurante e evite mandar mensagens em massa, para o WhatsApp não bloquear o número.
- Se o WhatsApp cair, os avisos esperam na fila por até 2 horas e saem em ordem quando ele volta. O painel mostra "Desconectado".
- Em desenvolvimento, `WHATSAPP_FAKE_ENABLED=true` simula a conexão (o QR "conecta" sozinho) e não manda nada de verdade.
