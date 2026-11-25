/**
 * Pizzaria simulada para testar o sistema inteiro: 30 dias de operação até hoje.
 *
 * - Faturamento de ~R$ 80 mil no período, pela loja própria, iFood, 99Food e Keeta
 * - 10 funcionários (garçom, cozinha, caixa, supervisor), 2 de férias agora e 2 com férias vencendo no mês que vem
 * - 5 motoboys com lotes de entrega, entregas confirmadas, ocorrências, avaliações e gorjetas
 * - Aluguel R$ 3.000, energia R$ 1.500, água R$ 600, internet R$ 200, contador, gás, compras de insumos e anúncios
 * - Folha do mês passado fechada e paga; repasses da 99Food e da Keeta registrados
 * - Hoje: pedidos novos, em preparo, prontos para sair e na rua com o motoboy
 *
 * Os lançamentos do financeiro saem dos mesmos eventos que o sistema usa de verdade (domain_events),
 * processados pela Gestão: o que aparece nas telas é o caminho real, só que com datas passadas.
 */
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, type PaymentMethod, type SalesChannel } from '@prisma/client';
import { unitCost, type CostItem } from '@delivery360/shared';

export const SIM_SLUG = 'pizzaria-simulada';
export const SIM_EMAIL = 'dono@pizzaria-simulada.local';

type Db = PrismaClient;
type Rng = () => number;

/** Gerador pseudoaleatório com semente: a mesma simulação sai igual em qualquer máquina. */
function rng(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Rng, list: readonly T[]) => list[Math.floor(r() * list.length)];
const weighted = <T>(r: Rng, list: readonly (readonly [T, number])[]) => {
  const total = list.reduce((t, [, w]) => t + w, 0);
  let x = r() * total;
  for (const [v, w] of list) {
    x -= w;
    if (x <= 0) return v;
  }
  return list[list.length - 1][0];
};
const token = (n = 12) => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
};

/** Datas no horário de Brasília (sem horário de verão). */
const spToday = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00-03:00`) + minutes * 60_000);
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const dbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

// ---------- Cardápio ----------

type Sheet = [string, 'INGREDIENT' | 'PACKAGING' | 'OTHER', number][];
const MASSA: Sheet = [
  ['Massa (farinha, fermento, azeite)', 'INGREDIENT', 380],
  ['Molho de tomate', 'INGREDIENT', 180],
];
const CAIXA: Sheet = [['Caixa de pizza', 'PACKAGING', 280]];
const PIZZAS: { name: string; desc: string; price: number; pdv: string; sheet: Sheet }[] = [
  { name: 'Mussarela', desc: 'Molho, mussarela e orégano', price: 5490, pdv: 'PZ-MUS', sheet: [...MASSA, ['Mussarela (400 g)', 'INGREDIENT', 1050], ...CAIXA] },
  { name: 'Calabresa', desc: 'Calabresa fatiada, cebola e azeitona', price: 5690, pdv: 'PZ-CAL', sheet: [...MASSA, ['Mussarela (250 g)', 'INGREDIENT', 660], ['Calabresa', 'INGREDIENT', 620], ['Cebola e azeitona', 'INGREDIENT', 120], ...CAIXA] },
  { name: 'Margherita', desc: 'Mussarela, tomate e manjericão', price: 5890, pdv: 'PZ-MAR', sheet: [...MASSA, ['Mussarela (350 g)', 'INGREDIENT', 920], ['Tomate e manjericão', 'INGREDIENT', 260], ...CAIXA] },
  { name: 'Portuguesa', desc: 'Presunto, ovo, cebola, ervilha e azeitona', price: 6290, pdv: 'PZ-POR', sheet: [...MASSA, ['Mussarela (300 g)', 'INGREDIENT', 790], ['Presunto', 'INGREDIENT', 480], ['Ovo, cebola, ervilha', 'INGREDIENT', 260], ...CAIXA] },
  { name: 'Frango com Catupiry', desc: 'Frango desfiado e catupiry original', price: 6490, pdv: 'PZ-FRC', sheet: [...MASSA, ['Mussarela (200 g)', 'INGREDIENT', 530], ['Frango desfiado', 'INGREDIENT', 650], ['Catupiry', 'INGREDIENT', 720], ...CAIXA] },
  { name: 'Quatro Queijos', desc: 'Mussarela, provolone, parmesão e gorgonzola', price: 6890, pdv: 'PZ-4QJ', sheet: [...MASSA, ['Mussarela (250 g)', 'INGREDIENT', 660], ['Provolone, parmesão, gorgonzola', 'INGREDIENT', 1380], ...CAIXA] },
  { name: 'Pepperoni', desc: 'Pepperoni fatiado e mussarela', price: 6990, pdv: 'PZ-PEP', sheet: [...MASSA, ['Mussarela (300 g)', 'INGREDIENT', 790], ['Pepperoni', 'INGREDIENT', 1150], ...CAIXA] },
  { name: 'Camarão', desc: 'Camarão ao alho, catupiry e cebolinha', price: 8490, pdv: 'PZ-CAM', sheet: [...MASSA, ['Mussarela (200 g)', 'INGREDIENT', 530], ['Camarão', 'INGREDIENT', 2100], ['Catupiry', 'INGREDIENT', 480], ...CAIXA] },
];
const DOCES: typeof PIZZAS = [
  { name: 'Chocolate com Morango', desc: 'Chocolate ao leite e morangos', price: 5990, pdv: 'PZ-CHM', sheet: [...MASSA.slice(0, 1), ['Chocolate', 'INGREDIENT', 950], ['Morango', 'INGREDIENT', 620], ...CAIXA] },
  { name: 'Romeu e Julieta', desc: 'Goiabada e mussarela', price: 5490, pdv: 'PZ-ROM', sheet: [...MASSA.slice(0, 1), ['Goiabada', 'INGREDIENT', 380], ['Mussarela (250 g)', 'INGREDIENT', 660], ...CAIXA] },
];
const BEBIDAS: typeof PIZZAS = [
  { name: 'Refrigerante 2L', desc: 'Coca-Cola, Guaraná ou Fanta', price: 1490, pdv: 'BB-REF2', sheet: [['Refrigerante 2L', 'INGREDIENT', 790]] },
  { name: 'Refrigerante lata', desc: '350 ml', price: 690, pdv: 'BB-LATA', sheet: [['Lata 350 ml', 'INGREDIENT', 320]] },
  { name: 'Suco natural 500ml', desc: 'Laranja, limão ou maracujá', price: 1090, pdv: 'BB-SUC5', sheet: [['Frutas', 'INGREDIENT', 280], ['Copo e tampa', 'PACKAGING', 60]] },
  { name: 'Cerveja long neck', desc: '355 ml', price: 1190, pdv: 'BB-CERV', sheet: [['Long neck', 'INGREDIENT', 520]] },
];
const SOBREMESAS: typeof PIZZAS = [
  { name: 'Petit gâteau', desc: 'Com sorvete de creme', price: 2290, pdv: 'SB-PETIT', sheet: [['Petit gâteau congelado', 'INGREDIENT', 650], ['Sorvete', 'INGREDIENT', 280], ['Embalagem', 'PACKAGING', 90]] },
  { name: 'Brownie', desc: 'Brownie de chocolate', price: 1490, pdv: 'SB-BROW', sheet: [['Brownie', 'INGREDIENT', 380], ['Embalagem', 'PACKAGING', 50]] },
];

const FIRST = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Pedro', 'Rafaela', 'Rodrigo', 'Sabrina', 'Thiago', 'Vanessa', 'Vinícius', 'Larissa', 'Gustavo', 'Patrícia', 'Leonardo', 'Juliana', 'Marcelo', 'Beatriz', 'André', 'Fernanda', 'Ricardo', 'Letícia', 'Paulo', 'Aline', 'Fábio'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Ferreira', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Barbosa', 'Araújo'];
const STREETS = ['Rua das Palmeiras', 'Rua Sete de Setembro', 'Av. Brasil', 'Rua Tiradentes', 'Rua São José', 'Rua das Acácias', 'Av. Paulista', 'Rua Rio Branco', 'Rua Bela Vista', 'Rua Santos Dumont', 'Rua XV de Novembro', 'Rua Dom Pedro II'];
const COMMENTS = ['Pizza chegou quentinha, muito boa!', 'Entrega rápida, motoboy educado.', 'Melhor calabresa da região.', 'Massa fininha e crocante, adorei.', 'Demorou um pouco mas valeu a pena.', 'Borda de catupiry perfeita!', 'Sempre peço, nunca decepciona.'];

/** Cria a pizzaria simulada (uma vez). Devolve false se já existia. */
export async function simulatePizzaria(
  prisma: Db,
  services: {
    processPending: (tenantId: string) => Promise<number>;
    upsert: (tenantId: string, key: string, e: Record<string, unknown>) => Promise<void>;
    registerPayout: (tenantId: string, userId: string, channel: 'FOOD99' | 'KEETA', until: string, paidAt: string) => Promise<unknown>;
    payroll: (tenantId: string, month: string) => Promise<{ items: { id: string; employeeId: string }[] }>;
    updatePayrollItem: (tenantId: string, userId: string, id: string, dto: Record<string, number>) => Promise<unknown>;
    closePayroll: (tenantId: string, userId: string, month: string) => Promise<unknown>;
  },
  opts: { password: string; now?: Date; revenueTargetCents?: number; log?: (m: string) => void } = { password: 'simulacao123' },
): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  if (await prisma.store.findUnique({ where: { slug: SIM_SLUG } })) return false;
  const now = opts.now ?? new Date();
  const today = spToday(now);
  const nowMin = Math.floor((now.getTime() - Date.parse(`${today}T00:00:00-03:00`)) / 60_000);
  const target = opts.revenueTargetCents ?? 8_000_000;
  const r = rng(20261125);

  // ---------- Restaurante, dono, loja ----------
  const plan = await prisma.plan.findUniqueOrThrow({ where: { name: 'Gestão 360' }, include: { modules: true } });
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Pizzaria Simulada',
      planId: plan.id,
      modules: { create: plan.modules.map((m) => ({ moduleCode: m.moduleCode, active: true, startsAt: at(addDays(today, -60), 0) })) },
    },
  });
  const tenantId = tenant.id;
  const owner = await prisma.user.upsert({
    where: { email: SIM_EMAIL },
    update: {},
    create: { name: 'Dono da Pizzaria Simulada', email: SIM_EMAIL, passwordHash: await bcrypt.hash(opts.password, 10) },
  });
  await prisma.membership.create({ data: { userId: owner.id, tenantId, role: 'OWNER' } });
  await prisma.store.create({
    data: {
      tenantId,
      slug: SIM_SLUG,
      displayName: 'Pizzaria Simulada',
      description: 'Simulação de 30 dias de operação para testar o sistema',
      city: 'São Paulo',
      whatsapp: '11999990000',
      isOpen: true,
      minOrderCents: 3000,
      estimatedMinutes: 45,
    },
  });
  const zones = await Promise.all(
    [
      ['Centro', 600],
      ['Vila Mariana', 800],
      ['Jardim Paulista', 900],
      ['Moema', 1000],
    ].map(([name, feeCents]) => prisma.deliveryZone.create({ data: { tenantId, name: name as string, feeCents: feeCents as number } })),
  );

  await prisma.financeSettings.create({
    data: { tenantId, salesTaxBps: 600, pixFeeBps: 99, creditFeeBps: 350, cardOnDeliveryFeeBps: 250, targetMarginBps: 2000, taxDueDay: 20, fgtsBps: 800, employerInssBps: 0, payDay: 5 },
  });
  await prisma.channelSetting.createMany({
    data: [
      { tenantId, channel: 'IFOOD', active: true, commissionBps: 1200, paymentFeeBps: 320, payoutDays: 30, merchantId: 'sim-ifood-001' },
      { tenantId, channel: 'FOOD99', active: true, commissionBps: 1000, paymentFeeBps: 300, payoutDays: 14, merchantId: 'sim-99-001' },
      { tenantId, channel: 'KEETA', active: true, commissionBps: 900, paymentFeeBps: 300, payoutDays: 7, merchantId: 'sim-keeta-001' },
    ],
  });

  // ---------- Cardápio com ficha técnica e código PDV ----------
  type Prod = { id: string; name: string; price: number; ifood: number; cost: number; kind: 'pizza' | 'doce' | 'bebida' | 'sobremesa' };
  const products: Prod[] = [];
  const borders: { id: string; name: string; price: number; cost: number }[] = [];
  const sections: [string, typeof PIZZAS, Prod['kind']][] = [
    ['Pizzas salgadas (grande, 8 fatias)', PIZZAS, 'pizza'],
    ['Pizzas doces', DOCES, 'doce'],
    ['Bebidas', BEBIDAS, 'bebida'],
    ['Sobremesas', SOBREMESAS, 'sobremesa'],
  ];
  for (const [pos, [catName, list, kind]] of sections.entries()) {
    const cat = await prisma.menuCategory.create({ data: { tenantId, name: catName, position: pos } });
    for (const [i, p] of list.entries()) {
      const costItems = p.sheet.map(([name, k, costCents]) => ({ name, kind: k, costCents }));
      // Nos apps o preço é ~15% maior para cobrir a comissão.
      const ifood = Math.ceil((p.price * 1.15) / 100) * 100 - 10;
      const product = await prisma.product.create({
        data: { tenantId, categoryId: cat.id, name: p.name, description: p.desc, priceCents: p.price, position: i, pdvCode: p.pdv, channelPrices: { IFOOD: ifood }, costItems },
      });
      products.push({ id: product.id, name: p.name, price: p.price, ifood, cost: unitCost(costItems as CostItem[]), kind });
      if (kind === 'pizza' || kind === 'doce') {
        const group = await prisma.optionGroup.create({
          data: {
            tenantId,
            productId: product.id,
            name: 'Borda',
            minSelect: 1,
            maxSelect: 1,
            options: {
              create: [
                { tenantId, name: 'Tradicional', priceCents: 0, costCents: 0, position: 0, pdvCode: 'BD-TRAD' },
                { tenantId, name: 'Catupiry', priceCents: 1000, costCents: 350, position: 1, pdvCode: 'BD-CATU' },
                { tenantId, name: 'Cheddar', priceCents: 1000, costCents: 320, position: 2, pdvCode: 'BD-CHED' },
                { tenantId, name: 'Chocolate', priceCents: 1200, costCents: 380, position: 3, pdvCode: 'BD-CHOC' },
              ],
            },
          },
          include: { options: true },
        });
        if (borders.length === 0) borders.push(...group.options.map((o) => ({ id: o.id, name: o.name, price: o.priceCents, cost: o.costCents })));
        else {
          // Mesmos nomes em todos os produtos; guarda o id do produto certo na hora do pedido.
        }
      }
    }
  }
  const optionsByProduct = new Map<string, { id: string; name: string; priceCents: number; costCents: number }[]>();
  for (const g of await prisma.optionGroup.findMany({ where: { tenantId }, include: { options: true } })) optionsByProduct.set(g.productId, g.options);
  log(`cardápio: ${products.length} produtos`);

  // ---------- Equipe ----------
  const yearsAgo = (y: number, monthDay: string) => `${Number(today.slice(0, 4)) - y}-${monthDay}`;
  // Aniversário de admissão no mês que vem: férias vencendo.
  const nextMonthDay = (d: number) => addDays(`${addDays(today, 32).slice(0, 7)}-01`, d - 1).slice(5);
  const team = [
    { name: 'Roberta Mendes', role: 'Supervisora', type: 'CLT', salaryCents: 380_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 1, admissionDate: yearsAgo(4, '02-03') },
    { name: 'Antônio Ferraz', role: 'Pizzaiolo', type: 'CLT', salaryCents: 320_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 2, admissionDate: yearsAgo(3, nextMonthDay(8)) },
    { name: 'Wesley Prado', role: 'Pizzaiolo auxiliar', type: 'CLT', salaryCents: 230_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 3, admissionDate: yearsAgo(2, '05-20') },
    { name: 'Cláudia Reis', role: 'Cozinheira', type: 'CLT', salaryCents: 240_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 1, admissionDate: yearsAgo(2, '08-11') },
    { name: 'Matheus Cunha', role: 'Auxiliar de cozinha', type: 'CLT', salaryCents: 180_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 2, admissionDate: yearsAgo(1, nextMonthDay(18)) },
    { name: 'Priscila Torres', role: 'Caixa', type: 'CLT', salaryCents: 190_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 2, admissionDate: yearsAgo(3, '04-02') },
    { name: 'Danilo Moura', role: 'Caixa', type: 'CLT', salaryCents: 190_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 3, admissionDate: yearsAgo(1, '03-15') },
    { name: 'Tatiane Lopes', role: 'Garçonete', type: 'CLT', salaryCents: 175_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 1, admissionDate: yearsAgo(2, '01-09') },
    { name: 'Caio Brandão', role: 'Garçom', type: 'CLT', salaryCents: 175_000, transportCents: 26_400, mealCents: 45_000, weeklyDayOff: 2, admissionDate: yearsAgo(1, '06-27') },
    { name: 'Renan Siqueira', role: 'Garçom (fim de semana)', type: 'DIARISTA', dailyRateCents: 13_000, admissionDate: yearsAgo(1, '09-01') },
  ] as const;
  const employees: { id: string; name: string }[] = [];
  for (const e of team) {
    employees.push(await prisma.employee.create({ data: { tenantId, ...e, admissionDate: dbDate(e.admissionDate) } }));
  }
  const byName = (n: string) => employees.find((e) => e.name === n)!;
  // Duas pessoas de férias agora (30 dias).
  for (const [name, start] of [
    ['Cláudia Reis', addDays(today, -9)],
    ['Tatiane Lopes', addDays(today, -4)],
  ] as const) {
    await prisma.absence.create({ data: { tenantId, employeeId: byName(name).id, kind: 'FERIAS', startDate: dbDate(start), endDate: dbDate(addDays(start, 29)) } });
  }
  // Algumas faltas e atestados no período.
  const extraAbsences: [string, 'FALTA' | 'ATESTADO' | 'FOLGA', number, number][] = [
    ['Matheus Cunha', 'FALTA', -17, -17],
    ['Caio Brandão', 'ATESTADO', -12, -11],
    ['Danilo Moura', 'FOLGA', -6, -6],
    ['Wesley Prado', 'FALTA', -3, -3],
  ];
  for (const [name, kind, a, b] of extraAbsences) {
    await prisma.absence.create({ data: { tenantId, employeeId: byName(name).id, kind, startDate: dbDate(addDays(today, a)), endDate: dbDate(addDays(today, b)) } });
  }

  // ---------- Motoboys ----------
  const couriers = [];
  for (const [name, plate] of [
    ['João Batista', 'FKR-2A31'],
    ['Marcos Vieira', 'GHT-7B92'],
    ['Leandro Alves', 'EJP-4C18'],
    ['Diego Ramos', 'BRZ-9D07'],
    ['Fábio Nunes', 'QWE-1E55'],
  ] as const) {
    couriers.push(
      await prisma.courier.create({
        data: { tenantId, name, plate, phone: `1197${Math.floor(1_000_000 + r() * 8_999_999)}`, feeCents: 700, accessToken: token(24) },
      }),
    );
  }
  log('equipe e motoboys criados');

  // ---------- Clientes ----------
  const customers = Array.from({ length: 380 }, () => ({
    name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
    phone: `119${String(Math.floor(r() * 1e8)).padStart(8, '0')}`,
    street: pick(r, STREETS),
    number: String(10 + Math.floor(r() * 1900)),
    zone: weighted(r, [
      [zones[0], 4],
      [zones[1], 3],
      [zones[2], 2],
      [zones[3], 1],
    ] as const),
  }));
  const customerIds = new Map<string, string>();
  const customerId = async (name: string, phone: string) => {
    const known = customerIds.get(phone);
    if (known) return known;
    const c = await prisma.customer.upsert({ where: { tenantId_phone: { tenantId, phone } }, update: {}, create: { tenantId, name, phone } });
    customerIds.set(phone, c.id);
    return c.id;
  };

  // ---------- Pedidos ----------
  let number = 0;
  let batchNumber = 0;
  let revenue = 0;
  const events: { type: string; payload: Record<string, unknown>; createdAt: Date }[] = [];
  const tipsToPayOut: string[] = [];

  const dayWeight = (day: string) => [1.35, 0.6, 0.75, 0.85, 1.0, 1.35, 1.45][new Date(`${day}T12:00:00Z`).getUTCDay()];
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const minute = () => (r() < 0.3 ? 11 * 60 + 15 + Math.floor(r() * 180) : 18 * 60 + Math.floor(r() * 300));

  type Draft = {
    day: string;
    created: Date;
    channel: SalesChannel;
    type: 'DELIVERY' | 'PICKUP';
    method: PaymentMethod;
    customer: (typeof customers)[number];
    items: { productId: string; name: string; unitPriceCents: number; unitCostCents: number; quantity: number; options: { optionId: string; groupName: string; name: string; priceCents: number }[] }[];
    deliveryFee: number;
    subtotal: number;
    total: number;
  };

  const draft = (day: string, created: Date): Draft => {
    const channel = weighted<SalesChannel>(r, [
      ['LOJA', 40],
      ['IFOOD', 40],
      ['FOOD99', 12],
      ['KEETA', 8],
    ]);
    const type = r() < 0.86 ? 'DELIVERY' : 'PICKUP';
    const method: PaymentMethod =
      channel === 'LOJA'
        ? weighted<PaymentMethod>(r, [
            ['PIX', 50],
            ['CARD_ON_DELIVERY', 36],
            ['CASH_ON_DELIVERY', 14],
          ])
        : r() < 0.9
          ? 'APP_ONLINE'
          : pick(r, ['CARD_ON_DELIVERY', 'CASH_ON_DELIVERY'] as const);
    const customer = pick(r, customers);
    const priceOf = (p: Prod) => (channel === 'IFOOD' ? p.ifood : p.price);
    const items: Draft['items'] = [];
    const nPizzas = weighted(r, [
      [1, 68],
      [2, 27],
      [3, 5],
    ] as const);
    for (let i = 0; i < nPizzas; i++) {
      const p = r() < 0.9 ? pick(r, products.filter((x) => x.kind === 'pizza')) : pick(r, products.filter((x) => x.kind === 'doce'));
      const opts = optionsByProduct.get(p.id)!;
      const border = r() < 0.3 ? pick(r, opts.filter((o) => o.priceCents > 0)) : opts.find((o) => o.priceCents === 0)!;
      items.push({
        productId: p.id,
        name: p.name,
        unitPriceCents: priceOf(p) + border.priceCents,
        unitCostCents: p.cost + border.costCents,
        quantity: 1,
        options: [{ optionId: border.id, groupName: 'Borda', name: border.name, priceCents: border.priceCents }],
      });
    }
    if (r() < 0.6) {
      const p = r() < 0.6 ? products.find((x) => x.name === 'Refrigerante 2L')! : pick(r, products.filter((x) => x.kind === 'bebida'));
      items.push({ productId: p.id, name: p.name, unitPriceCents: priceOf(p), unitCostCents: p.cost, quantity: p.name === 'Refrigerante lata' ? 2 : 1, options: [] });
    }
    if (r() < 0.12) {
      const p = pick(r, products.filter((x) => x.kind === 'sobremesa'));
      items.push({ productId: p.id, name: p.name, unitPriceCents: priceOf(p), unitCostCents: p.cost, quantity: 1, options: [] });
    }
    const subtotal = items.reduce((t, i) => t + i.unitPriceCents * i.quantity, 0);
    const deliveryFee = type === 'DELIVERY' ? customer.zone.feeCents : 0;
    return { day, created, channel, type, method, customer, items, deliveryFee, subtotal, total: subtotal + deliveryFee };
  };

  type Final =
    | { status: 'COMPLETED'; courier?: (typeof couriers)[number]; batchId?: string; batchNum?: number; fail?: boolean; rating?: boolean; tip?: boolean }
    | { status: 'CANCELLED' }
    | { status: 'PAID' | 'IN_PREPARATION' | 'READY' }
    | { status: 'OUT_FOR_DELIVERY'; courier: (typeof couriers)[number]; batchId: string };

  const save = async (d: Draft, f: Final) => {
    number++;
    const id = crypto.randomUUID();
    const isApp = d.channel !== 'LOJA';
    const ext = isApp ? `#${1000 + Math.floor(r() * 9000)}` : null;
    const phone = isApp ? `${d.channel.toLowerCase()}-${token(8)}` : d.customer.phone;
    const cid = await customerId(d.customer.name, phone);
    const t0 = d.created;
    const done = plusMin(t0, d.type === 'DELIVERY' ? 48 + Math.floor(r() * 25) : 30 + Math.floor(r() * 10));
    const flow: [string, Date][] = [['PAID', t0]];
    const reach = (s: string) => ['PAID', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED'].indexOf(s);
    const target = f.status === 'CANCELLED' ? 'PAID' : f.status;
    if (reach(target) >= 1) flow.push(['IN_PREPARATION', plusMin(t0, 4)]);
    if (reach(target) >= 2) flow.push(['READY', plusMin(t0, 26)]);
    if (reach(target) >= 3 && d.type === 'DELIVERY') flow.push(['OUT_FOR_DELIVERY', plusMin(t0, 31)]);
    if (target === 'COMPLETED') flow.push(['COMPLETED', done]);
    if (f.status === 'CANCELLED') flow.push(['CANCELLED', plusMin(t0, 9)]);
    const online = d.method === 'PIX' || d.method === 'APP_ONLINE';
    const rated = f.status === 'COMPLETED' && f.rating;
    await prisma.order.create({
      data: {
        id,
        tenantId,
        number,
        trackingCode: token(),
        customerId: cid,
        type: d.type,
        status: f.status,
        channel: d.channel,
        externalId: isApp ? `sim-${token(10)}` : null,
        externalCode: ext,
        deliveryCode: isApp ? String(1000 + Math.floor(r() * 9000)) : null,
        customerName: d.customer.name,
        customerPhone: isApp ? '08007051150' : d.customer.phone,
        addressStreet: d.type === 'DELIVERY' ? d.customer.street : null,
        addressNumber: d.type === 'DELIVERY' ? d.customer.number : null,
        deliveryZoneId: d.type === 'DELIVERY' && !isApp ? d.customer.zone.id : null,
        deliveryZoneName: d.type === 'DELIVERY' ? d.customer.zone.name : null,
        subtotalCents: d.subtotal,
        deliveryFeeCents: d.deliveryFee,
        totalCents: d.total,
        paymentMethod: d.method,
        changeForCents: d.method === 'CASH_ON_DELIVERY' ? Math.ceil(d.total / 5000) * 5000 : null,
        printedAt: f.status === 'PAID' ? null : plusMin(t0, 1),
        batchId: 'batchId' in f && f.batchId ? f.batchId : null,
        deliveredAt: f.status === 'COMPLETED' ? done : null,
        ratingStore: rated ? weighted(r, [[5, 70], [4, 22], [3, 6], [2, 2]] as const) : null,
        ratingDelivery: rated && d.type === 'DELIVERY' ? weighted(r, [[5, 75], [4, 20], [3, 5]] as const) : null,
        ratingComment: rated && r() < 0.4 ? pick(r, COMMENTS) : null,
        ratedAt: rated ? plusMin(done, 40) : null,
        createdAt: t0,
        updatedAt: flow[flow.length - 1][1],
        items: { create: d.items.map((i) => ({ ...i, totalCents: i.unitPriceCents * i.quantity, options: { create: i.options } })) },
        statusHistory: { create: flow.map(([status, createdAt]) => ({ status: status as never, createdAt, note: status === 'CANCELLED' ? 'Cliente desistiu' : null })) },
        payments: {
          create: {
            tenantId,
            provider: d.method === 'PIX' ? 'fake' : d.method === 'APP_ONLINE' ? d.channel.toLowerCase() : 'offline',
            method: d.method,
            status: online ? 'PAID' : f.status === 'COMPLETED' ? 'PAID' : 'PENDING',
            amountCents: d.total,
            paidAt: online ? t0 : f.status === 'COMPLETED' ? done : null,
            createdAt: t0,
          },
        },
      },
    });
    events.push({ type: 'pedido.recebido', payload: { orderId: id, totalCents: d.total, paymentMethod: d.method }, createdAt: plusMin(t0, 0) });
    if (f.status === 'CANCELLED') {
      events.push({ type: 'pedido.cancelado', payload: { orderId: id, from: 'PAID', to: 'CANCELLED', totalCents: d.total }, createdAt: plusMin(t0, 9) });
      return;
    }
    if (f.status === 'COMPLETED') {
      events.push({ type: 'pedido.status', payload: { orderId: id, from: d.type === 'DELIVERY' ? 'OUT_FOR_DELIVERY' : 'READY', to: 'COMPLETED', totalCents: d.total }, createdAt: done });
      revenue += d.total;
      if (d.type === 'DELIVERY' && f.courier) {
        const c = f.courier;
        if (f.fail) {
          await prisma.deliveryAttempt.create({
            data: { tenantId, orderId: id, courierId: c.id, batchId: f.batchId, batchNumber: f.batchNum, outcome: 'FAILED', failReason: 'CUSTOMER_ABSENT', note: 'Ninguém atendeu, voltei e saí de novo', courierName: c.name, courierPlate: c.plate, createdAt: plusMin(t0, 42) },
          });
        }
        await prisma.deliveryAttempt.create({
          data: {
            tenantId,
            orderId: id,
            courierId: c.id,
            batchId: f.batchId,
            batchNumber: f.batchNum,
            outcome: 'DELIVERED',
            receiverName: d.customer.name.split(' ')[0],
            code: d.channel === 'LOJA' ? d.customer.phone.slice(-4) : null,
            courierName: c.name,
            courierPlate: c.plate,
            createdAt: done,
          },
        });
        events.push({ type: 'entrega.concluida', payload: { orderId: id, courierId: c.id, batchId: f.batchId, courierFeeCents: c.feeCents }, createdAt: done });
        if (f.tip) {
          const amountCents = pick(r, [300, 500, 500, 1000]);
          const tip = await prisma.tip.create({
            data: { tenantId, orderId: id, courierId: c.id, amountCents, provider: 'fake', externalId: `sim-tip-${token(10)}`, status: 'PAID', paidAt: plusMin(done, 30), createdAt: plusMin(done, 25) },
          });
          events.push({ type: 'gorjeta.recebida', payload: { tipId: tip.id, orderId: id, courierId: c.id, amountCents }, createdAt: plusMin(done, 30) });
          if (d.day < addDays(today, -2)) tipsToPayOut.push(tip.id);
        }
      }
    } else {
      revenue += d.total;
    }
  };

  // Dias passados (até 2 horas atrás): pedidos finalizados, entregues em lotes pelos motoboys.
  const totalWeight = days.reduce((t, d) => t + dayWeight(d), 0);
  const plan30: { day: string; created: Date }[] = [];
  // Estimativa de pedidos para chegar no faturamento (ticket médio ~R$ 80).
  const estimate = Math.round(target / 8_000);
  for (const day of days) {
    const n = Math.round((estimate * dayWeight(day)) / totalWeight);
    for (let i = 0; i < n; i++) {
      const m = minute();
      if (day === today && m > nowMin - 120) continue;
      plan30.push({ day, created: at(day, m) });
    }
  }
  plan30.sort((a, b) => a.created.getTime() - b.created.getTime());
  const drafts = plan30.map((p) => draft(p.day, p.created));
  // Ajusta para chegar perto da meta: corta ou acrescenta pedidos nos dias anteriores.
  let sum = drafts.reduce((t, d) => t + d.total, 0);
  while (sum > target * 1.01 && drafts.length) {
    const i = Math.floor(r() * drafts.length);
    sum -= drafts[i].total;
    drafts.splice(i, 1);
  }
  while (sum < target * 0.99) {
    const day = days[Math.floor(r() * 29)];
    const d = draft(day, at(day, minute()));
    drafts.push(d);
    sum += d.total;
  }
  drafts.sort((a, b) => a.created.getTime() - b.created.getTime());

  // Lotes: pedidos de entrega que saem perto um do outro vão com o mesmo motoboy (até 3).
  let open: { id: string; num: number; courier: (typeof couriers)[number]; size: number; at: number } | null = null;
  let courierTurn = 0;
  for (const d of drafts) {
    if (r() < 0.015) {
      await save(d, { status: 'CANCELLED' });
      continue;
    }
    if (d.type === 'PICKUP') {
      await save(d, { status: 'COMPLETED', rating: d.channel === 'LOJA' && r() < 0.3 });
      continue;
    }
    const out = plusMin(d.created, 31).getTime();
    if (!open || open.size >= 3 || out - open.at > 12 * 60_000) {
      if (open) await prisma.deliveryBatch.update({ where: { id: open.id }, data: { finishedAt: new Date(open.at + 50 * 60_000) } });
      batchNumber++;
      const courier = couriers[courierTurn++ % couriers.length];
      const b = await prisma.deliveryBatch.create({ data: { tenantId, number: batchNumber, courierId: courier.id, status: 'DONE', createdBy: owner.id, createdAt: new Date(out) } });
      open = { id: b.id, num: batchNumber, courier, size: 0, at: out };
    }
    open.size++;
    await save(d, {
      status: 'COMPLETED',
      courier: open.courier,
      batchId: open.id,
      batchNum: open.num,
      fail: r() < 0.006,
      rating: d.channel === 'LOJA' && r() < 0.3,
      tip: d.channel === 'LOJA' && r() < 0.06,
    });
  }
  if (open) await prisma.deliveryBatch.update({ where: { id: open.id }, data: { finishedAt: new Date(open.at + 50 * 60_000) } });
  log(`${drafts.length} pedidos nos últimos 30 dias`);

  // Operação de agora: novos, em preparo, prontos para sair e na rua.
  const live = (minsAgo: number) => {
    const t = new Date(now.getTime() - minsAgo * 60_000);
    return draft(today, t);
  };
  const force = (d: Draft, channel: SalesChannel, type: 'DELIVERY' | 'PICKUP' = 'DELIVERY') => {
    d.channel = channel;
    d.type = type;
    if (type === 'PICKUP') {
      d.deliveryFee = 0;
      d.total = d.subtotal;
    }
    if (channel !== 'LOJA' && d.method === 'PIX') d.method = 'APP_ONLINE';
    if (channel === 'LOJA' && d.method === 'APP_ONLINE') d.method = 'PIX';
    return d;
  };
  await save(force(live(3), 'IFOOD'), { status: 'PAID' });
  await save(force(live(6), 'LOJA'), { status: 'PAID' });
  await save(force(live(9), 'KEETA'), { status: 'PAID' });
  await save(force(live(16), 'LOJA'), { status: 'IN_PREPARATION' });
  await save(force(live(21), 'IFOOD'), { status: 'IN_PREPARATION' });
  await save(force(live(33), 'FOOD99'), { status: 'READY' });
  await save(force(live(36), 'LOJA'), { status: 'READY' });
  await save(force(live(30), 'LOJA', 'PICKUP'), { status: 'READY' });
  const street: [number, number][] = [
    [-23.5874, -46.6347],
    [-23.5989, -46.6672],
  ];
  for (const [k, ids] of [
    [0, [44, 47]],
    [1, [52]],
  ] as const) {
    batchNumber++;
    const courier = couriers[k];
    const b = await prisma.deliveryBatch.create({ data: { tenantId, number: batchNumber, courierId: courier.id, status: 'OUT', createdBy: owner.id, createdAt: new Date(now.getTime() - 12 * 60_000) } });
    for (const mins of ids) await save(force(live(mins), k === 0 ? 'LOJA' : 'IFOOD'), { status: 'OUT_FOR_DELIVERY', courier, batchId: b.id });
    await prisma.courier.update({
      where: { id: courier.id },
      data: { lastLat: street[k][0], lastLng: street[k][1], lastAccuracy: 12, lastLocationAt: new Date(now.getTime() - 20_000) },
    });
  }
  log('operação de hoje montada');

  // ---------- Financeiro a partir dos eventos ----------
  await prisma.domainEvent.createMany({
    data: events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((e) => ({ tenantId, type: e.type, payload: e.payload as Prisma.InputJsonValue, createdAt: e.createdAt })),
  });
  if (tipsToPayOut.length) {
    const paidOut = new Date(now.getTime() - 24 * 3_600_000);
    await prisma.tip.updateMany({ where: { id: { in: tipsToPayOut } }, data: { paidOutAt: paidOut, paidOutBy: owner.id } });
    await prisma.domainEvent.create({ data: { tenantId, type: 'gorjeta.repassada', payload: { tipIds: tipsToPayOut }, createdAt: paidOut } });
  }
  const processed = await services.processPending(tenantId);
  log(`${processed} eventos viraram lançamentos`);

  // Despesas fixas e variáveis do mês passado (pagas) e deste mês.
  const thisMonth = today.slice(0, 7);
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
  const fixed: [string, string, number, number, string?][] = [
    ['5.1', 'Aluguel do salão', 300_000, 10, 'Imobiliária Central'],
    ['5.2', 'Energia elétrica', 150_000, 15, 'Enel'],
    ['5.3', 'Água e esgoto', 60_000, 12, 'Sabesp'],
    ['8.3', 'Internet', 20_000, 8, 'Vivo Fibra'],
    ['8.1', 'Contador', 90_000, 10, 'Contabilidade Alfa'],
    ['5.4', 'Gás (forno e cozinha)', 110_000, 20, 'Ultragaz'],
    ['8.2', 'Sistema Delivery360', 29_900, 5, 'Delivery360'],
    ['7.1', 'Anúncios Instagram/Facebook', 120_000, 25, 'Meta'],
    ['8.4', 'Material de limpeza', 35_000, 18, 'Atacadão'],
  ];
  for (const month of [lastMonth, thisMonth]) {
    for (const [code, description, amount, dueDay, who] of fixed) {
      const due = `${month}-${String(dueDay).padStart(2, '0')}`;
      const paid = due < today && !(month === thisMonth && code === '5.3');
      await services.upsert(tenantId, `sim:${month}:${code}`, {
        type: 'PAYABLE',
        code,
        description: `${description} ${month.slice(5)}/${month.slice(0, 4)}`,
        counterparty: who,
        amountCents: amount,
        day: due,
        dueDay: due,
        status: paid ? 'PAID' : 'OPEN',
        source: 'manual',
      });
    }
  }
  // Compras de insumos (CMV real) toda semana, perto do CMV da ficha técnica.
  const cmv = await prisma.orderItem.aggregate({
    where: { order: { tenantId, status: { not: 'CANCELLED' } } },
    _sum: { unitCostCents: true },
  });
  const items = await prisma.orderItem.findMany({ where: { order: { tenantId, status: { not: 'CANCELLED' } } }, select: { unitCostCents: true, quantity: true } });
  const theoretical = items.reduce((t, i) => t + i.unitCostCents * i.quantity, 0) || (cmv._sum.unitCostCents ?? 0);
  const weekly = Math.round((theoretical * 1.06) / 5);
  const suppliers: [string, string, number][] = [
    ['3.1', 'Laticínios Serra (queijos)', 0.42],
    ['3.1', 'Frigorífico Bom Corte (carnes e embutidos)', 0.2],
    ['3.1', 'Hortifruti e mercearia', 0.16],
    ['3.2', 'Distribuidora de bebidas', 0.12],
    ['3.3', 'Embalagens (caixas e copos)', 0.1],
  ];
  for (let w = 0; w < 5; w++) {
    const day = addDays(today, -28 + w * 7);
    for (const [s, [code, who, share]] of suppliers.entries()) {
      const due = addDays(day, 14);
      await services.upsert(tenantId, `sim:compra:${w}:${s}`, {
        type: 'PAYABLE',
        code,
        description: `Compra semanal · ${who}`,
        counterparty: who,
        amountCents: Math.round(weekly * share * (0.92 + r() * 0.16)),
        day,
        dueDay: due,
        status: due < today ? 'PAID' : 'OPEN',
        source: 'manual',
      });
    }
  }
  await services.upsert(tenantId, 'sim:manutencao-forno', {
    type: 'PAYABLE',
    code: '8.5',
    description: 'Manutenção do forno',
    counterparty: 'Fornos Brasil',
    amountCents: 48_000,
    day: addDays(today, -8),
    dueDay: addDays(today, -2),
    status: 'OPEN',
    source: 'manual',
  });

  // Folha do mês passado: fechada e paga; a deste mês fica em rascunho para fechar no fim do mês.
  const pay = await services.payroll(tenantId, lastMonth);
  const renan = pay.items.find((i) => i.employeeId === byName('Renan Siqueira').id);
  if (renan) await services.updatePayrollItem(tenantId, owner.id, renan.id, { days: 9 });
  const antonio = pay.items.find((i) => i.employeeId === byName('Antônio Ferraz').id);
  if (antonio) await services.updatePayrollItem(tenantId, owner.id, antonio.id, { extrasCents: 32_000, bonusCents: 20_000 });
  await services.closePayroll(tenantId, owner.id, lastMonth);
  const current = await services.payroll(tenantId, thisMonth);
  const renanNow = current.items.find((i) => i.employeeId === byName('Renan Siqueira').id);
  if (renanNow) await services.updatePayrollItem(tenantId, owner.id, renanNow.id, { days: 7 });
  const roberta = current.items.find((i) => i.employeeId === byName('Roberta Mendes').id);
  if (roberta) await services.updatePayrollItem(tenantId, owner.id, roberta.id, { advanceCents: 150_000 });

  // O que já venceu foi pago (impostos do mês passado, folha, motoboys da semana), menos as contas deixadas em atraso.
  await prisma.financialEntry.updateMany({
    where: { tenantId, type: 'PAYABLE', status: 'OPEN', dueDate: { lt: dbDate(today) }, source: { in: ['pessoas', 'cardapio'] }, NOT: { account: { code: '4.6' } } },
    data: { status: 'PAID', paidAt: dbDate(addDays(today, -1)) },
  });
  // Motoboys: acerto toda segunda; a semana atual fica em aberto.
  const lastMonday = (() => {
    let d = today;
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, -1);
    return d;
  })();
  await prisma.financialEntry.updateMany({
    where: { tenantId, type: 'PAYABLE', status: 'OPEN', source: 'entregas', account: { code: '6.1' }, competenceDate: { lt: dbDate(lastMonday) } },
    data: { status: 'PAID', paidAt: dbDate(lastMonday) },
  });
  // Repasses dos apps que já caíram (99Food em 14 dias, Keeta em 7). iFood (30 dias) ainda a receber.
  for (const channel of ['FOOD99', 'KEETA'] as const) {
    await services.registerPayout(tenantId, owner.id, channel, addDays(today, -1), addDays(today, -1)).catch(() => undefined);
  }
  log(`faturamento simulado: R$ ${(revenue / 100).toFixed(2)}`);
  return true;
}
