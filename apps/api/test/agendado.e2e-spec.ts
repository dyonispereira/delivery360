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

describe('Pedido agendado (e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let tenantId: string;
  let slug: string;
  let pizza: string;
  const http = () => request(app.getHttpServer());
  const owner = () => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId),
  });
  const order = (extra: Record<string, unknown> = {}) =>
    http()
      .post(`/public/stores/${slug}/orders`)
      .send({ type: 'PICKUP', customer: { name: 'Clara Dias', phone: '11966665555' }, items: [{ productId: pizza, quantity: 1 }], paymentMethod: 'CASH_ON_DELIVERY', ...extra });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    const adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const admin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
    tenantId = (await admin(http().post('/admin/tenants')).send({ name: 'Pizzaria Agenda' })).body.id;
    await admin(http().put(`/admin/tenants/${tenantId}/modules/cardapio`)).send({ active: true });
    await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name: 'Dono', email: 'dono@agenda.test', password: 'senha-forte-1', role: 'OWNER' });
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@agenda.test', password: 'senha-forte-1' })).body.accessToken;
    slug = (await owner().get('/cardapio/store')).body.slug;
    await owner().put('/cardapio/store').send({ isOpen: false, minOrderCents: 0, paymentMethods: ['CASH_ON_DELIVERY'], estimatedMinutes: 40 });
    const cat = (await owner().post('/cardapio/categories').send({ name: 'Pizzas' })).body.id;
    pizza = (await owner().post('/cardapio/products').send({ categoryId: cat, name: 'Margherita', priceCents: 5000 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem agendamento, loja fechada não recebe pedido', async () => {
    const store = await http().get(`/public/stores/${slug}`);
    expect(store.body.store.schedule).toBeNull();
    const res = await order();
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('fechada');
  });

  it('dono liga o agendamento; a loja mostra os horários', async () => {
    expect((await owner().put('/cardapio/store').send({ schedulingEnabled: true, scheduleOpensAt: '25:00' })).status).toBe(400);
    const save = await owner()
      .put('/cardapio/store')
      .send({ schedulingEnabled: true, scheduleOpensAt: '00:00', scheduleClosesAt: '23:30', scheduleLeadMinutes: 60, scheduleMaxDays: 2, scheduleSlotMinutes: 30 });
    expect(save.status).toBe(200);
    const store = await http().get(`/public/stores/${slug}`);
    const days = store.body.store.schedule.days;
    expect(days.length).toBeGreaterThanOrEqual(2);
    const first = new Date(days[0].slots[0]).getTime();
    expect(first).toBeGreaterThanOrEqual(Date.now() + 59 * 60_000);
  });

  it('loja fechada: pede para escolher horário; com horário válido, o pedido entra agendado', async () => {
    const none = await order();
    expect(none.status).toBe(400);
    expect(none.body.message).toContain('Escolha um horário');

    const bad = await order({ scheduledFor: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('antecedência');

    const days = (await http().get(`/public/stores/${slug}`)).body.store.schedule.days;
    const slot = days[1].slots[2];
    const quote = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: pizza, quantity: 1 }], scheduledFor: slot });
    expect(quote.status).toBe(200);

    const res = await order({ scheduledFor: slot });
    expect(res.status).toBe(201);
    expect(res.body.scheduledFor).toBe(slot);
    expect(res.body.status).toBe('PAID');

    const board = (await owner().get('/cardapio/orders/board')).body;
    const o = board.find((x: { trackingCode: string }) => x.trackingCode === res.body.trackingCode);
    expect(o.held).toBe(true);
    expect(new Date(o.releaseAt).getTime()).toBe(new Date(slot).getTime() - 40 * 60_000);

    // O dono pode começar antes, se quiser: aí sai dos agendados.
    expect((await owner().patch(`/cardapio/orders/${o.id}/status`).send({ status: 'IN_PREPARATION' })).status).toBe(200);
    const after = (await owner().get('/cardapio/orders/board')).body.find((x: { id: string }) => x.id === o.id);
    expect(after.held).toBe(false);
  });
});
