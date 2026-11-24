import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MODULES, MODULE_CODES, type ModuleCode } from '@delivery360/shared';

const prisma = new PrismaClient();

/** Planos comerciais iniciais (podem ser ajustados no banco ou no admin). */
const PLANS: Record<string, ModuleCode[]> = {
  'Cardápio Digital': ['cardapio'],
  Essencial: ['gestao', 'cardapio'],
  Crescimento: ['gestao', 'cardapio', 'entregas', 'trafego'],
  'Gestão 360': ['gestao', 'cardapio', 'entregas', 'trafego'],
};

async function main() {
  for (const code of MODULE_CODES) {
    const def = MODULES[code];
    await prisma.module.upsert({
      where: { code },
      update: { name: def.name, description: def.description },
      create: { code, name: def.name, description: def.description },
    });
  }

  for (const [name, modules] of Object.entries(PLANS)) {
    const plan = await prisma.plan.upsert({ where: { name }, update: {}, create: { name } });
    await prisma.planModule.deleteMany({ where: { planId: plan.id } });
    await prisma.planModule.createMany({
      data: modules.map((moduleCode) => ({ planId: plan.id, moduleCode })),
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@delivery360.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Administrador',
      email,
      passwordHash: await bcrypt.hash(password, 10),
      staffRole: 'SUPER_ADMIN',
    },
  });

  console.log(`Seed concluído. Super admin: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
