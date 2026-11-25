#!/usr/bin/env bash
# Inicia o link de teste no Render: um serviço só com a API (porta interna 3333) e a web (porta do Render).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --filter @delivery360/api exec prisma migrate deploy
pnpm --filter @delivery360/api exec prisma db seed
# Pizzaria Simulada (idempotente; SEED_SIMULATION=false desliga). Se falhar, o site sobe mesmo assim.
node apps/api/dist/simulation/run.js || echo "[simulação] não foi criada"

PORT=3333 node apps/api/dist/main.js &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:3333/health >/dev/null && break
  sleep 1
done

cd apps/web
exec ./node_modules/.bin/next start -p "${PORT:-10000}"
