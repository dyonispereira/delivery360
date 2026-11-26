import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import crypto from 'node:crypto';

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
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
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

  it('cupons: cadastro, prévia no carrinho, pedido com desconto, limite por cliente e DRE', async () => {
    expect((await as(staffToken).post('/cardapio/coupons').send({ code: 'X10', type: 'PERCENT', value: 1000 })).status).toBe(403);
    expect((await owner().post('/cardapio/coupons').send({ code: 'TUDO', type: 'PERCENT', value: 20_000 })).status).toBe(400);
    const created = await owner()
      .post('/cardapio/coupons')
      .send({ code: 'bemvindo10', type: 'PERCENT', value: 1000, maxDiscountCents: 1000, public: true, description: 'Para a primeira pizza' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'BEMVINDO10', maxUsesPerCustomer: 1 });
    expect((await owner().post('/cardapio/coupons').send({ code: 'BEMVINDO10', type: 'FIXED', value: 500 })).status).toBe(409);
    const frete = await owner().post('/cardapio/coupons').send({ code: 'FRETE', type: 'FREE_DELIVERY', value: 0, minOrderCents: 5000 });
    expect(frete.status).toBe(201);

    const menu = (await http().get(`/public/stores/${slug}`)).body;
    expect(menu.coupons).toEqual([expect.objectContaining({ code: 'BEMVINDO10', label: '10% off até R$ 10,00' })]);

    // 2 pizzas com catupiry e bacon = 116,00; 10% seria 11,60, mas o teto é 10,00. Entrega 6,00.
    const quote = await http().post(`/public/stores/${slug}/quote`).send({ ...orderBody(), zoneId: ids.centro, couponCode: ' bemvindo10 ', customer: undefined, address: undefined });
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({ subtotalCents: 11600, deliveryFeeCents: 600, discountCents: 1000, totalCents: 11200, coupon: { code: 'BEMVINDO10' } });
    expect((await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', items: orderBody().items, couponCode: 'NAOEXISTE' })).status).toBe(400);

    // Entrega grátis antes de escolher o bairro: ainda sem taxa; depois, desconta a taxa.
    const noZone = (await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', items: orderBody().items, couponCode: 'FRETE' })).body;
    expect(noZone).toMatchObject({ zonePending: true, deliveryFeeCents: 0, discountCents: 0 });
    const withZone = (await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: orderBody().items, couponCode: 'FRETE' })).body;
    expect(withZone).toMatchObject({ deliveryFeeCents: 600, discountCents: 600, totalCents: 11600 });

    const phone = '(11) 91111-2222';
    const order = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'BEMVINDO10', customer: { name: 'Ana', phone } }));
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ discountCents: 1000, couponCode: 'BEMVINDO10', totalCents: 11200 });

    const again = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'BEMVINDO10', customer: { name: 'Ana', phone } }));
    expect(again.status).toBe(400);
    expect(again.body.message).toContain('já usou');

    const row = await prisma.order.findUniqueOrThrow({ where: { trackingCode: order.body.trackingCode } });
    await app.get(GestaoSyncService).processPending(tenantId);
    const entries: { externalKey: string; amountCents: number; account: { code: string } }[] = await prisma.financialEntry.findMany({
      where: { tenantId, externalKey: { startsWith: `order:${row.id}:` } },
      include: { account: true },
    });
    const by = (k: string) => entries.find((e) => e.externalKey === `order:${row.id}:${k}`);
    expect(by('sale')).toMatchObject({ amountCents: 12200 });
    expect(by('coupon')).toMatchObject({ amountCents: 1000, account: { code: '2.4' } });

    const list = (await owner().get('/cardapio/coupons')).body;
    expect(list.find((c: { code: string }) => c.code === 'BEMVINDO10')).toMatchObject({ uses: 1, discountGivenCents: 1000, salesCents: 11200 });

    // Cupom de produto: desconto só sobre a pizza; sem ela no carrinho, explica.
    const refri = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Refri lata', priceCents: 600 })).body.id;
    expect((await owner().post('/cardapio/coupons').send({ code: 'PIZZA20', type: 'PERCENT', value: 2000, productIds: [crypto.randomUUID()] })).status).toBe(400);
    const pz = await owner().post('/cardapio/coupons').send({ code: 'PIZZA20', type: 'PERCENT', value: 2000, productIds: [ids.pizza], public: true });
    expect(pz.status).toBe(201);
    expect((await http().get(`/public/stores/${slug}`)).body.coupons.find((c: { code: string }) => c.code === 'PIZZA20').label).toBe('20% off em Calabresa');
    const mix = [
      { productId: ids.pizza, quantity: 1, optionIds: [ids.tradicional] },
      { productId: refri, quantity: 2 },
    ];
    const pq = (await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: mix, couponCode: 'PIZZA20' })).body;
    expect(pq).toMatchObject({ subtotalCents: 5700, discountCents: 900 });
    const onlyRefri = await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: [{ productId: refri, quantity: 5 }], couponCode: 'PIZZA20' });
    expect(onlyRefri.body.message).toBe('Este cupom vale só para Calabresa. Coloque no carrinho para usar.');
    await owner().delete(`/cardapio/products/${refri}`);

    // Impulso Delivery360 (criado pela equipe no cadastro do restaurante): sem código, entra sozinho,
    // soma com o cupom do restaurante, e o restaurante não mexe nem paga.
    const staff = as(adminToken);
    const d360 = await staff.post('/cardapio/coupons').send({ type: 'FIXED', value: 800, productIds: [ids.pizza], maxUsesPerCustomer: null });
    expect(d360.status).toBe(201);
    expect(d360.body).toMatchObject({ fundedBy: 'PLATFORM', public: false });
    expect(d360.body.code).toMatch(/^IMPULSO-/);
    expect((await owner().post('/cardapio/coupons').send({ type: 'FIXED', value: 800 })).status).toBe(400);
    expect((await owner().patch(`/cardapio/coupons/${d360.body.id}`).send({ active: false })).status).toBe(403);
    expect((await owner().delete(`/cardapio/coupons/${d360.body.id}`)).status).toBe(403);

    const offers = (await http().get(`/public/stores/${slug}`)).body;
    expect(offers.offers).toEqual([expect.objectContaining({ label: 'R$ 8,00 off em Calabresa', productIds: [ids.pizza] })]);
    expect(offers.coupons.map((c: { code: string }) => c.code)).not.toContain(d360.body.code);
    const auto = (await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: orderBody().items })).body;
    expect(auto).toMatchObject({ discountCents: 0, platformDiscountCents: 800, totalCents: 11600 + 600 - 800 });
    expect((await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', items: orderBody().items, couponCode: d360.body.code })).status).toBe(400);

    // Cupom do restaurante (10% até R$ 10) + impulso (R$ 8) no mesmo pedido.
    const boosted = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', couponCode: 'BEMVINDO10', customer: { name: 'Bia', phone: '(11) 93333-4444' } }));
    expect(boosted.status).toBe(201);
    expect(boosted.body).toMatchObject({ discountCents: 1000, platformDiscountCents: 800, totalCents: 11600 + 600 - 1000 - 800 });
    const bRow = await prisma.order.findUniqueOrThrow({ where: { trackingCode: boosted.body.trackingCode } });
    await app.get(GestaoSyncService).processPending(tenantId);
    const bEntries: { externalKey: string; amountCents: number; type: string; status: string; counterparty: string | null; account: { code: string } }[] =
      await prisma.financialEntry.findMany({ where: { tenantId, externalKey: { startsWith: `order:${bRow.id}:` } }, include: { account: true } });
    const bBy = (k: string) => bEntries.find((e) => e.externalKey === `order:${bRow.id}:${k}`);
    expect(bBy('sale')).toMatchObject({ amountCents: bRow.totalCents + 1000 });
    expect(bBy('coupon')).toMatchObject({ amountCents: 1000, account: { code: '2.4' } });
    expect(bBy('coupon360')).toMatchObject({ type: 'RECEIVABLE', amountCents: 800, status: 'OPEN', counterparty: 'Delivery360', account: { code: '1.2' } });
    const boostRow = (await owner().get('/cardapio/coupons')).body.find((c: { id: string }) => c.id === d360.body.id);
    expect(boostRow).toMatchObject({ uses: 1, discountGivenCents: 800 });
    expect((await staff.delete(`/cardapio/coupons/${d360.body.id}`)).body).toEqual({ deleted: false, deactivated: true });

    // Cupom já usado não é apagado, só desativado; o que nunca foi usado some.
    expect((await owner().delete(`/cardapio/coupons/${created.body.id}`)).body).toEqual({ deleted: false, deactivated: true });
    expect((await owner().delete(`/cardapio/coupons/${frete.body.id}`)).body).toEqual({ deleted: true, deactivated: false });
    const off = await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: orderBody().items, couponCode: 'BEMVINDO10' });
    expect(off.body.message).toContain('não está mais valendo');
  });

  it('campanhas da rede: banner da Delivery360 em todas as lojas, cupom com custo dividido e saída só do que custa', async () => {
    const staff = as(adminToken);
    const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
    const code = `REDE${suffix}`;
    const img = 'https://cdn.delivery360.test/banner.png';
    expect((await owner().post('/admin/campaigns').send({ title: 'X', imageUrl: img })).status).toBe(403);

    const network = await staff.post('/admin/campaigns').send({ title: 'Peça pela Delivery360', subtitle: 'Seu delivery favorito', imageUrl: img });
    expect(network.status).toBe(201);
    expect(network.body).toMatchObject({ couponCode: null, tenantIds: [], platformShareBps: 10000 });
    // Código igual ao cupom próprio da loja participante é recusado.
    expect((await staff.post('/admin/campaigns').send({ title: 'Choque', imageUrl: img, tenantIds: [tenantId], couponCode: 'PIZZA20', value: 1000 })).status).toBe(409);
    const store = await staff.post('/admin/campaigns').send({
      title: 'Semana da pizza',
      imageUrl: img,
      tenantIds: [tenantId],
      couponCode: code.toLowerCase(),
      type: 'PERCENT',
      value: 2000,
      maxDiscountCents: 3000,
      platformShareBps: 5000,
    });
    expect(store.status).toBe(201);
    expect(store.body).toMatchObject({ couponCode: code, platformShareBps: 5000 });
    // O restaurante não cria cupom com o código da campanha.
    expect((await owner().post('/cardapio/coupons').send({ code, type: 'FIXED', value: 500 })).status).toBe(409);

    const banners = (await http().get(`/public/stores/${slug}`)).body.banners.filter((b: { id: string }) => [network.body.id, store.body.id].includes(b.id));
    expect(banners).toEqual([
      expect.objectContaining({ id: network.body.id, network: true, couponCode: null }),
      expect.objectContaining({ id: store.body.id, network: false, couponCode: code, label: '20% off até R$ 30,00' }),
    ]);

    // 2 pizzas = 116,00; 20% = 23,20 (metade da Delivery360, metade do restaurante).
    const q = (await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', zoneId: ids.centro, items: orderBody().items, couponCode: code })).body;
    expect(q).toMatchObject({ discountCents: 2320, platformDiscountCents: 0, totalCents: 11600 + 600 - 2320, coupon: { code } });
    const order = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', couponCode: code, customer: { name: 'Caio', phone: '(11) 95555-6666' } }));
    expect(order.status).toBe(201);
    const row = await prisma.order.findUniqueOrThrow({ where: { trackingCode: order.body.trackingCode } });
    expect(row).toMatchObject({ campaignId: store.body.id, couponId: null, couponFundedBy: 'MIXED', discountCents: 2320, couponPlatformCents: 1160 });

    await app.get(GestaoSyncService).processPending(tenantId);
    const entries: { externalKey: string; amountCents: number; counterparty: string | null; account: { code: string } }[] = await prisma.financialEntry.findMany({
      where: { tenantId, externalKey: { startsWith: `order:${row.id}:` } },
      include: { account: true },
    });
    const by = (k: string) => entries.find((e) => e.externalKey === `order:${row.id}:${k}`);
    expect(by('sale')).toMatchObject({ amountCents: row.totalCents + 1160 });
    expect(by('coupon')).toMatchObject({ amountCents: 1160, account: { code: '2.4' } });
    expect(by('coupon360')).toMatchObject({ amountCents: 1160, counterparty: 'Delivery360', account: { code: '1.2' } });

    // Painel do restaurante: vê as campanhas; só pode sair da que custa para ele.
    const mine = (await owner().get('/cardapio/campaigns')).body;
    expect(mine.find((c: { id: string }) => c.id === network.body.id)).toMatchObject({ participating: true, canOptOut: false });
    expect(mine.find((c: { id: string }) => c.id === store.body.id)).toMatchObject({ participating: true, canOptOut: true, platformShareBps: 5000 });
    expect((await owner().put(`/cardapio/campaigns/${network.body.id}/participation`).send({ participating: false })).status).toBe(403);
    expect((await as(staffToken).put(`/cardapio/campaigns/${store.body.id}/participation`).send({ participating: false })).status).toBe(403);
    expect((await owner().put(`/cardapio/campaigns/${store.body.id}/participation`).send({ participating: false })).body).toEqual({ participating: false });
    const after = (await http().get(`/public/stores/${slug}`)).body.banners.map((b: { id: string }) => b.id);
    expect(after).toContain(network.body.id);
    expect(after).not.toContain(store.body.id);
    expect((await http().post(`/public/stores/${slug}/quote`).send({ type: 'DELIVERY', items: orderBody().items, couponCode: code })).status).toBe(400);
    expect((await owner().put(`/cardapio/campaigns/${store.body.id}/participation`).send({ participating: true })).status).toBe(200);

    const list = (await staff.get('/admin/campaigns')).body;
    expect(list.campaigns.find((c: { id: string }) => c.id === store.body.id)).toMatchObject({ uses: 1, discountGivenCents: 2320, platformCostCents: 1160 });
    expect(list.tenants).toEqual(expect.arrayContaining([expect.objectContaining({ id: tenantId })]));

    expect((await staff.delete(`/admin/campaigns/${store.body.id}`)).body).toEqual({ deleted: false, deactivated: true });
    expect((await staff.delete(`/admin/campaigns/${network.body.id}`)).body).toEqual({ deleted: true, deactivated: false });
    await prisma.campaign.deleteMany({ where: { id: store.body.id } });
  });

  it('combos: cria com produtos do cardápio e item só do combo, loja mostra a economia, pedido e CMV', async () => {
    const combosCat = (await owner().post('/cardapio/categories').send({ name: 'Combos' })).body.id;
    const coca = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Coca 2L', priceCents: 1400, costItems: [{ name: 'Coca', kind: 'INGREDIENT', costCents: 700 }] })).body.id;
    const guarana = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Guaraná 2L', priceCents: 1200 })).body.id;
    await owner().patch(`/cardapio/products/${ids.pizza}`).send({ costItems: [{ name: 'Massa e recheio', kind: 'INGREDIENT', costCents: 1500 }] });

    expect((await as(staffToken).post('/cardapio/combos').send({ categoryId: combosCat, name: 'X', priceCents: 100, steps: [] })).status).toBe(403);
    const bad = await owner().post('/cardapio/combos').send({ categoryId: combosCat, name: 'X', priceCents: 100, steps: [{ name: 'Pizza', minSelect: 2, maxSelect: 2, options: [{ productId: ids.pizza }] }] });
    expect(bad.status).toBe(400);

    const created = await owner()
      .post('/cardapio/combos')
      .send({
        categoryId: combosCat,
        name: 'Combo Família',
        priceCents: 5200,
        steps: [
          { name: 'Escolha a pizza', minSelect: 1, maxSelect: 1, options: [{ productId: ids.pizza }] },
          { name: 'Bebida', minSelect: 1, maxSelect: 1, options: [{ productId: coca }, { productId: guarana }] },
          { name: 'Sobremesa', minSelect: 1, maxSelect: 1, options: [{ name: 'Brownie da casa', costCents: 300 }] },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ isCombo: true, name: 'Combo Família' });
    const [pizzaStep, drinkStep, dessertStep] = created.body.optionGroups;
    expect(drinkStep.options.map((o: { name: string }) => o.name)).toEqual(['Coca 2L', 'Guaraná 2L']);

    // Combo dentro de combo é recusado.
    const nested = await owner().post('/cardapio/combos').send({ categoryId: combosCat, name: 'Y', priceCents: 100, steps: [{ name: 'Combo', minSelect: 1, maxSelect: 1, options: [{ productId: created.body.id }] }] });
    expect(nested.status).toBe(400);

    // Loja: separado sairia pizza 45,00 + guaraná 12,00 (o mais barato) = 57,00 > 52,00.
    let menu = (await http().get(`/public/stores/${slug}`)).body;
    const combo = menu.categories.flatMap((c: { products: unknown[] }) => c.products).find((p: { id: string }) => p.id === created.body.id);
    expect(combo).toMatchObject({ isCombo: true, priceCents: 5200, comboSeparateCents: 5700 });
    expect(combo.costItems).toBeUndefined();
    expect(combo.optionGroups[1].options[0]).toMatchObject({ productId: coca, available: true });
    // Peça também: com ficha técnica e sem escolha obrigatória, a Coca vem antes do Guaraná (sem ficha).
    expect(menu.upsellProductIds.indexOf(coca)).toBeLessThan(menu.upsellProductIds.indexOf(guarana));
    expect(menu.upsellProductIds).not.toContain(created.body.id);

    // Produto esgotado some do combo (fica indisponível na etapa).
    await owner().patch(`/cardapio/products/${coca}/available`).send({ available: false });
    menu = (await http().get(`/public/stores/${slug}`)).body;
    const again = menu.categories.flatMap((c: { products: unknown[] }) => c.products).find((p: { id: string }) => p.id === created.body.id);
    expect(again.optionGroups[1].options[0]).toMatchObject({ available: false });
    const sold = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', items: [{ productId: created.body.id, quantity: 1, optionIds: [pizzaStep.options[0].id, drinkStep.options[0].id, dessertStep.options[0].id] }] }));
    expect(sold.status).toBe(400);
    await owner().patch(`/cardapio/products/${coca}/available`).send({ available: true });

    const order = await http()
      .post(`/public/stores/${slug}/orders`)
      .send(orderBody({ paymentMethod: 'CASH_ON_DELIVERY', items: [{ productId: created.body.id, quantity: 2, optionIds: [pizzaStep.options[0].id, drinkStep.options[0].id, dessertStep.options[0].id] }] }));
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ subtotalCents: 10400 });
    expect(order.body.items[0].options.map((o: { name: string }) => o.name)).toEqual([pizzaStep.options[0].name, 'Coca 2L', 'Brownie da casa']);
    const row = await prisma.order.findUniqueOrThrow({ where: { trackingCode: order.body.trackingCode }, include: { items: true } });
    // CMV teórico: pizza 15,00 + coca 7,00 + brownie 3,00.
    expect(row.items[0].unitCostCents).toBe(2500);

    // Edição mantém os ids das opções que ficaram e tira o guaraná.
    const edited = await owner()
      .put(`/cardapio/combos/${created.body.id}`)
      .send({
        categoryId: combosCat,
        name: 'Combo Família',
        priceCents: 4990,
        steps: [
          { id: pizzaStep.id, name: 'Escolha a pizza', minSelect: 1, maxSelect: 1, options: [{ id: pizzaStep.options[0].id, productId: ids.pizza }] },
          { id: drinkStep.id, name: 'Bebida', minSelect: 1, maxSelect: 1, options: [{ id: drinkStep.options[0].id, productId: coca }] },
        ],
      });
    expect(edited.status).toBe(200);
    expect(edited.body.priceCents).toBe(4990);
    expect(edited.body.optionGroups).toHaveLength(2);
    expect(edited.body.optionGroups[1].options).toEqual([expect.objectContaining({ id: drinkStep.options[0].id, linkedProductId: coca })]);

    await owner().delete(`/cardapio/products/${created.body.id}`);
    await owner().delete(`/cardapio/products/${coca}`);
    await owner().delete(`/cardapio/products/${guarana}`);
    await owner().patch(`/cardapio/products/${ids.pizza}`).send({ costItems: [] });
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
