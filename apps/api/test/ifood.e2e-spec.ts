import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.PAYMENTS_FAKE_ENABLED = 'true';
process.env.IFOOD_WEBHOOK_SECRET = 'segredo-ifood';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupApp } = require('../src/setup-app');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require('../src/prisma/prisma.service');

describe('Hub iFood: webhook simulado, eventos, vínculo e cancelamento (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  const tokens: Record<string, string> = {};
  const tenants: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: 'a' | 'b') => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`).set('x-tenant-id', tenants[who]),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`).set('x-tenant-id', tenants[who]),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`).set('x-tenant-id', tenants[who]),
  });
  const sign = (body: unknown, secret = 'segredo-ifood') => createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  const hook = (body: Record<string, unknown>, signature = sign(body)) =>
    http().post('/public/webhooks/ifood').set('x-ifood-signature', signature).set('Content-Type', 'application/json').send(JSON.stringify(body));

  const order = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    displayId: '7001',
    orderType: 'DELIVERY',
    customer: { name: 'Bia iFood', phone: { number: '0800 700 1234', localizer: '11223344' } },
    delivery: { pickupCode: '4321', deliveryAddress: { streetName: 'Rua B', streetNumber: '20', neighborhood: 'Centro' } },
    items: [{ externalCode: 'XB01', name: 'X-Burger', quantity: 2, unitPrice: 35, options: [{ externalCode: 'AD-BACON', name: 'Bacon', unitPrice: 4 }] }],
    total: { subTotal: 78, deliveryFee: 7, benefits: 10, orderAmount: 75 },
    benefits: [{ value: 10, sponsorshipValues: [{ name: 'IFOOD', value: 6 }, { name: 'MERCHANT', value: 4 }] }],
    payments: { methods: [{ method: 'CREDIT', type: 'ONLINE', value: 75 }] },
    financial: { commission: 9.36, paymentFee: 2.43, payout: 69.21 },
    ...over,
  });
  const placed = (eventId: string, orderId: string, merchantId = 'merchant-a', over: Record<string, unknown> = {}) => ({
    id: eventId,
    fullCode: 'PLACED',
    orderId,
    merchantId,
    createdAt: new Date().toISOString(),
    order: order(orderId, over),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const admin = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${admin}`)).body;
    const full = plans.find((p: { name: string }) => p.name === 'Gestão 360');
    for (const who of ['a', 'b'] as const) {
      tenants[who] = (await http().post('/admin/tenants').set('Authorization', `Bearer ${admin}`).send({ name: `Hub ${who}`, planId: full.id })).body.id;
      await http()
        .post(`/admin/tenants/${tenants[who]}/users`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Dono', email: `dono-${who}@hub.test`, password: 'senha-forte-1', role: 'OWNER' });
      tokens[who] = (await http().post('/auth/login').send({ email: `dono-${who}@hub.test`, password: 'senha-forte-1' })).body.accessToken;
      const cat = (await as(who).post('/cardapio/categories').send({ name: 'Lanches' })).body.id;
      const product = (await as(who).post('/cardapio/products').send({ categoryId: cat, name: 'X-Burger', priceCents: 3000, pdvCode: 'XB01' })).body.id;
      const group = (await as(who).post(`/cardapio/products/${product}/groups`).send({ name: 'Adicionais', minSelect: 0, maxSelect: 3 })).body.id;
      await as(who).post(`/cardapio/groups/${group}/options`).send({ name: 'Bacon', priceCents: 400, pdvCode: 'AD-BACON' });
    }
    await as('a').put('/cardapio/canais/IFOOD').send({ active: true, commissionBps: 2000, paymentFeeBps: 500, payoutDays: 30, merchantId: 'merchant-a' });
    await as('b').put('/cardapio/canais/IFOOD').send({ active: true, merchantId: 'merchant-b' });
  });

  afterAll(async () => {
    await app.close();
  });

  const entries = async (search: string) =>
    (await as('a').get(`/gestao/entries?search=${encodeURIComponent(search)}`)).body.items as { status: string; amountCents: number; account: { code: string }; description: string }[];

  it('importa o catálogo simulado uma vez por loja e confirma separadamente a mudança de preço', async () => {
    const base = '/cardapio/canais/ifood/cardapio';
    const preview = (who: 'a' | 'b', revised: boolean) =>
      as(who).post(`${base}/previa`).send({ revised }).expect(200);
    const confirm = (who: 'a' | 'b', revised: boolean, token: string) =>
      as(who).post(`${base}/confirmar`).send({ revised, token });
    const product = () => prisma.product.findUniqueOrThrow({
      where: { tenantId_pdvCode: { tenantId: tenants.a, pdvCode: 'IFOOD-DEMO-CLASSICO' } },
      include: { optionGroups: { include: { options: true } } },
    });

    const first = (await preview('a', false)).body;
    expect(first.rows.map((r: { action: string }) => r.action)).toEqual(Array(5).fill('Criar'));
    await confirm('b', false, first.token).expect(409);
    expect((await confirm('a', false, first.token).expect(200)).body.affected).toBe(5);
    await confirm('a', false, first.token).expect(409);
    const repeat = (await preview('a', false)).body;
    expect((await confirm('a', false, repeat.token).expect(200)).body.affected).toBe(0);
    const created = await product();
    expect(created.optionGroups).toHaveLength(1);
    expect(created.optionGroups[0].options).toHaveLength(2);

    const costItems = [{ name: 'Pão', kind: 'INGREDIENT', costCents: 300 }];
    await prisma.product.update({ where: { id: created.id }, data: { costItems } });
    const revised = (await preview('a', true)).body;
    expect(revised.rows).toContainEqual(expect.objectContaining({
      kind: 'Produto', action: 'Atualizar preço', currentPrice: 2990, price: 3490,
    }));
    expect((await product()).channelPrices).toEqual({ IFOOD: 2990 });
    expect((await confirm('a', true, revised.token).expect(200)).body.affected).toBe(1);
    expect(await product()).toEqual(expect.objectContaining({
      id: created.id, priceCents: 2990, channelPrices: { IFOOD: 3490 }, costItems,
    }));
    expect((await preview('b', false)).body.rows.map((r: { action: string }) => r.action)).toEqual(Array(5).fill('Criar'));
  });

  it('o código da loja é de um restaurante só; assinatura errada é recusada', async () => {
    const taken = await as('b').put('/cardapio/canais/IFOOD').send({ merchantId: 'merchant-a' });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toContain('outro restaurante');
    const body = placed('ev-x', 'o-x');
    expect((await hook(body, sign(body, 'errado'))).status).toBe(401);
    expect((await http().post('/public/webhooks/ifood').send(body)).status).toBe(401);
    expect((await hook({ fullCode: 'PLACED' })).status).toBe(400);
    expect(await prisma.channelEvent.count({ where: { eventId: 'ev-x' } })).toBe(0);
  });

  it('PLACED cria o pedido uma vez só: mesmo evento 2x e mesmo pedido em 2 eventos', async () => {
    const first = await hook(placed('ev-1', 'o-1'));
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'PROCESSED', duplicated: false });
    expect((await hook(placed('ev-1', 'o-1'))).body).toMatchObject({ status: 'PROCESSED', duplicated: true });
    expect((await hook(placed('ev-1b', 'o-1'))).body).toMatchObject({ status: 'IGNORED' });

    const orders = await prisma.order.findMany({ where: { tenantId: tenants.a, channel: 'IFOOD', externalId: 'o-1' }, include: { channelLink: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: 'PAID',
      type: 'DELIVERY',
      externalCode: '7001',
      deliveryCode: '4321',
      paymentMethod: 'APP_ONLINE',
      subtotalCents: 7800,
      deliveryFeeCents: 700,
      discountCents: 1000,
      totalCents: 7500,
    });
    expect(orders[0].channelLink).toMatchObject({ externalStatus: 'PLACED' });
    expect(orders[0].channelLink.externalAmounts).toMatchObject({ ifoodDiscountCents: 600, commissionCents: 936, paymentFeeCents: 243, payoutCents: 6921 });

    // Financeiro: venda pelo que o cliente pagou, desconto do iFood a receber, comissão e taxa pelo valor do iFood.
    const rows = await entries(`#${orders[0].number} `);
    const receivable = rows.filter((e) => e.account.code === '1.3').map((e) => e.amountCents).sort((x, y) => x - y);
    expect(receivable).toEqual([600, 7500]);
    expect(rows.find((e) => e.account.code === '2.2')).toMatchObject({ amountCents: 936 });
    expect(rows.find((e) => e.account.code === '2.3')).toMatchObject({ amountCents: 243 });
    expect(rows.filter((e) => e.account.code === '1.3')).toHaveLength(2);
  });

  it('outros eventos mudam só a situação no iFood, não o nosso status', async () => {
    expect((await hook({ id: 'ev-2', code: 'CFM', orderId: 'o-1', merchantId: 'merchant-a' })).body.status).toBe('PROCESSED');
    const o = await prisma.order.findFirstOrThrow({ where: { tenantId: tenants.a, externalId: 'o-1' }, include: { channelLink: true } });
    expect(o.status).toBe('PAID');
    expect(o.channelLink.externalStatus).toBe('CONFIRMED');
    expect((await hook({ id: 'ev-2b', fullCode: 'DISPATCHED', orderId: 'o-nao-existe', merchantId: 'merchant-a' })).body.status).toBe('IGNORED');
  });

  it('isolamento: merchantId de outro restaurante cria lá; desconhecido fica IGNORED', async () => {
    expect((await hook(placed('ev-3', 'o-b1', 'merchant-b'))).body.status).toBe('PROCESSED');
    expect(await prisma.order.count({ where: { tenantId: tenants.a, externalId: 'o-b1' } })).toBe(0);
    expect(await prisma.order.count({ where: { tenantId: tenants.b, externalId: 'o-b1' } })).toBe(1);

    const unknown = await hook(placed('ev-4', 'o-z', 'merchant-zzz'));
    expect(unknown.body.status).toBe('IGNORED');
    expect(await prisma.order.count({ where: { externalId: 'o-z' } })).toBe(0);
    const ev = await prisma.channelEvent.findFirstOrThrow({ where: { eventId: 'ev-4' } });
    expect(ev).toMatchObject({ tenantId: null, status: 'IGNORED' });
    // O dono de um restaurante não vê nem reprocessa evento de outro.
    expect((await as('a').get('/cardapio/canais/ifood/eventos')).body.some((e: { eventId: string }) => e.eventId === 'ev-3')).toBe(false);
    const evB = await prisma.channelEvent.findFirstOrThrow({ where: { eventId: 'ev-3' } });
    expect((await as('a').post(`/cardapio/canais/ifood/eventos/${evB.id}/reprocessar`)).status).toBe(404);
  });

  it('item sem código PDV: evento FAILED; depois de cadastrar, reprocessar cria o pedido uma vez só', async () => {
    const body = placed('ev-5', 'o-5', 'merchant-a', {
      items: [{ externalCode: 'SUCO-1', name: 'Suco de laranja', quantity: 1, unitPrice: 9 }],
      total: { subTotal: 9, deliveryFee: 0, orderAmount: 9 },
      benefits: [],
      financial: undefined,
    });
    const res = await hook(body);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.error).toContain('SUCO-1');
    expect(await prisma.order.count({ where: { externalId: 'o-5' } })).toBe(0);
    const ev = await prisma.channelEvent.findFirstOrThrow({ where: { eventId: 'ev-5' } });

    // Ainda sem o código: continua com erro e conta a tentativa.
    expect((await as('a').post(`/cardapio/canais/ifood/eventos/${ev.id}/reprocessar`)).body.status).toBe('FAILED');
    const cat = (await as('a').get('/cardapio/menu')).body[0].id;
    await as('a').post('/cardapio/products').send({ categoryId: cat, name: 'Suco', priceCents: 900, pdvCode: 'SUCO-1' });
    const ok = await as('a').post(`/cardapio/canais/ifood/eventos/${ev.id}/reprocessar`);
    expect(ok.body.status).toBe('PROCESSED');
    expect((await as('a').post(`/cardapio/canais/ifood/eventos/${ev.id}/reprocessar`)).status).toBe(409);
    expect(await prisma.order.count({ where: { externalId: 'o-5' } })).toBe(1);
    expect((await prisma.channelEvent.findUniqueOrThrow({ where: { id: ev.id } })).attempts).toBe(3);

    // Sem valor do iFood: comissão pelo % configurado (20% de R$ 9,00).
    const o = await prisma.order.findFirstOrThrow({ where: { externalId: 'o-5' } });
    expect((await entries(`#${o.number} `)).find((e) => e.account.code === '2.2')).toMatchObject({ amountCents: 180 });
  });

  it('CANCELLED depois do PLACED cancela o pedido e tira a venda do financeiro', async () => {
    const o = await prisma.order.findFirstOrThrow({ where: { tenantId: tenants.a, externalId: 'o-1' } });
    const res = await hook({ id: 'ev-6', fullCode: 'CANCELLED', orderId: 'o-1', merchantId: 'merchant-a', metadata: { reason: 'Cliente desistiu' } });
    expect(res.body.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { channelLink: true, statusHistory: true } });
    expect(after.status).toBe('CANCELLED');
    expect(after.channelLink.externalStatus).toBe('CANCELLED');
    expect(after.statusHistory.some((h: { note: string | null }) => h.note === 'Cancelado pelo iFood: Cliente desistiu')).toBe(true);
    // A venda some do a receber (a lista padrão esconde os cancelados).
    expect(await entries(`#${o.number} `)).toEqual([]);
    const all = await prisma.financialEntry.findMany({ where: { tenantId: tenants.a, externalKey: { startsWith: `order:${o.id}:` } } });
    expect(all.map((e: { externalKey: string }) => e.externalKey.split(':')[2]).sort()).toEqual(['commission', 'fee', 'sale', 'subsidy']);
    expect(all.every((e: { status: string }) => e.status === 'CANCELLED')).toBe(true);
    // Evento atrasado não "descancela".
    expect((await hook({ id: 'ev-7', fullCode: 'DISPATCHED', orderId: 'o-1', merchantId: 'merchant-a' })).body.status).toBe('IGNORED');
  });

  it('CANCELLED antes do PLACED fica anotado e o pedido não entra', async () => {
    expect((await hook({ id: 'ev-8', fullCode: 'CANCELLED', orderId: 'o-8', merchantId: 'merchant-a' })).body.status).toBe('PROCESSED');
    expect((await hook(placed('ev-9', 'o-8'))).body.status).toBe('IGNORED');
    expect(await prisma.order.count({ where: { externalId: 'o-8' } })).toBe(0);
    expect(await prisma.channelOrderLink.findFirst({ where: { externalId: 'o-8' } })).toMatchObject({ externalStatus: 'CANCELLED', orderId: null });
    const list = (await as('a').get('/cardapio/canais/ifood/eventos?status=IGNORED')).body;
    expect(list.find((e: { eventId: string }) => e.eventId === 'ev-9').error).toContain('cancelou');
  });
});
