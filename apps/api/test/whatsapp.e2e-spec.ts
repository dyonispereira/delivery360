import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.WHATSAPP_FAKE_ENABLED = 'true';
process.env.PUBLIC_API_URL = 'https://loja.delivery360.test/api';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupApp } = require('../src/setup-app');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaService } = require('../src/prisma/prisma.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WhatsappService } = require('../src/whatsapp/whatsapp.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FakeWhatsapp } = require('../src/whatsapp/whatsapp.provider');

describe('WhatsApp da loja: QR Code e status do pedido para o cliente (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let wa: InstanceType<typeof WhatsappService>;
  let ownerToken: string;
  let staffToken: string;
  let slug: string;
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
  const sent = () => FakeWhatsapp.sent as { instance: string; number: string; text: string }[];

  const newOrder = async (phone: string, type: 'DELIVERY' | 'PICKUP' = 'DELIVERY') => {
    const res = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({
        type,
        customer: { name: 'Joana Silva', phone },
        address: type === 'DELIVERY' ? { zoneId: ids.zone, street: 'Rua A', number: '10' } : undefined,
        items: [{ productId: ids.product, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
      });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    const id = (await prisma.order.findUniqueOrThrow({ where: { trackingCode: res.body.trackingCode } })).id;
    return { id, code: res.body.trackingCode as string, number: res.body.number as number };
  };
  const move = (id: string, status: string) => as(staffToken).patch(`/cardapio/orders/${id}/status`).send({ status });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    wa = app.get(WhatsappService);

    const adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const essencial = plans.find((p: { name: string }) => p.name === 'Essencial');
    tenantId = (
      await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Pizzaria Zap', planId: essencial.id })
    ).body.id;
    for (const [email, role] of [
      ['dono@zap.test', 'OWNER'],
      ['func@zap.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@zap.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@zap.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    const cat = (await owner().post('/cardapio/categories').send({ name: 'Pizzas' })).body.id;
    ids.product = (await owner().post('/cardapio/products').send({ categoryId: cat, name: 'Calabresa', priceCents: 4500 })).body.id;
    ids.zone = (await owner().post('/cardapio/zones').send({ name: 'Centro', feeCents: 500 })).body.id;
    await owner().put('/cardapio/store').send({ isOpen: true, paymentMethods: ['CASH_ON_DELIVERY'], estimatedMinutes: 40 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem WhatsApp conectado nada é enviado; funcionário não conecta nem desconecta', async () => {
    const before = await newOrder('(11) 91111-0000');
    expect(await wa.processPending()).toBe(0);
    expect((await owner().get('/cardapio/whatsapp')).body).toMatchObject({ available: true, connected: false, status: null });
    expect((await as(staffToken).post('/cardapio/whatsapp/connect')).status).toBe(403);
    ids.before = before.id;
  });

  it('dono conecta pelo QR Code; o que aconteceu antes não vira mensagem atrasada', async () => {
    const qr = await owner().post('/cardapio/whatsapp/connect');
    if (qr.status !== 200) throw new Error(JSON.stringify(qr.body));
    expect(qr.status).toBe(200);
    expect(qr.body).toMatchObject({ connected: false, status: 'PENDING', pairingCode: 'TEST-1234' });
    expect(qr.body.qr).toMatch(/^data:image\/png;base64,/);

    // O painel consulta enquanto mostra o QR; o dono lê com o celular e conecta.
    const ok = await owner().get('/cardapio/whatsapp');
    expect(ok.body).toMatchObject({ connected: true, status: 'CONNECTED', phone: '5511999990000', notifyEnabled: true });

    expect(await wa.processPending()).toBe(0);
    expect(sent()).toHaveLength(0);

    expect((await owner().post('/cardapio/whatsapp/test')).body).toEqual({ sent: true });
    expect(sent().pop()).toMatchObject({ number: '5511999990000', text: expect.stringContaining('estão funcionando') });
  });

  it('entrega: aprovado, em preparo, aguardando entregador, saiu, entregue com link da avaliação — uma vez cada, em ordem', async () => {
    const o = await newOrder('(21) 98888-7777');
    for (const s of ['IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED']) expect((await move(o.id, s)).status).toBe(200);
    expect(await wa.processPending()).toBe(5);
    expect(await wa.processPending()).toBe(0); // não manda de novo

    const msgs = sent().filter((m) => m.number === '5521988887777');
    expect(msgs.map((m) => m.text.split('\n')[0])).toEqual([
      `✅ *Pedido #${o.number} aprovado!*`,
      `👨‍🍳 *Pedido #${o.number} em preparo*`,
      `📦 *Pedido #${o.number} pronto!*`,
      `🛵 *Pedido #${o.number} saiu para entrega!*`,
      `🎉 *Pedido #${o.number} entregue!*`,
    ]);
    expect(msgs[0].text).toContain('Oi, Joana!');
    expect(msgs[0].text).toContain('cerca de 40 minutos');
    expect(msgs[2].text).toContain('aguardando o entregador');
    expect(msgs[4].text).toContain(`https://loja.delivery360.test/pedido/${o.code}`);
    expect(msgs[4].text).toContain('Conta pra gente como foi');
  });

  it('retirada: avisa que está pronto para retirar no balcão', async () => {
    const o = await newOrder('(11) 97777-1111', 'PICKUP');
    await move(o.id, 'IN_PREPARATION');
    await move(o.id, 'READY');
    await wa.processPending();
    expect(sent().filter((m) => m.number === '5511977771111').at(-1)!.text).toContain('pronto para retirada');
  });

  it('WhatsApp caiu: o aviso volta para a fila e sai quando reconecta, sem perder a ordem', async () => {
    const o = await newOrder('(11) 96666-2222');
    FakeWhatsapp.failSend = true;
    await move(o.id, 'IN_PREPARATION');
    expect(await wa.processPending()).toBe(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, notifiedAt: null } })).toBe(2);
    FakeWhatsapp.failSend = false;
    expect(await wa.processPending()).toBe(2);
    expect(sent().filter((m) => m.number === '5511966662222').map((m) => m.text.split('\n')[0])).toEqual([
      `✅ *Pedido #${o.number} aprovado!*`,
      `👨‍🍳 *Pedido #${o.number} em preparo*`,
    ]);
  });

  it('dono desliga os avisos ou desconecta: para de enviar', async () => {
    expect((await owner().put('/cardapio/whatsapp').send({ notifyEnabled: false })).body).toMatchObject({ notifyEnabled: false });
    await newOrder('(11) 95555-3333');
    expect(await wa.processPending()).toBe(0);
    await owner().put('/cardapio/whatsapp').send({ notifyEnabled: true });

    expect((await as(staffToken).delete('/cardapio/whatsapp')).status).toBe(403);
    expect((await owner().delete('/cardapio/whatsapp')).body).toMatchObject({ connected: false, status: null });
    await newOrder('(11) 94444-4444');
    expect(await wa.processPending()).toBe(0);
  });
});
