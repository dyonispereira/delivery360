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

describe('Totem de autoatendimento: pedido real, caixa e cozinha (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let ownerToken: string;
  let waiterToken: string;
  let tenantId: string;
  let slug: string;
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
    tenantId = (await admin(http().post('/admin/tenants')).send({ name: 'Lanchonete do Totem' })).body.id;
    for (const m of ['cardapio', 'gestao']) await admin(http().put(`/admin/tenants/${tenantId}/modules/${m}`)).send({ active: true });
    for (const [name, email, role] of [
      ['Dona Rosa', 'dono@totem.test', 'OWNER'],
      ['Caio Brandão Lima', 'garcom@totem.test', 'STAFF'],
    ]) {
      await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@totem.test', password: 'senha-forte-1' })).body.accessToken;
    waiterToken = (await http().post('/auth/login').send({ email: 'garcom@totem.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    ids.cat = (await owner().post('/cardapio/categories').send({ name: 'Pratos' })).body.id;
    ids.prato = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Parmegiana', priceCents: 5000 })).body.id;
    ids.refri = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Refrigerante lata', priceCents: 700 })).body.id;
    await owner().put('/gestao/settings').send({ salesTaxBps: 600, pixFeeBps: 100, cardOnDeliveryFeeBps: 250, taxDueDay: 20 });
  });

  afterAll(async () => {
    await app.close();
  });

  const sync = () => app.get(GestaoSyncService).processPending(tenantId);
  const order = (totemId: string, body: Record<string, unknown>) => http().post(`/public/stores/${slug}/totem/${totemId}/orders`).send(body);
  const base = () => ({ consumption: 'EAT_IN', payHint: 'CARD', items: [{ productId: ids.prato, quantity: 1 }, { productId: ids.refri, quantity: 2 }] });

  it('cadastro do totem: só dono/gerente; pelo menos um modo de consumo', async () => {
    expect((await waiter().post('/cardapio/pdv/totens').send({ name: 'Totem 1' })).status).toBe(403);
    expect((await owner().post('/cardapio/pdv/totens').send({ name: 'Totem 1', eatIn: false, takeaway: false })).status).toBe(400);
    const t = await owner().post('/cardapio/pdv/totens').send({ name: 'Totem da entrada' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ active: true, eatIn: true, takeaway: true });
    ids.totem = t.body.id;
    const pub = await http().get(`/public/stores/${slug}/totem/${ids.totem}`);
    expect(pub.body).toMatchObject({ name: 'Totem da entrada', active: true, modes: ['EAT_IN', 'TAKEAWAY'] });
    expect((await http().get(`/public/stores/${slug}/totem/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  it('cria o pedido aguardando pagamento, com senha; repetir a mesma chave não duplica', async () => {
    expect((await order(ids.totem, { ...base(), requestKey: 'loja-fechada-1' })).body.message).toMatch(/fechada/);
    await owner().put('/cardapio/store').send({ isOpen: true });
    const [a, b] = await Promise.all([order(ids.totem, { ...base(), requestKey: 'pedido-abc-123' }), order(ids.totem, { ...base(), requestKey: 'pedido-abc-123' })]);
    expect(a.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(a.body).toMatchObject({ totalCents: 6400, consumption: 'EAT_IN', ticket: String(99 + a.body.number) });
    expect(await prisma.order.count({ where: { tenantId, totemId: ids.totem } })).toBe(1);
    const o = await prisma.order.findFirst({ where: { tenantId, totemId: ids.totem } });
    expect(o).toMatchObject({ type: 'COUNTER', status: 'AWAITING_PAYMENT', consumption: 'EAT_IN', payHint: 'CARD' });
    ids.o1 = o.id;
    // Não pago: fora do painel, da cozinha e do financeiro.
    expect((await owner().get('/cardapio/orders/board')).body.some((x: { id: string }) => x.id === ids.o1)).toBe(false);
    await sync();
    expect(await prisma.financialEntry.count({ where: { tenantId } })).toBe(0);
    const pending = await waiter().get('/cardapio/pdv/totem/pedidos');
    expect(pending.body).toEqual([expect.objectContaining({ id: ids.o1, ticket: a.body.ticket, totemName: 'Totem da entrada', payHint: 'CARD', totalCents: 6400 })]);
  });

  it('modo de consumo desligado e totem desligado são recusados', async () => {
    await owner().patch(`/cardapio/pdv/totens/${ids.totem}`).send({ eatIn: false });
    expect((await order(ids.totem, { ...base(), requestKey: 'pedido-aqui-2' })).status).toBe(400);
    await owner().patch(`/cardapio/pdv/totens/${ids.totem}`).send({ eatIn: true, active: false });
    expect((await order(ids.totem, { ...base(), requestKey: 'pedido-off-3' })).body.message).toMatch(/desligado/);
    // A chave já usada continua devolvendo o pedido (a tela pode repetir depois de desligar).
    expect((await order(ids.totem, { ...base(), requestKey: 'pedido-abc-123' })).status).toBe(201);
    await owner().patch(`/cardapio/pdv/totens/${ids.totem}`).send({ active: true });
  });

  it('caixa recebe (crédito na maquininha comum): vai para a cozinha, cupom com origem Totem e senha, 1.9 Totem', async () => {
    expect((await waiter().post(`/cardapio/pdv/totem/pedidos/${ids.o1}/receber`).send({ payments: [{ key: 'CREDIT', amountCents: 6400 }], receipt: 'NAO_FISCAL' })).status).toBe(409);
    await waiter().post('/cardapio/pdv/caixa/abrir').send({ openingCents: 0 });
    expect((await waiter().post(`/cardapio/pdv/totem/pedidos/${ids.o1}/receber`).send({ payments: [{ key: 'CREDIT', amountCents: 6000 }], receipt: 'NAO_FISCAL' })).status).toBe(400);
    const res = await waiter().post(`/cardapio/pdv/totem/pedidos/${ids.o1}/receber`).send({ payments: [{ key: 'CREDIT', amountCents: 6400 }], receipt: 'NAO_FISCAL' });
    expect(res.status).toBe(201);
    expect(res.body.receipt).toMatchObject({ origin: 'Totem (autoatendimento)', ticketLine: expect.stringMatching(/^Senha \d{3} · Comer aqui$/), payments: [{ label: 'Crédito', amountCents: 6400 }], customer: { name: null } });
    expect((await waiter().post(`/cardapio/pdv/totem/pedidos/${ids.o1}/receber`).send({ payments: [{ key: 'CREDIT', amountCents: 6400 }], receipt: 'NAO_FISCAL' })).status).toBe(409);
    const board = (await owner().get('/cardapio/orders/board')).body.find((x: { id: string }) => x.id === ids.o1);
    expect(board).toMatchObject({ status: 'PAID', consumption: 'EAT_IN', totemId: ids.totem });
    expect((await waiter().get('/cardapio/pdv/totem/pedidos')).body).toEqual([]);
    const caixa = await waiter().get('/cardapio/pdv/caixa');
    expect(caixa.body.session.summary).toMatchObject({ salesCount: 1, salesCents: 6400 });

    await sync();
    const entries = await prisma.financialEntry.findMany({ where: { tenantId, status: { not: 'CANCELLED' }, memo: false }, include: { account: true } });
    const sale = entries.find((e: { account: { code: string } }) => e.account.code === '1.9');
    expect(entries.some((e: { account: { code: string } }) => e.account.code === '1.8')).toBe(false);
    expect(sale).toMatchObject({ amountCents: 6400, status: 'PAID', paymentMethod: 'CARD_ON_DELIVERY', description: expect.stringContaining('Totem · pedido #') });
  });

  it('cliente desistiu: descarta sem mexer no caixa; pedido pago não pode ser descartado', async () => {
    const r = await order(ids.totem, { ...base(), consumption: 'TAKEAWAY', payHint: 'PIX', requestKey: 'pedido-desiste-4' });
    const o = await prisma.order.findFirst({ where: { tenantId, number: r.body.number } });
    expect((await waiter().post(`/cardapio/pdv/totem/pedidos/${o.id}/descartar`)).status).toBe(201);
    expect((await prisma.order.findUnique({ where: { id: o.id } })).status).toBe('CANCELLED');
    expect((await waiter().post(`/cardapio/pdv/totem/pedidos/${ids.o1}/descartar`)).status).toBe(409);
  });
});
