const { execSync } = require('node:child_process');
const path = require('node:path');

/**
 * Prepara o banco de TESTE: aplica as migrações (sem apagar nada) e esvazia as tabelas.
 * Por segurança, só roda se o nome do banco terminar em "_test".
 */
module.exports = async () => {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Recusado: os testes e2e só rodam em banco cujo nome termina em "_test" (recebido: ${dbName}).`);
  }
  process.env.DATABASE_URL = url;
  const cwd = path.resolve(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'inherit' });

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
  await prisma.$disconnect();

  execSync('npx prisma db seed', { cwd, env, stdio: 'inherit' });
};
