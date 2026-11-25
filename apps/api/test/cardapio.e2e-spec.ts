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

describe('Cardápio, loja online e pedidos (e2e)', () => {
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

  const orderBody = (over: Record<string, unknown> = {}) => ({
    type: 'DELIVERY',
    customer: { name: 'Maria Cliente', phone: '(11) 98765-4321' },
    address: { zoneId: ids.centro, street: 'Rua das Flores', number: '100' },
    items: [{ productId: ids.pizza, quantity: 2, optionIds: [ids.catupiry, ids.bacon] }],
    paymentMethod: 'PIX',
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const essencial = plans.find((p: { name: string }) => p.name === 'Essencial');
    tenantId = (
      await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Pizzaria Bella Napoli', planId: essencial.id })
    ).body.id;
    for (const [email, role] of [
      ['dono@bella.test', 'OWNER'],
      ['func@bella.test', 'STAFF'],
    ]) {
      await http()
        .post(`/admin/tenants/${tenantId}/users`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@bella.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@bella.test', password: 'senha-forte-1' })).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('cria a loja com endereço a partir do nome, fechada', async () => {
    const res = await owner().get('/cardapio/store');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('pizzaria-bella-napoli');
    expect(res.body.isOpen).toBe(false);
    slug = res.body.slug;
  });

  it('monta o cardápio: categoria, produto, grupos e adicionais, bairro', async () => {
    ids.cat = (await owner().post('/cardapio/categories').send({ name: 'Pizzas' })).body.id;
    const pizza = await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Calabresa', priceCents: 4500 });
    expect(pizza.status).toBe(201);
    ids.pizza = pizza.body.id;

    ids.borda = (await owner().post(`/cardapio/products/${ids.pizza}/groups`).send({ name: 'Borda', minSelect: 1, maxSelect: 1 })).body.id;
    ids.tradicional = (await owner().post(`/cardapio/groups/${ids.borda}/options`).send({ name: 'Tradicional', priceCents: 0 })).body.id;
    ids.catupiry = (await owner().post(`/cardapio/groups/${ids.borda}/options`).send({ name: 'Catupiry', priceCents: 800 })).body.id;
    ids.extras = (await owner().post(`/cardapio/products/${ids.pizza}/groups`).send({ name: 'Extras', minSelect: 0, maxSelect: 3 })).body.id;
    ids.bacon = (await owner().post(`/cardapio/groups/${ids.extras}/options`).send({ name: 'Bacon', priceCents: 500 })).body.id;

    ids.centro = (await owner().post('/cardapio/zones').send({ name: 'Centro', feeCents: 600 })).body.id;

    const menu = await owner().get('/cardapio/menu');
    expect(menu.body[0].products[0].optionGroups.map((g: { name: string }) => g.name)).toEqual(['Borda', 'Extras']);
  });

  it('grupo com mínimo maior que o máximo é recusado', async () => {
    const res = await owner().post(`/cardapio/products/${ids.pizza}/groups`).send({ name: 'X', minSelect: 3, maxSelect: 1 });
    expect(res.status).toBe(400);
  });

  it('funcionário não altera o cardápio, mas pode marcar esgotado', async () => {
    expect((await as(staffToken).patch(`/cardapio/products/${ids.pizza}`).send({ priceCents: 1 })).status).toBe(403);
    expect((await as(staffToken).patch(`/cardapio/products/${ids.pizza}/available`).send({ available: false })).status).toBe(200);
    await owner().patch(`/cardapio/products/${ids.pizza}/available`).send({ available: true });
  });

  it('outro restaurante não enxerga nem altera este cardápio', async () => {
    const other = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Outro Restaurante' })).body.id;
    await http().put(`/admin/tenants/${other}/modules/cardapio`).set('Authorization', `Bearer ${adminToken}`).send({ active: true });
    const res = await http()
      .patch(`/cardapio/products/${ids.pizza}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', other)
      .send({ priceCents: 1 });
    expect(res.status).toBe(404);
  });

  it('loja fechada mostra o cardápio, mas não aceita pedido', async () => {
    const menu = await http().get(`/public/stores/${slug}`);
    expect(menu.status).toBe(200);
    expect(menu.body.store.isOpen).toBe(false);
    expect(menu.body.categories[0].products[0].name).toBe('Calabresa');
    const res = await http().post(`/public/stores/${slug}/orders`).send(orderBody());
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('fechada');
  });

  it('pedido PIX: preço calculado no servidor, aguarda pagamento', async () => {
    await owner().put('/cardapio/store').send({ isOpen: true, minOrderCents: 3000, paymentMethods: ['PIX', 'CASH_ON_DELIVERY'] });
    const res = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({ ...orderBody(), totalCents: 1, priceCents: 1 }); // campos extras do cliente são recusados
    expect(res.status).toBe(400);

    const ok = await http().post(`/public/stores/${slug}/orders`).send(orderBody());
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('AWAITING_PAYMENT');
    expect(ok.body.subtotalCents).toBe((4500 + 800 + 500) * 2);
    expect(ok.body.deliveryFeeCents).toBe(600);
    expect(ok.body.totalCents).toBe(11600 + 600);
    expect(ok.body.number).toBe(1);
    expect(ok.body.payment.pixCopyPaste).toContain('BR.GOV.BCB.PIX');
    expect(ok.body.payment.canSimulate).toBe(true);
    ids.code = ok.body.trackingCode;
  });

  it('pedido aguardando pagamento não aparece para o restaurante', async () => {
    const list = await owner().get('/cardapio/orders');
    expect(list.body).toEqual([]);
  });

  it('pagamento confirmado: pedido vai para Pago e gera evento para a Gestão', async () => {
    const res = await http().post(`/public/orders/${ids.code}/simulate-payment`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAID');
    expect(res.body.payment.pixCopyPaste).toBeNull();
    expect(res.body.history.map((h: { status: string }) => h.status)).toEqual(['AWAITING_PAYMENT', 'PAID']);

    const again = await http().post(`/public/orders/${ids.code}/simulate-payment`);
    expect(again.status).toBe(404); // nada pendente: não paga duas vezes

    const events = await prisma.domainEvent.findMany({ where: { tenantId, type: 'pedido.recebido' } });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ totalCents: 12200, paymentMethod: 'PIX' });

    const list = await owner().get('/cardapio/orders');
    expect(list.body.map((o: { number: number }) => o.number)).toEqual([1]);
  });

  it('pagamento na entrega entra direto como recebido; retirada sem taxa', async () => {
    const res = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ type: 'PICKUP', address: undefined, paymentMethod: 'CASH_ON_DELIVERY', changeForCents: 20000, items: [{ productId: ids.pizza, quantity: 1, optionIds: [ids.tradicional] }] }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PAID');
    expect(res.body.deliveryFeeCents).toBe(0);
    expect(res.body.number).toBe(2);
    expect(res.body.payment.canSimulate).toBe(false);
  });

  it('valida adicionais, pedido mínimo, forma de pagamento e telefone', async () => {
    const post = (b: Record<string, unknown>) => http().post(`/public/stores/${slug}/orders`).send(orderBody(b));
    expect((await post({ items: [{ productId: ids.pizza, quantity: 1 }] })).body.message).toContain('Borda');
    await owner().put('/cardapio/store').send({ minOrderCents: 50000 });
    expect((await post({})).body.message).toContain('pedido mínimo é de R$ 500,00');
    await owner().put('/cardapio/store').send({ minOrderCents: 3000 });
    expect((await post({ paymentMethod: 'CARD_ON_DELIVERY' })).body.message).toContain('Forma de pagamento');
    expect((await post({ customer: { name: 'X Y', phone: '1234' } })).body.message).toContain('telefone');
  });

  it('PIX vencido cancela o pedido', async () => {
    const res = await http().post(`/public/stores/${slug}/orders`).send(orderBody());
    await prisma.payment.updateMany({ where: { order: { trackingCode: res.body.trackingCode } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const track = await http().get(`/public/orders/${res.body.trackingCode}`);
    expect(track.body.status).toBe('CANCELLED');
    expect(track.body.payment.status).toBe('EXPIRED');
    expect((await http().post(`/public/orders/${res.body.trackingCode}/simulate-payment`)).status).toBe(404);
  });

  it('código de acompanhamento errado não revela nada', async () => {
    expect((await http().get('/public/orders/naoexiste123')).status).toBe(404);
  });

  it('painel: pedido segue o fluxo de status e o cliente acompanha', async () => {
    const created = await http().post(`/public/stores/${slug}/orders`).send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY' }));
    const code = created.body.trackingCode;
    const board = await as(staffToken).get('/cardapio/orders/board');
    expect(board.status).toBe(200);
    const order = board.body.find((o: { trackingCode: string }) => o.trackingCode === code);
    expect(order.status).toBe('PAID');
    expect(order.items[0].options.length).toBe(2);
    expect(board.body.some((o: { status: string }) => o.status === 'AWAITING_PAYMENT')).toBe(false);

    const move = (to: string, who = staffToken) => as(who).patch(`/cardapio/orders/${order.id}/status`).send({ status: to });
    expect((await move('COMPLETED')).status).toBe(409);
    expect((await move('IN_PREPARATION')).status).toBe(200);
    expect((await move('OUT_FOR_DELIVERY')).status).toBe(200);
    expect((await http().get(`/public/orders/${code}`)).body.status).toBe('OUT_FOR_DELIVERY');
    expect((await move('COMPLETED')).status).toBe(200);
    expect((await move('IN_PREPARATION')).status).toBe(409);

    const history = (await http().get(`/public/orders/${code}`)).body.history.map((h: { status: string }) => h.status);
    expect(history).toEqual(['PAID', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'COMPLETED']);
    const events = await prisma.domainEvent.findMany({ where: { tenantId, type: 'pedido.status' } });
    expect(events.length).toBe(3);
  });

  it('loja nova: capa, mais pedidos, nota média e dados para pedir de novo', async () => {
    expect((await owner().put('/cardapio/store').send({ coverUrl: 'https://img.exemplo.com/capa.jpg' })).status).toBe(200);
    const menu = (await http().get(`/public/stores/${slug}`)).body;
    expect(menu.store.coverUrl).toBe('https://img.exemplo.com/capa.jpg');
    // Pedidos feitos acima: a pizza é o item mais pedido; menos de 3 avaliações não mostram nota.
    expect(menu.topProductIds[0]).toBe(ids.pizza);
    expect(menu.store.rating).toBeNull();

    const created = await http().post(`/public/stores/${slug}/orders`).send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY' }));
    const track = (await http().get(`/public/orders/${created.body.trackingCode}`)).body;
    expect(track.items[0].productId).toBe(ids.pizza);
    expect(track.items[0].options.map((o: { optionId: string }) => o.optionId).sort()).toEqual([ids.catupiry, ids.bacon].sort());
  });

  it('preço de/por: loja mostra o riscado, pedido cobra a promoção e o DRE separa o desconto', async () => {
    const bad = await owner().patch(`/cardapio/products/${ids.pizza}`).send({ promoPriceCents: 4500 });
    expect(bad.status).toBe(400);
    const ends = new Date(Date.now() + 86_400_000).toISOString();
    expect((await owner().patch(`/cardapio/products/${ids.pizza}`).send({ promoPriceCents: 3990, promoEndsAt: ends })).status).toBe(200);

    const menu = (await http().get(`/public/stores/${slug}`)).body;
    const pizza = menu.categories[0].products.find((p: { id: string }) => p.id === ids.pizza);
    expect(pizza).toMatchObject({ priceCents: 3990, listPriceCents: 4500 });
    expect(pizza.promoPriceCents).toBeUndefined();

    // 2 pizzas com catupiry e bacon: (39,90 + 8 + 5) × 2 = 105,80; economia (45,00 − 39,90) × 2 = 10,20.
    const created = await http().post(`/public/stores/${slug}/orders`).send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY' }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ subtotalCents: 10580, promoDiscountCents: 1020 });
    const order = await prisma.order.findUniqueOrThrow({ where: { trackingCode: created.body.trackingCode }, include: { items: true } });
    expect(order.items[0]).toMatchObject({ unitPriceCents: 5290, listUnitPriceCents: 5800 });

    await app.get(GestaoSyncService).processPending(tenantId);
    const entries: { externalKey: string; amountCents: number; status: string; account: { code: string } }[] = await prisma.financialEntry.findMany({ where: { tenantId, externalKey: { startsWith: `order:${order.id}:` } }, include: { account: true } });
    const by = (k: string) => entries.find((e: { externalKey: string }) => e.externalKey === `order:${order.id}:${k}`);
    expect(by('sale')).toMatchObject({ amountCents: order.totalCents + 1020 });
    expect(by('promo')).toMatchObject({ amountCents: 1020, status: 'OPEN' });
    expect(by('promo')!.account.code).toBe('2.4');

    // Promoção vencida: volta o preço normal.
    await owner().patch(`/cardapio/products/${ids.pizza}`).send({ promoEndsAt: new Date(Date.now() - 1000).toISOString(), promoStartsAt: new Date(Date.now() - 86_400_000).toISOString() });
    const again = (await http().get(`/public/stores/${slug}`)).body.categories[0].products.find((p: { id: string }) => p.id === ids.pizza);
    expect(again).toMatchObject({ priceCents: 4500, listPriceCents: null });
    expect((await owner().patch(`/cardapio/products/${ids.pizza}`).send({ promoPriceCents: null, promoStartsAt: null, promoEndsAt: null })).status).toBe(200);
  });

  it('cancelar: só dono ou gerente; pedido de outro restaurante dá 404', async () => {
    const created = await http().post(`/public/stores/${slug}/orders`).send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY' }));
    const id = (await prisma.order.findUniqueOrThrow({ where: { trackingCode: created.body.trackingCode } })).id;
    expect((await as(staffToken).patch(`/cardapio/orders/${id}/status`).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await owner().patch(`/cardapio/orders/${id}/status`).send({ status: 'CANCELLED', note: 'Cliente desistiu' })).status).toBe(200);
    expect((await http().get(`/public/orders/${created.body.trackingCode}`)).body.status).toBe('CANCELLED');

    const other = await prisma.tenant.create({ data: { name: 'Outro' } });
    const foreign = await http()
      .patch(`/cardapio/orders/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', other.id)
      .send({ status: 'IN_PREPARATION' });
    expect([403, 404]).toContain(foreign.status);
  });

  it('impressão: só a primeira tela imprime automaticamente', async () => {
    const created = await http().post(`/public/stores/${slug}/orders`).send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY' }));
    const id = (await prisma.order.findUniqueOrThrow({ where: { trackingCode: created.body.trackingCode } })).id;
    expect((await as(staffToken).post(`/cardapio/orders/${id}/printed`)).body).toEqual({ first: true });
    expect((await owner().post(`/cardapio/orders/${id}/printed`)).body).toEqual({ first: false });
  });

  it('desligar o módulo Cardápio tira a loja do ar', async () => {
    await http().put(`/admin/tenants/${tenantId}/modules/cardapio`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    expect((await http().get(`/public/stores/${slug}`)).status).toBe(404);
    expect((await owner().get('/cardapio/menu')).status).toBe(403);
    await http().put(`/admin/tenants/${tenantId}/modules/cardapio`).set('Authorization', `Bearer ${adminToken}`).send({ active: true });
    expect((await http().get(`/public/stores/${slug}`)).status).toBe(200);
  });
});
