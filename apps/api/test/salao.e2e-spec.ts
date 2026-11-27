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
    ]) {
      await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@salao.test', password: 'senha-forte-1' })).body.accessToken;
    waiterToken = (await http().post('/auth/login').send({ email: 'garcom@salao.test', password: 'senha-forte-1' })).body.accessToken;

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
    expect(m1.tab).toMatchObject({ subtotalCents: 11_400, rounds: 2, kitchenCount: 2, people: 2 });
    expect(tables.find((t: { id: string }) => t.id === ids.mesa2).tab).toBeNull();
  });

  it('cozinha deixa pronto e o garçom marca servido', async () => {
    expect((await waiter().post(`/cardapio/salao/orders/${ids.round1}/served`)).status).toBe(409);
    for (const status of ['IN_PREPARATION', 'READY']) {
      expect((await waiter().patch(`/cardapio/orders/${ids.round1}/status`).send({ status })).status).toBe(200);
    }
    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab.readyCount).toBe(1);
    expect((await waiter().post(`/cardapio/salao/orders/${ids.round1}/served`)).status).toBe(201);
    const o = await prisma.order.findUnique({ where: { id: ids.round1 } });
    expect(o.status).toBe('COMPLETED');
  });

  it('não dá para desativar mesa com conta aberta', async () => {
    expect((await owner().patch(`/cardapio/salao/tables/${ids.mesa1}`).send({ active: false })).status).toBe(409);
    expect((await owner().delete(`/cardapio/salao/tables/${ids.mesa1}`)).status).toBe(409);
  });

  it('fecha a conta com 10%: venda no Salão (1.1) já paga, taxa de serviço fora da DRE, mesa livre', async () => {
    expect((await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({ serviceFee: true })).status).toBe(400);
    const res = await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({ serviceFee: true, paymentMethod: 'CARD_ON_DELIVERY' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CLOSED', subtotalCents: 11_400, serviceFeeCents: 1_140, totalCents: 12_540, paymentMethod: 'CARD_ON_DELIVERY' });

    // A rodada que ainda estava na cozinha é finalizada junto.
    const r2 = await prisma.order.findUnique({ where: { id: ids.round2 } });
    expect(r2).toMatchObject({ status: 'COMPLETED', paymentMethod: 'CARD_ON_DELIVERY' });

    await app.get(GestaoSyncService).processPending(tenantId);
    const entries = await prisma.financialEntry.findMany({ where: { tenantId }, include: { account: true } });
    const sales = entries.filter((e: { externalKey: string | null }) => e.externalKey?.endsWith(':sale'));
    expect(sales).toHaveLength(2);
    for (const s of sales) expect(s).toMatchObject({ status: 'PAID', paymentMethod: 'CARD_ON_DELIVERY' });
    expect(sales.map((s: { account: { code: string } }) => s.account.code)).toEqual(['1.1', '1.1']);
    expect(sales.reduce((n: number, s: { amountCents: number }) => n + s.amountCents, 0)).toBe(11_400);
    expect(sales.map((s: { description: string }) => s.description).every((d: string) => d.startsWith('Mesa 1 · pedido #'))).toBe(true);

    const service = entries.filter((e: { externalKey: string | null }) => e.externalKey?.startsWith(`tab:${ids.tab}:`));
    expect(service.map((e: { account: { code: string }; status: string; amountCents: number }) => [e.account.code, e.status, e.amountCents]).sort()).toEqual([
      ['11.3', 'PAID', 1_140],
      ['11.4', 'OPEN', 1_140],
    ]);

    const { tables } = (await waiter().get('/cardapio/salao/tables')).body;
    expect(tables.find((t: { id: string }) => t.id === ids.mesa1).tab).toBeNull();
    expect((await waiter().post(`/cardapio/salao/tabs/${ids.tab}/close`).send({ serviceFee: false, paymentMethod: 'PIX' })).status).toBe(409);
  });

  it('nova conta na mesma mesa; rodada cancelada não entra na conta nem no financeiro', async () => {
    const a = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.refri, quantity: 1 }] });
    expect(a.body.tab.id).not.toBe(ids.tab);
    const b = await waiter().post(`/cardapio/salao/tables/${ids.mesa1}/orders`).send({ items: [{ productId: ids.refri, quantity: 3 }] });
    expect((await waiter().patch(`/cardapio/orders/${b.body.orderId}/status`).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await owner().patch(`/cardapio/orders/${b.body.orderId}/status`).send({ status: 'CANCELLED' })).status).toBe(200);

    const closed = await waiter().post(`/cardapio/salao/tabs/${a.body.tab.id}/close`).send({ serviceFee: false, paymentMethod: 'PIX' });
    expect(closed.body).toMatchObject({ subtotalCents: 700, serviceFeeCents: 0, totalCents: 700 });
    await app.get(GestaoSyncService).processPending(tenantId);
    const sale = await prisma.financialEntry.findUnique({ where: { tenantId_externalKey: { tenantId, externalKey: `order:${a.body.orderId}:sale` } } });
    expect(sale).toMatchObject({ status: 'PAID', amountCents: 700 });
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
