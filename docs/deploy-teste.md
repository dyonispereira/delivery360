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

Loja de demonstração: `<link>/loja/pizzaria-demo`. O PIX é simulado (botão "Simular pagamento").

## Limites do plano grátis

- O serviço dorme após 15 minutos sem uso; o primeiro acesso depois disso demora cerca de 1 minuto.
- O banco grátis do Render expira em 30 dias. Para continuar, troque para um plano pago ou outro banco.
- Cada `git push` na `main` publica de novo automaticamente.
