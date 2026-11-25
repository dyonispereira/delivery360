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

  if (process.env.SEED_DEMO === 'true') await seedDemo();
}

/** Restaurante de demonstração para o link de teste (só roda com SEED_DEMO=true e só uma vez). */
async function seedDemo() {
  const slug = 'pizzaria-demo';
  if (await prisma.store.findUnique({ where: { slug } })) return;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { name: 'Gestão 360' }, include: { modules: true } });
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Pizzaria Demo',
      planId: plan.id,
      modules: { create: plan.modules.map((m) => ({ moduleCode: m.moduleCode, active: true, startsAt: new Date() })) },
    },
  });
  const email = process.env.SEED_DEMO_EMAIL ?? 'dono@pizzaria-demo.local';
  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
  const owner = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'Dono Demo', email, passwordHash: await bcrypt.hash(password, 10) },
  });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: tenant.id, role: 'OWNER' } });
  await prisma.store.create({
    data: { tenantId: tenant.id, slug, displayName: 'Pizzaria Demo', description: 'Pizzas no forno a lenha', isOpen: true, minOrderCents: 2000 },
  });
  await prisma.deliveryZone.createMany({
    data: [
      { tenantId: tenant.id, name: 'Centro', feeCents: 600 },
      { tenantId: tenant.id, name: 'Jardim América', feeCents: 900 },
    ],
  });
  const pizzas = await prisma.menuCategory.create({ data: { tenantId: tenant.id, name: 'Pizzas', position: 0 } });
  const bebidas = await prisma.menuCategory.create({ data: { tenantId: tenant.id, name: 'Bebidas', position: 1 } });
  const sabores: [string, string, number][] = [
    ['Calabresa', 'Molho, mussarela, calabresa e cebola', 4500],
    ['Margherita', 'Molho, mussarela, tomate e manjericão', 4800],
    ['Frango com Catupiry', 'Molho, frango desfiado e catupiry', 5200],
  ];
  for (const [i, [name, description, priceCents]] of sabores.entries()) {
    const product = await prisma.product.create({
      data: { tenantId: tenant.id, categoryId: pizzas.id, name, description, priceCents, position: i },
    });
    await prisma.optionGroup.create({
      data: {
        tenantId: tenant.id, productId: product.id, name: 'Borda', minSelect: 1, maxSelect: 1, position: 0,
        options: { create: [
          { tenantId: tenant.id, name: 'Tradicional', priceCents: 0, position: 0 },
          { tenantId: tenant.id, name: 'Catupiry', priceCents: 800, position: 1 },
          { tenantId: tenant.id, name: 'Cheddar', priceCents: 800, position: 2 },
        ] },
      },
    });
    await prisma.optionGroup.create({
      data: {
        tenantId: tenant.id, productId: product.id, name: 'Adicionais', minSelect: 0, maxSelect: 3, position: 1,
        options: { create: [
          { tenantId: tenant.id, name: 'Bacon', priceCents: 500, position: 0 },
          { tenantId: tenant.id, name: 'Azeitona', priceCents: 300, position: 1 },
        ] },
      },
    });
  }
  await prisma.product.createMany({
    data: [
      { tenantId: tenant.id, categoryId: bebidas.id, name: 'Refrigerante 2L', priceCents: 1400, position: 0 },
      { tenantId: tenant.id, categoryId: bebidas.id, name: 'Suco natural 500ml', priceCents: 1000, position: 1 },
    ],
  });
  console.log(`Restaurante demo criado: /loja/${slug} (dono: ${email})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
