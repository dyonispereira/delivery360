/**
 * Cria a "Pizzaria Simulada" (30 dias de operação até hoje) no banco configurado em DATABASE_URL.
 * Idempotente: se a loja já existe, não faz nada. Uso: node dist/simulation/run.js
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GestaoSyncService } from '../gestao/gestao-sync.service';
import { GestaoService } from '../gestao/gestao.service';
import { PessoasService } from '../gestao/pessoas.service';
import { PrismaService } from '../prisma/prisma.service';
import { SIM_EMAIL, simulatePizzaria } from './pizzaria';

async function main() {
  if (process.env.SEED_SIMULATION === 'false') return;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const sync = app.get(GestaoSyncService, { strict: false });
    const gestao = app.get(GestaoService, { strict: false });
    const pessoas = app.get(PessoasService, { strict: false });
    const password = process.env.SEED_SIMULATION_PASSWORD || 'simulacao123';
    const started = Date.now();
    const created = await simulatePizzaria(
      prisma,
      {
        processPending: (tenantId) => sync.processPending(tenantId),
        upsert: (tenantId, key, e) =>
          prisma.$transaction(async (tx) => {
            await sync.upsert(tx, tenantId, key, e as never);
          }),
        registerPayout: (tenantId, userId, channel, until, paidAt) => gestao.registerPayout(tenantId, userId, channel, until, paidAt),
        payroll: (tenantId, month) => pessoas.payroll(tenantId, month),
        updatePayrollItem: (tenantId, userId, id, dto) => pessoas.updateItem(tenantId, userId, id, dto),
        closePayroll: (tenantId, userId, month) => pessoas.close(tenantId, userId, month),
      },
      { password, log: (m) => console.log(`[simulação] ${m}`) },
    );
    console.log(
      created
        ? `[simulação] Pizzaria Simulada criada em ${Math.round((Date.now() - started) / 1000)}s. Login: ${SIM_EMAIL}`
        : '[simulação] Pizzaria Simulada já existe; nada a fazer.',
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('[simulação] falhou:', e);
  process.exit(1);
});
