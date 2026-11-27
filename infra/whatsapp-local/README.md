# WhatsApp de teste no seu computador

Roda a Evolution API (o servidor que mantém o WhatsApp da loja conectado) no seu computador, com um túnel gratuito da Cloudflare para o link de teste no Render enxergar. Bom para testar com celular de verdade antes de contratar hospedagem. **Só funciona com o computador ligado e o Docker aberto.**

## Uma vez só

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/) e abra-o.
2. Nesta pasta (`infra/whatsapp-local`), copie `.env.example` para `.env` e troque a senha por um texto longo seu.

## Cada vez que for testar

1. Nesta pasta, rode: `docker compose up -d`
2. Pegue o endereço do túnel: `docker compose logs tunnel | grep trycloudflare` (no Windows: `docker compose logs tunnel` e procure `https://....trycloudflare.com`).
3. No Render (serviço `delivery360` > Environment), preencha:
   - `WHATSAPP_API_URL` = o endereço `https://....trycloudflare.com`
   - `WHATSAPP_API_KEY` = a mesma senha do `.env`
   - Clique em **Save, rebuild and deploy**.
4. No painel da loja: **Cardápio > Loja online > WhatsApp da loja > Conectar WhatsApp** e leia o QR Code com o celular da loja.

O endereço do túnel muda toda vez que o Docker reinicia: aí é preciso atualizar o `WHATSAPP_API_URL` no Render. O WhatsApp conectado continua salvo.

Para desligar: `docker compose down` (os dados ficam). Para apagar tudo: `docker compose down -v`.
