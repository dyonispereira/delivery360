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
