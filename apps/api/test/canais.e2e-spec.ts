import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.PAYMENTS_FAKE_ENABLED = 'true';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupApp } = require('../src/setup-app');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require('../src/prisma/prisma.service');

describe('Canais de venda: iFood, 99Food e Keeta pelo código PDV (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let adminToken: string;
  let ownerToken: string;
  let staffToken: string;
  let tenantId: string;
  let slug: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
  });
  const owner = () => as(ownerToken);
  const staff = () => as(staffToken);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const full = plans.find((p: { name: string }) => p.name === 'Gestão 360');
    tenantId = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Hamburgueria Canais', planId: full.id })).body.id;
    for (const [email, role] of [
      ['dono@canais.test', 'OWNER'],
      ['func@canais.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@canais.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@canais.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    await owner().put('/cardapio/store').send({ isOpen: true });
    const cat = (await owner().post('/cardapio/categories').send({ name: 'Lanches' })).body.id;
    ids.product = (
      await owner()
        .post('/cardapio/products')
        .send({
          categoryId: cat,
          name: 'X-Burger',
          priceCents: 3000,
          pdvCode: 'XB01',
          channelPrices: { IFOOD: 3500 },
          costItems: [
            { name: 'Pão', kind: 'INGREDIENT', costCents: 300 },
            { name: 'Hambúrguer', kind: 'INGREDIENT', costCents: 500 },
          ],
        })
    ).body.id;
    const group = (await owner().post(`/cardapio/products/${ids.product}/groups`).send({ name: 'Adicionais', minSelect: 0, maxSelect: 3 })).body.id;
    ids.bacon = (await owner().post(`/cardapio/groups/${group}/options`).send({ name: 'Bacon', priceCents: 400, costCents: 200, pdvCode: 'AD-BACON' })).body.id;
    ids.zone = (await owner().post('/cardapio/zones').send({ name: 'Centro', feeCents: 500 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const month = today.slice(0, 7);
  const entries = async (search: string, status = '') =>
    (await owner().get(`/gestao/entries?search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`)).body.items as {
      description: string;
      status: string;
      amountCents: number;
      dueDate: string;
      counterparty: string | null;
      paymentMethod: string | null;
      account: { code: string };
    }[];
  const plusDays = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const ifoodOrder = (externalId: string, extra: Record<string, unknown> = {}) => ({
    channel: 'IFOOD',
    externalId,
    externalCode: '#4821',
    type: 'DELIVERY',
    customer: { name: 'Maria iFood', phone: '0800 705 1150' },
    address: { street: 'Rua das Flores', number: '10', neighborhood: 'Centro' },
    items: [
      { pdvCode: 'XB01', name: 'X-Burger Artesanal', quantity: 2, unitPriceCents: 3500, options: [{ pdvCode: 'AD-BACON', name: 'Bacon extra', priceCents: 500 }] },
      { pdvCode: 'REFRI-9', name: 'Refrigerante lata', quantity: 1, unitPriceCents: 700 },
    ],
    deliveryFeeCents: 0,
    paymentMethod: 'APP_ONLINE',
    deliveryCode: '4821',
    ...extra,
  });

  it('código PDV é único por restaurante e só dono/gerente mexe nos canais', async () => {
    const cat = (await owner().get('/cardapio/menu')).body[0].id;
    const dup = await owner().post('/cardapio/products').send({ categoryId: cat, name: 'Outro', priceCents: 100, pdvCode: 'XB01' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('código PDV');
    expect((await owner().post('/cardapio/products').send({ categoryId: cat, name: 'Ruim', priceCents: 100, pdvCode: 'com espaço' })).status).toBe(400);
    expect((await staff().get('/cardapio/canais')).status).toBe(403);
    const list = (await owner().get('/cardapio/canais')).body;
    expect(list.map((c: { channel: string }) => c.channel)).toEqual(['IFOOD', 'FOOD99', 'KEETA']);
    expect(list[0]).toMatchObject({ active: false, commissionBps: 0, payoutDays: 30 });
  });

  it('pedido do iFood entra pelo código PDV, com o nome e o custo do nosso cardápio, uma vez só', async () => {
    await owner().put('/cardapio/canais/IFOOD').send({ active: true, commissionBps: 1200, paymentFeeBps: 320, payoutDays: 30, merchantId: 'loja-123' });
    expect((await owner().put('/cardapio/canais/UBER').send({ active: true })).status).toBe(400);
    const res = await owner().post('/cardapio/canais/pedidos').send(ifoodOrder('ifood-1'));
    expect(res.status).toBe(200);
    expect(res.body.duplicated).toBe(false);
    expect(res.body.unmatched).toEqual(['Refrigerante lata (código REFRI-9)']);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id }, include: { items: { include: { options: true } } } });
    expect(order).toMatchObject({ channel: 'IFOOD', externalCode: '#4821', status: 'PAID', paymentMethod: 'APP_ONLINE', deliveryCode: '4821', subtotalCents: 2 * 4000 + 700, totalCents: 8700 });
    const burger = order.items.find((i: { productId: string | null }) => i.productId === ids.product)!;
    expect(burger).toMatchObject({ name: 'X-Burger', unitPriceCents: 4000, quantity: 2, unitCostCents: 1000 });
    expect(burger.options[0]).toMatchObject({ optionId: ids.bacon, name: 'Bacon extra' });
    expect(order.items.find((i: { productId: string | null }) => i.productId === null)).toMatchObject({ name: 'Refrigerante lata', unitCostCents: 0 });

    const again = await owner().post('/cardapio/canais/pedidos').send(ifoodOrder('ifood-1'));
    expect(again.body).toMatchObject({ id: res.body.id, duplicated: true });
    expect(await prisma.order.count({ where: { tenantId, channel: 'IFOOD' } })).toBe(1);

    const board = (await staff().get('/cardapio/orders/board')).body;
    expect(board.find((o: { id: string }) => o.id === res.body.id)).toMatchObject({ channel: 'IFOOD', externalCode: '#4821' });
  });

  it('venda do iFood vai para a conta do iFood, com comissão e taxa a descontar no repasse', async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { tenantId, externalId: 'ifood-1' } });
    const rows = await entries(`#${order.number} `);
    const sale = rows.find((e) => e.account.code === '1.3')!;
    expect(sale).toMatchObject({ status: 'OPEN', amountCents: 8700, counterparty: 'iFood', paymentMethod: 'APP_ONLINE', dueDate: plusDays(30) });
    expect(sale.description).toContain('iFood #4821');
    expect(rows.find((e) => e.account.code === '2.2')).toMatchObject({ amountCents: 1044, status: 'OPEN', dueDate: plusDays(30) });
    expect(rows.find((e) => e.account.code === '2.3')).toMatchObject({ amountCents: 278, status: 'OPEN' });

    // Entregue: pago no app continua a receber (o dinheiro vem no repasse).
    for (const status of ['IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED']) {
      await owner().patch(`/cardapio/orders/${order.id}/status`).send({ status });
    }
    expect((await entries(`#${order.number} `)).find((e) => e.account.code === '1.3')!.status).toBe('OPEN');
  });

  it('pedido do 99Food pago em dinheiro é recebido na entrega; cancelado do Keeta some do financeiro', async () => {
    await owner().put('/cardapio/canais/FOOD99').send({ active: true, commissionBps: 1000 });
    const r99 = await owner()
      .post('/cardapio/canais/pedidos')
      .send(ifoodOrder('99-1', { channel: 'FOOD99', externalCode: '991', paymentMethod: 'CASH_ON_DELIVERY', customer: { name: 'João', phone: '11 91234-5678' }, deliveryCode: undefined }));
    expect(r99.status).toBe(200);
    for (const status of ['IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED']) {
      await owner().patch(`/cardapio/orders/${r99.body.id}/status`).send({ status });
    }
    const rows99 = await entries(`#${r99.body.number} `);
    expect(rows99.find((e) => e.account.code === '1.6')).toMatchObject({ status: 'PAID', counterparty: 'João', paymentMethod: 'CASH_ON_DELIVERY' });
    expect(rows99.find((e) => e.account.code === '2.2')).toMatchObject({ amountCents: 870, status: 'OPEN' });

    await owner().put('/cardapio/canais/KEETA').send({ active: true, commissionBps: 900 });
    const rk = await owner().post('/cardapio/canais/pedidos').send(ifoodOrder('k-1', { channel: 'KEETA', externalCode: 'K1' }));
    await owner().patch(`/cardapio/orders/${rk.body.id}/status`).send({ status: 'CANCELLED' });
    const rowsK = await entries(`#${rk.body.number} `, 'CANCELLED');
    expect(rowsK.find((e) => e.account.code === '1.7')!.status).toBe('CANCELLED');
    expect(rowsK.find((e) => e.account.code === '2.2')!.status).toBe('CANCELLED');
  });

  it('resultado por canal e baixa do repasse do iFood', async () => {
    const res = (await owner().get(`/gestao/channels?from=${month}-01&to=${today}`)).body;
    const ifood = res.rows.find((r: { channel: string }) => r.channel === 'IFOOD');
    expect(ifood).toMatchObject({ orders: 1, revenueCents: 8700, commissionCents: 1044, feeCents: 278, cmvCents: 2000, toReceive: { count: 1, netCents: 8700 - 1044 - 278, nextPayout: plusDays(30) } });
    expect(ifood.netCents).toBe(8700 - 1044 - 278);
    expect(ifood.resultCents).toBe(ifood.netCents - 2000);
    expect(res.rows.find((r: { channel: string }) => r.channel === 'KEETA')).toMatchObject({ orders: 0, revenueCents: 0 });

    expect((await owner().post('/gestao/channels/IFOOD/payout').send({})).status).toBe(409);
    const payout = await owner().post('/gestao/channels/IFOOD/payout').send({ until: plusDays(30), paidAt: today });
    expect(payout.body).toMatchObject({ count: 3, grossCents: 8700, deductionsCents: 1322, netCents: 7378 });
    const after = (await owner().get(`/gestao/channels?from=${month}-01&to=${today}`)).body.rows.find((r: { channel: string }) => r.channel === 'IFOOD');
    expect(after.toReceive).toMatchObject({ count: 0, netCents: 0 });

    // DRE separa a receita por canal (conta do iFood, 99Food).
    const dre = (await owner().get(`/gestao/dre?from=${month}-01&to=${today}`)).body;
    expect(JSON.stringify(dre)).toContain('iFood');
  });

  it('margem dos produtos por canal desconta a comissão do app', async () => {
    const all = (await owner().get(`/gestao/products-margin?from=${month}-01&to=${today}`)).body;
    const ifood = (await owner().get(`/gestao/products-margin?from=${month}-01&to=${today}&channel=IFOOD`)).body;
    const burger = ifood.rows.find((r: { name: string }) => r.name === 'X-Burger');
    expect(burger).toMatchObject({ quantity: 2, revenueCents: 8000, cmvCents: 2000 });
    // 12% comissão + 3,2% taxa do app
    expect(burger.variableCents).toBe(Math.round(8000 * 0.152));
    expect(all.rows.find((r: { name: string }) => r.name === 'X-Burger').quantity).toBe(4);
    expect((await owner().get(`/gestao/products-margin?from=${month}-01&to=${today}&channel=UBER`)).status).toBe(400);
  });

  it('pedido de teste do app usa os produtos com código PDV e o preço do app', async () => {
    const res = await owner().post('/cardapio/canais/IFOOD/simular');
    expect(res.status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.id }, include: { items: true } });
    expect(order).toMatchObject({ channel: 'IFOOD', notes: 'Pedido de teste (simulado)' });
    expect(order.items[0]).toMatchObject({ productId: ids.product, unitPriceCents: 3500 });
  });
});
