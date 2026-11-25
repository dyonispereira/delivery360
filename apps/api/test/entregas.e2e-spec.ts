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

describe('Entregas: motoboys, lotes e código de 4 dígitos (e2e)', () => {
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

  /** Cria um pedido de entrega pago na entrega e já em preparo; devolve id e código de acompanhamento. */
  async function readyOrder(phone = '(11) 98765-4321') {
    const res = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({
        type: 'DELIVERY',
        customer: { name: 'Cliente Entrega', phone },
        address: { zoneId: ids.zone, street: 'Rua B', number: '20' },
        items: [{ productId: ids.product, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
      });
    const order = await prisma.order.findUniqueOrThrow({ where: { trackingCode: res.body.trackingCode } });
    await staff().patch(`/cardapio/orders/${order.id}/status`).send({ status: 'IN_PREPARATION' });
    return { id: order.id as string, code: res.body.trackingCode as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const full = plans.find((p: { name: string }) => p.name === 'Gestão 360');
    tenantId = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Burger Express', planId: full.id })).body.id;
    for (const [email, role] of [
      ['dono@burger.test', 'OWNER'],
      ['func@burger.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@burger.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@burger.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    await owner().put('/cardapio/store').send({ isOpen: true });
    const cat = (await owner().post('/cardapio/categories').send({ name: 'Lanches' })).body.id;
    ids.product = (await owner().post('/cardapio/products').send({ categoryId: cat, name: 'X-Burger', priceCents: 3000 })).body.id;
    ids.zone = (await owner().post('/cardapio/zones').send({ name: 'Centro', feeCents: 500 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('dono cadastra motoboy; funcionário não cadastra, mas vê a lista', async () => {
    const res = await owner().post('/entregas/couriers').send({ name: 'Carlos Moto', phone: '(11) 91111-2222', feeCents: 700 });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toHaveLength(24);
    ids.courier = res.body.id;
    ids.token = res.body.accessToken;
    expect((await staff().post('/entregas/couriers').send({ name: 'X', phone: '11911112222' })).status).toBe(403);
    expect((await staff().get('/entregas/couriers')).body).toHaveLength(1);
  });

  it('monta lote com pedidos prontos: saem para entrega com o motoboy', async () => {
    const a = await readyOrder();
    const b = await readyOrder('(11) 97777-0099');
    ids.a = a.id;
    ids.aCode = a.code;
    ids.b = b.id;
    const overview = await staff().get('/entregas/overview');
    expect(overview.body.queue.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    const batch = await staff().post('/entregas/batches').send({ courierId: ids.courier, orderIds: [a.id, b.id] });
    expect(batch.status).toBe(201);
    expect(batch.body.number).toBe(1);
    ids.batch = batch.body.id;

    const track = await http().get(`/public/orders/${a.code}`);
    expect(track.body.status).toBe('OUT_FOR_DELIVERY');
    expect(track.body.courierName).toBe('Carlos');
    // o mesmo pedido não sai em dois lotes
    expect((await staff().post('/entregas/batches').send({ courierId: ids.courier, orderIds: [a.id] })).status).toBe(409);
  });

  it('tela do entregador: vê os pedidos sem o final do telefone do cliente', async () => {
    const view = await http().get(`/public/courier/${ids.token}`);
    expect(view.status).toBe(200);
    const orders = view.body.batches[0].orders;
    expect(orders).toHaveLength(2);
    expect(JSON.stringify(view.body)).not.toContain('4321');
    expect(orders[0].phoneHint).toBe('(11) 98765-••••');
    expect((await http().get('/public/courier/link-invalido')).status).toBe(404);
  });

  it('localização ao vivo: cliente vê o motoboy só enquanto o pedido está com ele', async () => {
    expect((await http().get(`/public/orders/${ids.aCode}`)).body.courierLocation).toBeNull();
    const sent = await http().post(`/public/courier/${ids.token}/location`).send({ lat: -23.5505, lng: -46.6333, accuracy: 12 });
    expect(sent.body).toEqual({ tracking: true });
    const live = (await http().get(`/public/orders/${ids.aCode}`)).body.courierLocation;
    expect(live).toMatchObject({ lat: -23.5505, lng: -46.6333 });
    expect((await http().post(`/public/courier/${ids.token}/location`).send({ lat: 200, lng: 0 })).status).toBe(400);
  });

  it('código errado conta tentativa; certo finaliza o pedido e gera custo do motoboy', async () => {
    const wrong = await http().post(`/public/courier/${ids.token}/orders/${ids.a}/deliver`).send({ code: '0000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toContain('restam 4');
    const ok = await http().post(`/public/courier/${ids.token}/orders/${ids.a}/deliver`).send({ code: '4321' });
    expect(ok.status).toBe(200);
    const done = (await http().get(`/public/orders/${ids.aCode}`)).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.courierLocation).toBeNull();
    const ev = await prisma.domainEvent.findFirst({ where: { tenantId, type: 'entrega.concluida' } });
    expect(ev.payload).toMatchObject({ orderId: ids.a, courierId: ids.courier, courierFeeCents: 700 });
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('OUT');
  });

  it('5 erros bloqueiam o código até o restaurante liberar', async () => {
    for (let i = 0; i < 5; i++) await http().post(`/public/courier/${ids.token}/orders/${ids.b}/deliver`).send({ code: '1111' });
    expect((await http().post(`/public/courier/${ids.token}/orders/${ids.b}/deliver`).send({ code: '0099' })).status).toBe(423);
    expect((await staff().post(`/entregas/orders/${ids.b}/unlock-code`)).status).toBe(403);
    expect((await owner().post(`/entregas/orders/${ids.b}/unlock-code`)).status).toBe(200);
    expect((await http().post(`/public/courier/${ids.token}/orders/${ids.b}/deliver`).send({ code: '0099' })).status).toBe(200);
    const batch = await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: ids.batch } });
    expect(batch.status).toBe('DONE');
    expect(batch.finishedAt).not.toBeNull();
    // sem entrega em andamento, a posição não é mais guardada
    expect((await http().post(`/public/courier/${ids.token}/location`).send({ lat: -23.1, lng: -46.1 })).body).toEqual({ tracking: false });
  });

  it('tirar pedido do lote volta para "pronto"; lote vazio é cancelado', async () => {
    const c = await readyOrder();
    const batch = (await staff().post('/entregas/batches').send({ courierId: ids.courier, orderIds: [c.id] })).body;
    expect((await staff().post(`/entregas/orders/${c.id}/remove-from-batch`)).status).toBe(200);
    expect((await http().get(`/public/orders/${c.code}`)).body.status).toBe('READY');
    expect((await prisma.deliveryBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('CANCELLED');
  });

  it('motoboy de outro restaurante não confirma pedido daqui; link novo derruba o antigo', async () => {
    const d = await readyOrder();
    await staff().post('/entregas/batches').send({ courierId: ids.courier, orderIds: [d.id] });
    const otherTenant = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Outro Lugar' })).body.id;
    const stranger = await prisma.courier.create({ data: { tenantId: otherTenant, name: 'Estranho', phone: '11900000000', accessToken: 'token-estranho-123456789' } });
    expect((await http().post(`/public/courier/${stranger.accessToken}/orders/${d.id}/deliver`).send({ code: '4321' })).status).toBe(404);

    const rotated = await owner().post(`/entregas/couriers/${ids.courier}/new-link`);
    expect((await http().get(`/public/courier/${ids.token}`)).status).toBe(404);
    expect((await http().get(`/public/courier/${rotated.body.accessToken}`)).status).toBe(200);
  });

  it('desligar o módulo Entregas bloqueia painel e link do motoboy', async () => {
    const token = (await prisma.courier.findUniqueOrThrow({ where: { id: ids.courier } })).accessToken;
    await http().put(`/admin/tenants/${tenantId}/modules/entregas`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    expect((await owner().get('/entregas/overview')).status).toBe(403);
    expect((await http().get(`/public/courier/${token}`)).status).toBe(404);
    await http().put(`/admin/tenants/${tenantId}/modules/entregas`).set('Authorization', `Bearer ${adminToken}`).send({ active: true });
  });
});
