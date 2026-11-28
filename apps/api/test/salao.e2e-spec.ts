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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GestaoSyncService } = require('../src/gestao/gestao-sync.service');

describe('Salão: garçom lança na mesa, cozinha recebe, caixa fecha (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let ownerToken: string;
  let waiterToken: string;
  let tenantId: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
  });
  const owner = () => as(ownerToken);
  const waiter = () => as(waiterToken);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const admin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
    tenantId = (await admin(http().post('/admin/tenants')).send({ name: 'Cantina do Salão' })).body.id;
    for (const m of ['cardapio', 'gestao']) await admin(http().put(`/admin/tenants/${tenantId}/modules/${m}`)).send({ active: true });
    for (const [name, email, role] of [
      ['Dona Rosa', 'dono@salao.test', 'OWNER'],
      ['Caio Brandão Lima', 'garcom@salao.test', 'STAFF'],
      ['Bia Garçom', 'bia@salao.test', 'WAITER'],
    ]) {
      await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@salao.test', password: 'senha-forte-1' })).body.accessToken;
    waiterToken = (await http().post('/auth/login').send({ email: 'garcom@salao.test', password: 'senha-forte-1' })).body.accessToken;
    ids.biaToken = (await http().post('/auth/login').send({ email: 'bia@salao.test', password: 'senha-forte-1' })).body.accessToken;

    await owner().get('/cardapio/store');
    ids.cat = (await owner().post('/cardapio/categories').send({ name: 'Pratos' })).body.id;
    ids.prato = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Parmegiana', priceCents: 5000 })).body.id;
    ids.ponto = (await owner().post(`/cardapio/products/${ids.prato}/groups`).send({ name: 'Acompanhamento', minSelect: 1, maxSelect: 1 })).body.id;
    ids.arroz = (await owner().post(`/cardapio/groups/${ids.ponto}/options`).send({ name: 'Arroz e fritas', priceCents: 0 })).body.id;
    ids.refri = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Refrigerante lata', priceCents: 700 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('dono cria as mesas de uma vez; garçom não cadastra mesa', async () => {
    const res = await owner().post('/cardapio/salao/tables/bulk').send({ count: 3 });
    expect(res.status).toBe(201);
    expect(res.body.tables.map((t: { name: string }) => t.name)).toEqual(['Mesa 1', 'Mesa 2', 'Mesa 3']);
    ids.mesa1 = res.body.tables[0].id;
    ids.mesa2 = res.body.tables[1].id;
    expect((await waiter().post('/cardapio/salao/tables').send({ name: 'Varanda' })).status).toBe(403);
    expect((await owner().post('/cardapio/salao/tables').send({ name: 'Mesa 1' })).status).toBe(409);
  });

  it('garçom vê o cardápio mesmo com a loja online fechada', async () => {
    const res = await waiter().get('/cardapio/salao/menu');
    expect(res.status).toBe(200);
    expect(res.body.categories[0].products.map((p: { name: string }) => p.name)).toEqual(['Parmegiana', 'Refrigerante lata']);
  });

  it('lança a rodada: abre a conta, cai na cozinha como pedido de mesa, sem WhatsApp e sem financeiro ainda', async () => {
    const missing = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.prato, quantity: 1 }] });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('Acompanhamento');

    const res = await waiter()
      .post(`/cardapio/salao/tables/${ids.mesa1}/orders`)
      .send({ people: 2, items: [{ productId: ids.prato, quantity: 2, optionIds: [ids.arroz], notes: 'sem cebola' }] });
    expect(res.status).toBe(201);
    expect(res.body.tab.tableName).toBe('Mesa 1');
    expect(res.body.tab.subtotalCents).toBe(10_000);
    ids.tab = res.body.tab.id;
    ids.round1 = res.body.orderId;

    const board = (await owner().get('/cardapio/orders/board')).body;
    const o = board.find((x: { id: string }) => x.id === ids.round1);
    expect(o).toMatchObject({ type: 'DINE_IN', status: 'PAID', tableName: 'Mesa 1', waiterName: 'Caio Brandão', customerName: 'Mesa 1' });

    await app.get(GestaoSyncService).processPending(tenantId);
    expect(await prisma.financialEntry.count({ where: { tenantId, source: 'cardapio' } })).toBe(0);
  });

  it('segunda rodada soma na mesma conta; a mesa aparece ocupada', async () => {
    const res = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.refri, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.tab.id).toBe(ids.tab);
    expect(res.body.tab.rounds).toHaveLength(2);
    expect(res.body.tab.subtotalCents).toBe(11_400);
    ids.round2 = res.body.orderId;

    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    const m1 = tables.find((t: { id: string }) => t.id === ids.mesa1);
    expect(m1.tab).toMatchObject({ subtotalCents: 11_400, rounds: 2, kitchenCount: 2, people: 2, waiterName: 'Caio Brandão' });
    expect(tables.find((t: { id: string }) => t.id === ids.mesa2).tab).toBeNull();
  });

  it('papel Garçom: só o salão; nada de painel da loja, cardápio ou financeiro', async () => {
    const bia = as(ids.biaToken);
    expect((await bia.get('/tenant/context')).body.role).toBe('WAITER');
    expect((await bia.get('/cardapio/salao/tables')).status).toBe(200);
    expect((await bia.get('/cardapio/salao/menu')).status).toBe(200);
    expect((await bia.get('/cardapio/salao/ready')).status).toBe(200);
    for (const url of ['/cardapio/orders/board', '/cardapio/menu', '/cardapio/store', '/gestao/entries']) {
      expect((await bia.get(url)).status).toBe(403);
    }
    expect((await bia.patch(`/cardapio/orders/${ids.round1}/status`).send({ status: 'IN_PREPARATION' })).status).toBe(403);
    expect((await bia.post('/cardapio/salao/tables').send({ name: 'Bar' })).status).toBe(403);
  });

  it('cozinha deixa pronto: aparece em "prontos para servir" e o garçom marca servido', async () => {
    expect((await waiter().post(`/cardapio/salao/orders/${ids.round1}/served`)).status).toBe(409);
    for (const status of ['IN_PREPARATION', 'READY']) {
      expect((await waiter().patch(`/cardapio/orders/${ids.round1}/status`).send({ status })).status).toBe(200);
    }
    const ready = (await as(ids.biaToken).get('/cardapio/salao/ready')).body;
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ id: ids.round1, tableName: 'Mesa 1', tableId: ids.mesa1, tabWaiterName: 'Caio Brandão' });
    expect(ready[0].tabWaiterId).toBeTruthy();
    expect(ready[0].items[0]).toMatchObject({ name: 'Parmegiana', quantity: 2, options: ['Arroz e fritas'], notes: 'sem cebola' });
    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab.readyCount).toBe(1);
    expect((await as(ids.biaToken).post(`/cardapio/salao/orders/${ids.round1}/served`)).status).toBe(201);
    expect((await waiter().get('/cardapio/salao/ready')).body).toHaveLength(0);
    const o = await prisma.order.findUnique({ where: { id: ids.round1 } });
    expect(o.status).toBe('COMPLETED');
  });

  it('outro garçom assume a mesa: os avisos de pronto passam a ser dele', async () => {
    const before = (await waiter().get(`/cardapio/salao/tables/${ids.mesa1}/tab`)).body;
    const caioId = before.waiterId;
    const res = await as(ids.biaToken).post(`/cardapio/salao/tabs/${ids.tab}/assume`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ waiterName: 'Bia Garçom' });
    expect(res.body.waiterId).not.toBe(caioId);
    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab).toMatchObject({ waiterId: res.body.waiterId, waiterName: 'Bia Garçom' });
    // A rodada continua com o nome de quem lançou; só o responsável pela mesa muda.
    expect(res.body.rounds[0].waiterName).toBe('Caio Brandão');
    expect((await waiter().post(`/cardapio/salao/tabs/${ids.tab}/assume`)).body.waiterName).toBe('Caio Brandão');
  });

  it('não dá para desativar mesa com conta aberta', async () => {
    expect((await owner().patch(`/cardapio/salao/tables/${ids.mesa1}`).send({ active: false })).status).toBe(409);
    expect((await owner().delete(`/cardapio/salao/tables/${ids.mesa1}`)).status).toBe(409);
  });

  it('conta dividida: cada pagamento dá baixa, mas a mesa só libera quitada', async () => {
    // Consumo 114,00 + 10% = 125,40.
    const pay = (body: Record<string, unknown>) => waiter().post(`/cardapio/salao/tabs/${ids.tab}/payments`).send(body);
    let res = await pay({ method: 'CARD_ON_DELIVERY', amountCents: 5_000, label: 'João' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'OPEN', totalCents: 12_540, paidCents: 5_000, remainingCents: 7_540, serviceFee: true, serviceFeeCents: 1_140 });

    // Ainda falta: não libera.
    const early = await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({});
    expect(early.status).toBe(409);
    expect(early.body.message).toContain('R$ 75,40');

    // Passar do que falta é recusado; lançou errado, estorna.
    expect((await pay({ method: 'PIX', amountCents: 9_000 })).status).toBe(400);
    const wrong = await pay({ method: 'CASH_ON_DELIVERY', amountCents: 100 });
    const wrongId = wrong.body.payments.find((x: { amountCents: number }) => x.amountCents === 100).id;
    res = await waiter().delete(`/cardapio/salao/tabs/${ids.tab}/payments/${wrongId}`);
    expect(res.body.paidCents).toBe(5_000);

    // Com pagamento feito, cliente recusa os 10%: o total cai, o que falta também.
    res = await waiter().patch(`/cardapio/salao/tabs/${ids.tab}`).send({ serviceFee: false });
    expect(res.body).toMatchObject({ totalCents: 11_400, remainingCents: 6_400 });
    res = await waiter().patch(`/cardapio/salao/tabs/${ids.tab}`).send({ serviceFee: true });
    expect(res.body.remainingCents).toBe(7_540);

    await pay({ method: 'CARD_ON_DELIVERY', amountCents: 5_000, label: 'Ana' });
    res = await pay({ method: 'PIX', amountCents: 2_540 });
    expect(res.body).toMatchObject({ paidCents: 12_540, remainingCents: 0, status: 'OPEN' });
    expect((await pay({ method: 'PIX', amountCents: 1 })).status).toBe(409);

    // Mesa ainda aparece ocupada (paga), até liberar.
    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab).toMatchObject({ paidCents: 12_540 });
  });

  it('libera a mesa quitada: cada pagamento no caixa com a sua forma, consumo em 1.1 e 10% fora da DRE', async () => {
    const res = await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CLOSED', subtotalCents: 11_400, serviceFeeCents: 1_140, totalCents: 12_540, paymentMethod: 'CARD_ON_DELIVERY' });

    // A rodada que ainda estava na cozinha é finalizada junto.
    const r2 = await prisma.order.findUnique({ where: { id: ids.round2 } });
    expect(r2.status).toBe('COMPLETED');

    await app.get(GestaoSyncService).processPending(tenantId);
    const entries = await prisma.financialEntry.findMany({ where: { tenantId, status: { not: 'CANCELLED' } }, include: { account: true } });
    const byCode = (code: string) => entries.filter((e: { account: { code: string } }) => e.account.code === code);
    // Sem venda por pedido no salão: o dinheiro entra pelos pagamentos.
    expect(entries.filter((e: { externalKey: string | null }) => e.externalKey?.startsWith('order:') && e.externalKey.endsWith(':sale'))).toHaveLength(0);

    const sales = byCode('1.1').map((e: { paymentMethod: string; amountCents: number; status: string }) => [e.paymentMethod, e.amountCents, e.status]);
    const service = byCode('11.3').map((e: { paymentMethod: string; amountCents: number }) => [e.paymentMethod, e.amountCents]);
    expect(sales.reduce((n: number, x: [string, number]) => n + x[1], 0)).toBe(11_400);
    expect(service.reduce((n: number, x: [string, number]) => n + x[1], 0)).toBe(1_140);
    // Caixa por forma de pagamento = o que entrou de fato: cartões 100,00 e Pix 25,40.
    const cash = (m: string) => [...byCode('1.1'), ...byCode('11.3')].filter((e: { paymentMethod: string }) => e.paymentMethod === m).reduce((n: number, e: { amountCents: number }) => n + e.amountCents, 0);
    expect(cash('CARD_ON_DELIVERY')).toBe(10_000);
    expect(cash('PIX')).toBe(2_540);
    expect(sales.every((x: [string, number, string]) => x[2] === 'PAID')).toBe(true);
    expect(byCode('1.1').map((e: { description: string }) => e.description)).toContain('Mesa 1 · Cartão (maquininha) 1/3 (João)');
    expect(byCode('11.4').map((e: { amountCents: number; status: string }) => [e.amountCents, e.status])).toEqual([[1_140, 'OPEN']]);

    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab).toBeNull();
    expect((await waiter().post(`/cardapio/salao/tabs/${ids.tab}/payments`).send({ method: 'PIX', amountCents: 100 })).status).toBe(409);
    expect((await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({ paymentMethod: 'PIX' })).status).toBe(409);
  });

  it('nova conta na mesma mesa; rodada cancelada não entra na conta nem no financeiro', async () => {
    const a = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.refri, quantity: 1 }] });
    expect(a.body.tab.id).not.toBe(ids.tab);
    const b = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.refri, quantity: 3 }] });
    expect((await waiter().patch(`/cardapio/orders/${b.body.orderId}/status`).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await owner().patch(`/cardapio/orders/${b.body.orderId}/status`).send({ status: 'CANCELLED' })).status).toBe(200);

    // Atalho "recebi tudo": sem pagamentos, registra o total numa forma só e libera.
    const closed = await waiter().post(`/cardapio/salao/tabs/${a.body.tab.id}/close`).send({ serviceFee: false, paymentMethod: 'PIX' });
    expect(closed.body).toMatchObject({ subtotalCents: 700, serviceFeeCents: 0, totalCents: 700, paidCents: 700, paymentMethod: 'PIX' });
    await app.get(GestaoSyncService).processPending(tenantId);
    const sale = await prisma.financialEntry.findFirst({ where: { tenantId, externalKey: { startsWith: 'tabpay:' }, amountCents: 700 }, include: { account: true } });
    expect(sale).toMatchObject({ status: 'PAID', paymentMethod: 'PIX', account: { code: '1.1' } });
    expect(await prisma.financialEntry.count({ where: { tenantId, externalKey: { startsWith: `order:${b.body.orderId}:` } } })).toBe(0);

    const today = (await owner().get('/cardapio/salao/tabs/closed')).body;
    expect(today.map((t: { totalCents: number }) => t.totalCents)).toEqual([700, 12_540]);
  });

  it('mesa com histórico sai da tela, sem apagar as contas', async () => {
    const res = await owner().delete(`/cardapio/salao/tables/${ids.mesa1}`);
    expect(res.body).toEqual({ deleted: false, archived: true });
    expect((await waiter().get('/cardapio/salao/tables')).body.tables.map((t: { name: string }) => t.name)).toEqual(['Mesa 2', 'Mesa 3']);
    expect((await owner().delete(`/cardapio/salao/tables/${ids.mesa2}`)).body).toEqual({ deleted: true, archived: false });
  });
});
