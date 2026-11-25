import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { MODULES, MODULE_CODES, type ModuleCode } from '@delivery360/shared';
import { DEFAULT_ACCOUNTS, GROUPS } from '../src/gestao/chart';

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
  const existing = await prisma.store.findUnique({ where: { slug } });
  if (existing) {
    await seedDemoCourier(existing.tenantId);
    await seedDemoCosts(existing.tenantId);
    await seedDemoChannels(existing.tenantId);
    await seedDemoPeople(existing.tenantId);
    return seedDemoFinance(existing.tenantId);
  }
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
  await seedDemoCourier(tenant.id);
  await seedDemoCosts(tenant.id);
  await seedDemoChannels(tenant.id);
  await seedDemoPeople(tenant.id);
  await seedDemoFinance(tenant.id);
  console.log(`Restaurante demo criado: /loja/${slug} (dono: ${email})`);
}

/** Motoboy de demonstração (criado também em demos antigas, que não tinham). */
async function seedDemoCourier(tenantId: string) {
  if (await prisma.courier.count({ where: { tenantId } })) return;
  await prisma.courier.create({
    data: { tenantId, name: 'Carlos Demo', phone: '5511900000000', feeCents: 700, plate: 'ABC1D23', accessToken: randomBytes(18).toString('base64url') },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/** Algumas contas a pagar de exemplo para a Gestão do restaurante demo não abrir vazia. */
async function seedDemoFinance(tenantId: string) {
  if (await prisma.financialEntry.count({ where: { tenantId, source: 'manual' } })) return;
  await prisma.account.createMany({
    data: DEFAULT_ACCOUNTS.map(([code, name]) => {
      const group = Number(code.split('.')[0]);
      return { tenantId, code, name, group, kind: GROUPS.find((g) => g.group === group)!.kind, system: true };
    }),
    skipDuplicates: true,
  });
  const accounts = await prisma.account.findMany({ where: { tenantId } });
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const day = (d: number) => new Date(`${today.slice(0, 8)}${String(d).padStart(2, '0')}T00:00:00Z`);
  const first = day(1);
  const items: [string, string, string, number, number, boolean][] = [
    ['5.1', 'Aluguel', 'Imobiliária Centro', 350_000, 10, true],
    ['5.2', 'Conta de energia', 'Concessionária', 89_000, 15, true],
    ['3.1', 'Compra de queijo e calabresa', 'Distribuidora Boa Massa', 420_000, 20, false],
    ['3.3', 'Caixas de pizza', 'Embalagens Já', 65_000, 25, false],
    ['8.1', 'Honorários do contador', 'Contabilidade Silva', 45_000, 5, true],
    ['7.1', 'Anúncios Instagram', 'Meta', 60_000, 28, false],
  ];
  await prisma.financialEntry.createMany({
    data: items.map(([code, description, counterparty, amountCents, d, paid]) => ({
      tenantId,
      type: 'PAYABLE' as const,
      accountId: id(code),
      description,
      counterparty,
      amountCents,
      competenceDate: first,
      dueDate: day(d),
      status: paid ? ('PAID' as const) : ('OPEN' as const),
      paidAt: paid ? day(d) : null,
    })),
  });
}

/** Fichas técnicas de exemplo e impostos/taxas do restaurante demo (só preenche o que está vazio). */
async function seedDemoCosts(tenantId: string) {
  await prisma.financeSettings.upsert({
    where: { tenantId },
    create: { tenantId, salesTaxBps: 600, pixFeeBps: 99, creditFeeBps: 400, cardOnDeliveryFeeBps: 250, targetMarginBps: 2000 },
    update: {},
  });
  const sheets: Record<string, [string, 'INGREDIENT' | 'PACKAGING' | 'OTHER', number][]> = {
    Calabresa: [['Massa', 'INGREDIENT', 350], ['Molho de tomate', 'INGREDIENT', 150], ['Mussarela', 'INGREDIENT', 900], ['Calabresa', 'INGREDIENT', 600], ['Cebola e azeitona', 'INGREDIENT', 120], ['Caixa de pizza', 'PACKAGING', 250]],
    Margherita: [['Massa', 'INGREDIENT', 350], ['Molho de tomate', 'INGREDIENT', 150], ['Mussarela', 'INGREDIENT', 900], ['Tomate e manjericão', 'INGREDIENT', 250], ['Caixa de pizza', 'PACKAGING', 250]],
    'Frango com Catupiry': [['Massa', 'INGREDIENT', 350], ['Molho de tomate', 'INGREDIENT', 150], ['Frango desfiado', 'INGREDIENT', 700], ['Catupiry', 'INGREDIENT', 650], ['Caixa de pizza', 'PACKAGING', 250]],
    'Refrigerante 2L': [['Refrigerante 2L', 'INGREDIENT', 700]],
    'Suco natural 500ml': [['Frutas', 'INGREDIENT', 250], ['Copo e tampa', 'PACKAGING', 60]],
  };
  const products = await prisma.product.findMany({ where: { tenantId } });
  for (const p of products) {
    const sheet = sheets[p.name];
    if (!sheet || (Array.isArray(p.costItems) && p.costItems.length > 0)) continue;
    await prisma.product.update({ where: { id: p.id }, data: { costItems: sheet.map(([name, kind, costCents]) => ({ name, kind, costCents })) } });
  }
  await prisma.option.updateMany({ where: { tenantId, name: { in: ['Catupiry', 'Cheddar'] }, costCents: 0 }, data: { costCents: 300 } });
  await prisma.option.updateMany({ where: { tenantId, name: 'Bacon', costCents: 0 }, data: { costCents: 200 } });
}

/** Demo dos canais: código PDV nos produtos, preço maior no iFood e comissões típicas dos apps. */
async function seedDemoChannels(tenantId: string) {
  const codes: Record<string, string> = {
    Calabresa: 'PZ-CAL',
    Margherita: 'PZ-MAR',
    'Frango com Catupiry': 'PZ-FRC',
    'Refrigerante 2L': 'BB-REF2',
    'Suco natural 500ml': 'BB-SUC5',
  };
  const products = await prisma.product.findMany({ where: { tenantId, pdvCode: null } });
  for (const p of products) {
    const code = codes[p.name];
    if (!code) continue;
    // No iFood o preço costuma ser uns 15% maior para cobrir a comissão.
    const ifood = Math.ceil((p.priceCents * 1.15) / 100) * 100 - 10;
    await prisma.product.update({ where: { id: p.id }, data: { pdvCode: code, channelPrices: { IFOOD: ifood } } });
  }
  const channels = [
    { channel: 'IFOOD' as const, commissionBps: 1200, paymentFeeBps: 320, payoutDays: 30 },
    { channel: 'FOOD99' as const, commissionBps: 1000, paymentFeeBps: 300, payoutDays: 14 },
    { channel: 'KEETA' as const, commissionBps: 900, paymentFeeBps: 300, payoutDays: 7 },
  ];
  for (const c of channels) {
    await prisma.channelSetting.upsert({ where: { tenantId_channel: { tenantId, channel: c.channel } }, create: { tenantId, active: true, ...c }, update: {} });
  }
}

/** Demo da equipe: CLT com folga fixa, estágio e diarista de fim de semana. */
async function seedDemoPeople(tenantId: string) {
  if ((await prisma.employee.count({ where: { tenantId } })) > 0) return;
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const people = [
    { name: 'Carla Souza', role: 'Pizzaiola', type: 'CLT' as const, salaryCents: 320_000, transportCents: 26_400, mealCents: 30_000, weeklyDayOff: 1, admissionDate: d('2024-03-01') },
    { name: 'Diego Lima', role: 'Atendente', type: 'CLT' as const, salaryCents: 180_000, transportCents: 26_400, weeklyDayOff: 2, admissionDate: d('2025-06-10') },
    { name: 'Júlia Alves', role: 'Auxiliar de cozinha', type: 'ESTAGIO' as const, salaryCents: 110_000, weeklyDayOff: 3, admissionDate: d('2026-02-01') },
    { name: 'Rafael Dias', role: 'Garçom (fim de semana)', type: 'DIARISTA' as const, dailyRateCents: 13_000, admissionDate: d('2025-01-01') },
  ];
  for (const p of people) await prisma.employee.create({ data: { tenantId, ...p } });
}
