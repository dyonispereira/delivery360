import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

/**
 * Loja modelo "Fornalha Pizzaria" (fictícia): vitrine completa para apresentar o Delivery360.
 * Logo, capa, fotos dos produtos e banners ficam em apps/web/public/vitrine/fornalha (gerados por
 * apps/web/scripts/vitrine/render.mjs). Roda com SEED_DEMO=true; cria uma vez e, a cada início,
 * completa os pedidos dos últimos dias para "Mais pedidos" e a nota da loja não sumirem.
 */
export const SHOWCASE_SLUG = 'fornalha';
const IMG = '/vitrine/fornalha';
const DAY = 86_400_000;

type Flavor = { name: string; description: string; price: number; image: string; cost: number; premium?: number };

const TRADICIONAIS: Flavor[] = [
  { name: 'Calabresa', description: 'Molho de tomate italiano, mussarela, calabresa artesanal, cebola roxa e azeitona preta.', price: 5990, image: 'pizza-calabresa', cost: 1650 },
  { name: 'Margherita', description: 'Molho de tomate, mussarela, tomate fresco, manjericão e parmesão ralado.', price: 6290, image: 'pizza-margherita', cost: 1620 },
  { name: 'Mussarela', description: 'Molho de tomate, muita mussarela, rodelas de tomate, azeitona e orégano.', price: 5490, image: 'pizza-mussarela', cost: 1450 },
  { name: 'Frango com Catupiry', description: 'Frango desfiado temperado, catupiry original e azeitona.', price: 6690, image: 'pizza-frango', cost: 1880 },
  { name: 'Portuguesa', description: 'Presunto, ovo, ervilha, cebola, azeitona e mussarela.', price: 6690, image: 'pizza-portuguesa', cost: 1900 },
  { name: 'Pepperoni', description: 'Pepperoni fatiado fininho sobre mussarela gratinada.', price: 6990, image: 'pizza-pepperoni', cost: 2050 },
  { name: 'Bacon', description: 'Bacon em cubos crocante, cebola roxa e mussarela.', price: 6490, image: 'pizza-bacon', cost: 1850 },
];
const ESPECIAIS: Flavor[] = [
  { name: 'Quatro Queijos', description: 'Mussarela, gorgonzola, catupiry e parmesão.', price: 7290, image: 'pizza-quatroqueijos', cost: 2350, premium: 500 },
  { name: 'Brócolis com Bacon', description: 'Brócolis, bacon crocante, tomate-cereja e mussarela.', price: 6990, image: 'pizza-brocolis', cost: 2000, premium: 300 },
  { name: 'Baiana', description: 'Calabresa moída apimentada, milho, pimenta calabresa e azeitona. Arde!', price: 6490, image: 'pizza-baiana', cost: 1800 },
  { name: 'Camarão com Catupiry', description: 'Camarão refogado no alho, catupiry e manjericão.', price: 8990, image: 'pizza-camarao', cost: 3400, premium: 1500 },
];
const DOCES: Flavor[] = [
  { name: 'Chocolate com Morango', description: 'Chocolate ao leite, morangos frescos, fios de chocolate branco e confeitos.', price: 5990, image: 'pizza-chocolate', cost: 1700 },
  { name: 'Banana com Canela', description: 'Banana caramelizada, leite condensado, canela e açúcar.', price: 5290, image: 'pizza-banana', cost: 1300 },
];

const ZONES: [string, number][] = [
  ['Irajá', 500],
  ['Vila da Penha', 600],
  ['Vista Alegre', 700],
  ['Vicente de Carvalho', 700],
  ['Madureira', 900],
];

const REVIEWS = [
  'Chegou quentinha e a borda é sensacional!',
  'Melhor meio metro do bairro, pedi de novo.',
  'Massa leve, dá pra comer a pizza inteira sem pesar.',
  'Entrega rápida e o motoboy super educado.',
  'A de camarão é muito bem servida.',
  'Pedi pelo site e foi bem mais barato que no app.',
  'Calabresa caprichada, recomendo.',
  null,
  null,
  'Atendimento nota 10 no WhatsApp.',
];
const CUSTOMERS = ['Ana Paula', 'Bruno Costa', 'Carla Mendes', 'Diego Rocha', 'Elaine Souza', 'Fábio Lima', 'Gabriela Nunes', 'Henrique Alves', 'Isabela Freitas', 'João Pedro', 'Larissa Gomes', 'Marcos Vinícius', 'Natália Reis', 'Otávio Pires', 'Priscila Duarte', 'Rafael Moura'];

export async function seedShowcase(prisma: PrismaClient) {
  const existing = await prisma.store.findUnique({ where: { slug: SHOWCASE_SLUG } });
  if (existing) {
    await addExtras(prisma, existing.tenantId);
    return topUpOrders(prisma, existing.tenantId);
  }

  const plan = await prisma.plan.findUniqueOrThrow({ where: { name: 'Gestão 360' }, include: { modules: true } });
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Fornalha Pizzaria',
      planId: plan.id,
      modules: { create: plan.modules.map((m) => ({ moduleCode: m.moduleCode, active: true, startsAt: new Date() })) },
    },
  });
  const tenantId = tenant.id;
  const email = process.env.SEED_SHOWCASE_EMAIL ?? 'dono@fornalha.local';
  const password = process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
  const owner = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'Marcelo Fornalha', email, passwordHash: await bcrypt.hash(password, 10) },
  });
  await prisma.membership.create({ data: { userId: owner.id, tenantId, role: 'OWNER' } });
  await prisma.store.create({
    data: {
      tenantId,
      slug: SHOWCASE_SLUG,
      displayName: 'Fornalha Pizzaria',
      description: 'Pizza artesanal no forno a lenha, massa de fermentação natural. Rende 8 fatias.',
      logoUrl: `${IMG}/logo.png`,
      coverUrl: `${IMG}/capa.webp`,
      whatsapp: '5521999990000',
      city: 'Rio de Janeiro',
      isOpen: true,
      minOrderCents: 3000,
      estimatedMinutes: 40,
      paymentMethods: ['PIX', 'CREDIT_CARD', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'],
    },
  });
  await prisma.deliveryZone.createMany({ data: ZONES.map(([name, feeCents]) => ({ tenantId, name, feeCents })) });
  await prisma.financeSettings.create({
    data: { tenantId, salesTaxBps: 600, pixFeeBps: 99, creditFeeBps: 399, cardOnDeliveryFeeBps: 239, targetMarginBps: 2200 },
  });
  await prisma.courier.create({
    data: { tenantId, name: 'Wellington Santos', phone: '5521988887777', feeCents: 700, plate: 'RIO2B26', accessToken: randomBytes(18).toString('base64url') },
  });

  // ---------- Cardápio ----------
  const cat = async (name: string, position: number) => (await prisma.menuCategory.create({ data: { tenantId, name, position } })).id;
  const black = await cat('🔥 Semana da Black Friday', 0);
  const trad = await cat('🍕 Pizzas tradicionais', 1);
  const esp = await cat('⭐ Pizzas especiais', 2);
  const doce = await cat('🍫 Pizzas doces', 3);
  const combos = await cat('🎉 Combos', 4);
  const bebidas = await cat('🥤 Bebidas', 5);

  const borda = (productId: string) =>
    prisma.optionGroup.create({
      data: {
        tenantId, productId, name: 'Borda', minSelect: 1, maxSelect: 1, position: 1,
        options: { create: [
          { tenantId, name: 'Tradicional', priceCents: 0, position: 0 },
          { tenantId, name: 'Recheada de catupiry', priceCents: 900, costCents: 350, position: 1 },
          { tenantId, name: 'Recheada de cheddar', priceCents: 900, costCents: 350, position: 2 },
          { tenantId, name: 'Recheada de chocolate', priceCents: 1000, costCents: 380, position: 3 },
        ] },
      },
    });
  const adicionais = (productId: string) =>
    prisma.optionGroup.create({
      data: {
        tenantId, productId, name: 'Adicionais', minSelect: 0, maxSelect: 4, position: 2,
        options: { create: [
          { tenantId, name: 'Bacon', priceCents: 600, costCents: 220, position: 0 },
          { tenantId, name: 'Catupiry extra', priceCents: 700, costCents: 260, position: 1 },
          { tenantId, name: 'Azeitona', priceCents: 300, costCents: 80, position: 2 },
          { tenantId, name: 'Cebola caramelizada', priceCents: 400, costCents: 90, position: 3 },
        ] },
      },
    });
  const sheet = (cost: number, box = 280) => [
    { name: 'Massa de fermentação natural', kind: 'INGREDIENT', costCents: 380 },
    { name: 'Molho e coberturas', kind: 'INGREDIENT', costCents: Math.max(0, cost - 380 - box) },
    { name: 'Caixa de pizza', kind: 'PACKAGING', costCents: box },
  ];

  const ids: Record<string, string> = {};
  const addFlavor = async (categoryId: string, f: Flavor, position: number, code: string) => {
    const p = await prisma.product.create({
      data: {
        tenantId, categoryId, name: f.name, description: f.description, priceCents: f.price, position,
        imageUrl: `${IMG}/${f.image}.webp`, pdvCode: code, costItems: sheet(f.cost), channelPrices: { IFOOD: Math.ceil((f.price * 1.15) / 100) * 100 - 10 },
      },
    });
    ids[f.name] = p.id;
    await borda(p.id);
    await adicionais(p.id);
  };
  for (const [i, f] of TRADICIONAIS.entries()) await addFlavor(trad, f, i, `PZ-T${i + 1}`);
  for (const [i, f] of ESPECIAIS.entries()) await addFlavor(esp, f, i, `PZ-E${i + 1}`);
  for (const [i, f] of DOCES.entries()) await addFlavor(doce, f, i, `PZ-D${i + 1}`);

  // Ofertas de/por com escolha de sabores (como as lojas fazem no Instagram).
  const sabores = [...TRADICIONAIS, ...ESPECIAIS];
  const offer = async (name: string, description: string, price: number, promo: number, image: string, max: number, position: number, cost: number, code: string) => {
    const p = await prisma.product.create({
      data: {
        tenantId, categoryId: black, name, description, priceCents: price, promoPriceCents: promo, position,
        imageUrl: `${IMG}/${image}.webp`, pdvCode: code, costItems: sheet(cost, 450),
      },
    });
    ids[name] = p.id;
    await prisma.optionGroup.create({
      data: {
        tenantId, productId: p.id, name: `Escolha até ${max} sabores`, minSelect: 1, maxSelect: max, position: 0,
        options: { create: sabores.map((s, i) => ({ tenantId, name: s.name, priceCents: s.premium ?? 0, position: i })) },
      },
    });
    await borda(p.id);
  };
  await offer('Pizza Grande no Precinho', 'Escolha até 3 sabores. 8 fatias. Só nesta semana!', 11000, 7590, 'promo-grande', 3, 0, 2100, 'BF-GRANDE');
  await offer('Meio Metro da Casa', '🔥 Nossa pizza mais pedida! 12 fatias, até 3 sabores e massa feita na hora.', 11800, 6990, 'promo-meio-metro', 3, 1, 2900, 'BF-MEIO');
  await offer('Pizza Metro Família', 'Pizza metro com 24 fatias e até 4 sabores. Para a família toda.', 20200, 12990, 'promo-metro', 4, 2, 5200, 'BF-METRO');

  // Bebidas
  const drinks: [string, string, number, string, number][] = [
    ['Refrigerante Cola 2L', 'Gelado.', 1600, 'bebida-cola', 750],
    ['Guaraná 2L', 'Gelado.', 1400, 'bebida-guarana', 650],
    ['Suco de laranja 500ml', 'Natural, feito na hora.', 1200, 'bebida-laranja', 350],
    ['Água mineral 500ml', 'Sem gás.', 500, 'bebida-agua', 150],
  ];
  for (const [i, [name, description, priceCents, image, cost]] of drinks.entries()) {
    const p = await prisma.product.create({
      data: { tenantId, categoryId: bebidas, name, description, priceCents, position: i, imageUrl: `${IMG}/${image}.webp`, pdvCode: `BB-${i + 1}`, costItems: [{ name, kind: 'INGREDIENT', costCents: cost }] },
    });
    ids[name] = p.id;
  }

  // Combo: 2 pizzas grandes + refrigerante 2L.
  const combo = await prisma.product.create({
    data: {
      tenantId, categoryId: combos, name: 'Combo Família', description: '2 pizzas grandes tradicionais + refrigerante 2L. Economize até R$ 32.',
      priceCents: 13990, position: 0, isCombo: true, imageUrl: `${IMG}/combo-familia.webp`, pdvCode: 'CB-FAM', costItems: [],
    },
  });
  ids['Combo Família'] = combo.id;
  for (const [g, step] of ['1ª pizza', '2ª pizza'].entries()) {
    await prisma.optionGroup.create({
      data: {
        tenantId, productId: combo.id, name: step, minSelect: 1, maxSelect: 1, position: g,
        options: { create: TRADICIONAIS.map((s, i) => ({ tenantId, name: s.name, priceCents: 0, position: i, linkedProductId: ids[s.name] })) },
      },
    });
  }
  await prisma.optionGroup.create({
    data: {
      tenantId, productId: combo.id, name: 'Refrigerante 2L', minSelect: 1, maxSelect: 1, position: 2,
      options: { create: [
        { tenantId, name: 'Refrigerante Cola 2L', priceCents: 0, position: 0, linkedProductId: ids['Refrigerante Cola 2L'] },
        { tenantId, name: 'Guaraná 2L', priceCents: 0, position: 1, linkedProductId: ids['Guaraná 2L'] },
      ] },
    },
  });

  // ---------- Cupons e banners ----------
  await prisma.coupon.createMany({
    data: [
      { tenantId, code: 'PRIMEIRA10', description: '10% no primeiro pedido pelo site', type: 'PERCENT', value: 1000, maxDiscountCents: 2000, firstOrderOnly: true, public: true },
      { tenantId, code: 'FRETEGRATIS', description: 'Entrega grátis acima de R$ 80', type: 'FREE_DELIVERY', value: 0, minOrderCents: 8000, public: true, maxUsesPerCustomer: null },
      { tenantId, code: 'TERCA15', description: 'Terça em dobro: R$ 15 off acima de R$ 120', type: 'FIXED', value: 1500, minOrderCents: 12000, weekdays: [2], public: true, maxUsesPerCustomer: null },
    ],
  });
  const banners: [string, string, string][] = [
    ['Semana da Black Friday', 'Meio metro por R$ 69,90 e pizza metro por R$ 129,90', 'banner-black'],
    ['Primeiro pedido pelo site?', 'Use o cupom PRIMEIRA10 e ganhe 10% de desconto', 'banner-primeira'],
    ['Terça em dobro', 'R$ 15 de desconto acima de R$ 120 com o cupom TERCA15', 'banner-terca'],
    ['Entrega grátis', 'Em pedidos acima de R$ 80 com o cupom FRETEGRATIS', 'banner-frete'],
  ];
  for (const [i, [title, subtitle, image]] of banners.entries()) {
    await prisma.campaign.create({ data: { title, subtitle, imageUrl: `${IMG}/${image}.webp`, tenantIds: [tenantId], position: 100 + i } });
  }

  await addExtras(prisma, tenantId);
  await topUpOrders(prisma, tenantId);
  console.log(`Loja modelo criada: /loja/${SHOWCASE_SLUG} (dono: ${email})`);
}

/** Pedidos entregues e avaliados nos últimos dias, para a loja mostrar "Mais pedidos" e a nota. */
/**
 * Itens que chegaram depois da primeira versão da loja modelo. Roda em todo start e só cria o que falta,
 * para a loja que já existe no site de teste também ganhar.
 */
async function addExtras(prisma: PrismaClient, tenantId: string) {
  const bebidas = await prisma.menuCategory.findFirst({ where: { tenantId, name: '🥤 Bebidas' } });
  if (bebidas) {
    const extra: [string, string, number, string, number, string][] = [
      ['Cola sem açúcar 1,5L', 'Gelada.', 1200, 'bebida-cola-zero', 560, 'BB-5'],
      ['Guaraná Zero 2L', 'Gelado.', 1400, 'bebida-guarana-zero', 650, 'BB-6'],
      ['Soda Limão 2L', 'Gelada.', 1400, 'bebida-limao', 650, 'BB-7'],
    ];
    for (const [i, [name, description, priceCents, image, cost, pdvCode]] of extra.entries()) {
      if (await prisma.product.findFirst({ where: { tenantId, pdvCode } })) continue;
      await prisma.product.create({
        data: { tenantId, categoryId: bebidas.id, name, description, priceCents, position: 4 + i, imageUrl: `${IMG}/${image}.webp`, pdvCode, costItems: [{ name, kind: 'INGREDIENT', costCents: cost }] },
      });
    }
  }
  const banner = `${IMG}/banner-vantagens.webp`;
  if (!(await prisma.campaign.findFirst({ where: { imageUrl: banner } }))) {
    await prisma.campaign.create({
      data: { title: 'Vantagens de pedir pelo site', subtitle: 'Cupons, Pix ou cartão e aviso no WhatsApp a cada etapa', imageUrl: banner, tenantIds: [tenantId], position: 99 },
    });
  }
}

async function topUpOrders(prisma: PrismaClient, tenantId: string) {
  const since = new Date(Date.now() - 20 * DAY);
  const recent = await prisma.order.count({ where: { tenantId, createdAt: { gte: since } } });
  if (recent >= 30) return;
  const products = await prisma.product.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, priceCents: true, promoPriceCents: true, isCombo: true } });
  const zones = await prisma.deliveryZone.findMany({ where: { tenantId } });
  if (!products.length || !zones.length) return;
  // Peso de cada produto: as ofertas e as clássicas saem mais.
  const weight = (name: string) =>
    ({ 'Meio Metro da Casa': 9, 'Pizza Grande no Precinho': 7, Calabresa: 6, 'Frango com Catupiry': 5, 'Refrigerante Cola 2L': 6, 'Pizza Metro Família': 4, Pepperoni: 3, 'Guaraná 2L': 3, 'Combo Família': 3 })[name] ?? 1;
  const bag = products.flatMap((p) => Array(weight(p.name)).fill(p));
  let seed = 4242 + recent;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const last = await prisma.order.aggregate({ where: { tenantId }, _max: { number: true } });
  let number = last._max.number ?? 0;
  for (let i = recent; i < 36; i++) {
    const zone = zones[Math.floor(rnd() * zones.length)];
    const name = CUSTOMERS[Math.floor(rnd() * CUSTOMERS.length)];
    const phone = `21987${String(100000 + Math.floor(rnd() * 899999))}`;
    const createdAt = new Date(Date.now() - (1 + rnd() * 18) * DAY - rnd() * 4 * 3600_000);
    const picks = Array.from({ length: 1 + Math.floor(rnd() * 2.2) }, () => bag[Math.floor(rnd() * bag.length)]);
    const items = picks.map((p) => {
      const unit = p.promoPriceCents ?? p.priceCents;
      return { productId: p.id, name: p.name, unitPriceCents: unit, listUnitPriceCents: p.promoPriceCents ? p.priceCents : null, quantity: 1, totalCents: unit };
    });
    const subtotal = items.reduce((s, it) => s + it.totalCents, 0);
    const promo = items.reduce((s, it) => s + (it.listUnitPriceCents ? it.listUnitPriceCents - it.unitPriceCents : 0), 0);
    const customer = await prisma.customer.upsert({ where: { tenantId_phone: { tenantId, phone } }, update: {}, create: { tenantId, phone, name } });
    const rated = rnd() < 0.7;
    const stars = rnd() < 0.82 ? 5 : 4;
    number += 1;
    await prisma.order.create({
      data: {
        tenantId, number, trackingCode: randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 12),
        customerId: customer.id, type: 'DELIVERY', status: 'COMPLETED', customerName: name, customerPhone: phone,
        addressStreet: 'Rua Exemplo', addressNumber: String(10 + Math.floor(rnd() * 900)), deliveryZoneId: zone.id, deliveryZoneName: zone.name,
        subtotalCents: subtotal, promoDiscountCents: promo, deliveryFeeCents: zone.feeCents, totalCents: subtotal + zone.feeCents,
        paymentMethod: (['PIX', 'PIX', 'CREDIT_CARD', 'CARD_ON_DELIVERY', 'CASH_ON_DELIVERY'] as const)[Math.floor(rnd() * 5)],
        createdAt, deliveredAt: new Date(createdAt.getTime() + (30 + rnd() * 20) * 60_000),
        ...(rated ? { ratingStore: stars, ratingDelivery: 5, ratingComment: REVIEWS[Math.floor(rnd() * REVIEWS.length)], ratedAt: new Date(createdAt.getTime() + 2 * 3600_000) } : {}),
        items: { create: items },
        statusHistory: { create: [{ status: 'PAID', createdAt }, { status: 'COMPLETED', createdAt: new Date(createdAt.getTime() + 45 * 60_000) }] },
      },
    });
  }
}
