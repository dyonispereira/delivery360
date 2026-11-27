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

describe('Fidelidade: pontos, prêmios, clube e Indique e Ganhe (e2e)', () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let ownerToken: string;
  let staffToken: string;
  let tenantId: string;
  let slug: string;
  const ids: Record<string, string> = {};
  const ANA = '11988887777';
  const BETO = '11977776666';

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
  });
  const owner = () => as(ownerToken);

  const order = (phone: string, name: string, extra: Record<string, unknown> = {}, items = [{ productId: ids.pizza, quantity: 1 }]) =>
    http()
      .post(`/public/stores/${slug}/orders`)
      .send({ type: 'PICKUP', customer: { name, phone }, items, paymentMethod: 'CASH_ON_DELIVERY', ...extra });
  const finish = async (orderId: string) => {
    for (const s of ['IN_PREPARATION', 'READY', 'COMPLETED']) {
      const r = await owner().patch(`/cardapio/orders/${orderId}/status`).send({ status: s });
      expect(r.status).toBe(200);
    }
  };
  const orderId = async (trackingCode: string) => (await prisma.order.findUniqueOrThrow({ where: { trackingCode } })).id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const admin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
    tenantId = (await admin(http().post('/admin/tenants')).send({ name: 'Pizzaria Fiel' })).body.id;
    for (const m of ['cardapio', 'gestao']) await admin(http().put(`/admin/tenants/${tenantId}/modules/${m}`)).send({ active: true });
    for (const [name, email, role] of [
      ['Dona Lia', 'dono@fiel.test', 'OWNER'],
      ['Atendente', 'staff@fiel.test', 'STAFF'],
    ]) {
      await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@fiel.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'staff@fiel.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    await owner().put('/cardapio/store').send({ isOpen: true, minOrderCents: 0, paymentMethods: ['PIX', 'CASH_ON_DELIVERY'] });
    ids.cat = (await owner().post('/cardapio/categories').send({ name: 'Pizzas' })).body.id;
    ids.pizza = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Calabresa', priceCents: 5000 })).body.id;
    ids.coca = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Coca 2L', priceCents: 1200 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('programa desligado: a loja não mostra nada e o pedido não dá pontos', async () => {
    const info = await http().get(`/public/stores/${slug}/fidelidade`);
    expect(info.body.program).toBeNull();
  });

  it('dono liga os pontos, cria prêmios e níveis; atendente só vê', async () => {
    expect((await as(staffToken).put('/cardapio/fidelidade').send({ enabled: true })).status).toBe(403);
    const save = await owner()
      .put('/cardapio/fidelidade')
      .send({ enabled: true, pointsPerReal: 1, clubEnabled: true, referralEnabled: true, referralFriendCents: 1000, referralMinOrderCents: 3000, referralReferrerPoints: 50 });
    expect(save.status).toBe(200);

    const r1 = await owner().post('/cardapio/fidelidade/premios').send({ name: 'R$ 10 de desconto', pointsCost: 80, type: 'FIXED', valueCents: 1000 });
    expect(r1.status).toBe(201);
    ids.r10 = r1.body.id;
    const r2 = await owner().post('/cardapio/fidelidade/premios').send({ name: 'Coca 2L grátis', pointsCost: 60, type: 'PRODUCT', productId: ids.coca });
    expect(r2.status).toBe(201);
    ids.rCoca = r2.body.id;
    expect((await owner().post('/cardapio/fidelidade/premios').send({ name: 'Sem valor', pointsCost: 10, type: 'FIXED' })).status).toBe(400);

    const lv = await owner().post('/cardapio/fidelidade/niveis').send({ name: 'Ouro', minPoints: 100, discountBps: 1000 });
    expect(lv.status).toBe(201);
    expect((await owner().post('/cardapio/fidelidade/niveis').send({ name: 'Vazio', minPoints: 5 })).status).toBe(400);

    const info = await http().get(`/public/stores/${slug}/fidelidade`);
    expect(info.body.program).toMatchObject({ pointsEnabled: true, pointsPerReal: 1, referral: { friendCents: 1000, referrerPoints: 50 } });
    expect(info.body.program.rewards.map((r: { name: string }) => r.name)).toEqual(['Coca 2L grátis', 'R$ 10 de desconto']);
    expect(info.body.program.levels).toEqual([{ name: 'Ouro', minPoints: 100, discountBps: 1000, freeDelivery: false }]);
  });

  it('pedido entregue dá 1 ponto por real; o cliente ganha o link de indicação', async () => {
    const res = await order(ANA, 'Ana Paula', {}, [{ productId: ids.pizza, quantity: 2 }]);
    expect(res.status).toBe(201);
    expect(res.body.loyalty).toMatchObject({ pointsEnabled: true, orderPoints: 100, orderPointsEarned: false, balance: 0 });
    expect(res.body.loyalty.referral.code).toMatch(/^ANAP[A-Z2-9]{3}$/);
    ids.anaCode = res.body.loyalty.referral.code;
    await finish(await orderId(res.body.trackingCode));

    const track = await http().get(`/public/orders/${res.body.trackingCode}`);
    expect(track.body.loyalty).toMatchObject({ orderPoints: 100, orderPointsEarned: true, balance: 100 });

    const st = await http().get(`/public/stores/${slug}/fidelidade?telefone=${ANA}`);
    expect(st.body.customer).toMatchObject({ points: 100, level: { name: 'Ouro', discountBps: 1000 }, known: true });
    expect(st.body.customer.name).toBeUndefined();
  });

  it('clube: 10% automático; com cupom vale só o cupom', async () => {
    const q = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: ids.pizza, quantity: 1 }], phone: ANA });
    expect(q.status).toBe(200);
    expect(q.body.loyalty).toMatchObject({ points: 100, clubDiscountCents: 500 });
    expect(q.body.totalCents).toBe(4500);

    await owner().post('/cardapio/coupons').send({ code: 'VOLTA5', type: 'FIXED', value: 500, maxUsesPerCustomer: 10 });
    const qc = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: ids.pizza, quantity: 1 }], phone: ANA, couponCode: 'VOLTA5' });
    expect(qc.body.loyalty).toMatchObject({ clubDiscountCents: 0, clubBlockedByCoupon: true });
    expect(qc.body.totalCents).toBe(4500);
  });

  it('troca pontos por prêmio: desconta na hora, saldo cai e o financeiro mostra o que entrou', async () => {
    const noProduct = await order(ANA, 'Ana Paula', { rewardId: ids.rCoca });
    expect(noProduct.status).toBe(400);
    expect(noProduct.body.message).toContain('Coloque o produto');

    const res = await order(ANA, 'Ana Paula', { rewardId: ids.r10 });
    expect(res.status).toBe(201);
    // 5000 − 10% clube (500) − prêmio 1000
    expect(res.body).toMatchObject({ totalCents: 3500, rewardName: 'R$ 10 de desconto', rewardDiscountCents: 1000, pointsSpent: 80, clubLevelName: 'Ouro', clubDiscountCents: 500, loyaltyDiscountCents: 1500 });
    expect(res.body.loyalty.balance).toBe(20);
    ids.redeemOrder = await orderId(res.body.trackingCode);

    const again = await order(ANA, 'Ana Paula', { rewardId: ids.r10 });
    expect(again.status).toBe(400);
    expect(again.body.message).toContain('Faltam 60 pontos');

    await app.get(GestaoSyncService).processPending(tenantId);
    const entries = await prisma.financialEntry.findMany({ where: { tenantId, externalKey: { startsWith: `order:${ids.redeemOrder}` } } });
    const by = (k: string) => entries.find((e: { externalKey: string }) => e.externalKey.endsWith(`:${k}`));
    expect(by('sale')).toMatchObject({ amountCents: 3500, memo: false });
    expect(by('gross')).toMatchObject({ amountCents: 1500, memo: true });
    expect(by('loyalty')).toMatchObject({ amountCents: 1500, memo: true, description: expect.stringContaining('prêmio R$ 10 de desconto, clube Ouro') });
  });

  it('pedido com prêmio cancelado devolve os pontos', async () => {
    expect((await owner().patch(`/cardapio/orders/${ids.redeemOrder}/status`).send({ status: 'CANCELLED' })).status).toBe(200);
    const st = await http().get(`/public/stores/${slug}/fidelidade?telefone=${ANA}`);
    expect(st.body.customer.points).toBe(100);
  });

  it('Indique e Ganhe: amigo novo ganha R$ 10 no primeiro pedido; quem indicou ganha pontos quando entrega', async () => {
    const self = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: ids.pizza, quantity: 1 }], phone: ANA, referralCode: ids.anaCode });
    expect(self.body.loyalty.referralDiscountCents).toBe(0);
    expect(self.body.loyalty.referralNote).toContain('próprio link');

    const small = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: ids.coca, quantity: 1 }], phone: BETO, referralCode: ids.anaCode.toLowerCase() });
    expect(small.body.loyalty.referralNote).toContain('R$ 30,00');

    const res = await order(BETO, 'Beto Lima', { referralCode: ids.anaCode });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ referralDiscountCents: 1000, totalCents: 4000 });
    const beto = await prisma.customer.findUniqueOrThrow({ where: { tenantId_phone: { tenantId, phone: BETO } }, include: { referredBy: true } });
    expect(beto.referredBy?.phone).toBe(ANA);

    await finish(await orderId(res.body.trackingCode));
    const ana = await http().get(`/public/stores/${slug}/fidelidade?telefone=${ANA}`);
    expect(ana.body.customer.points).toBe(150);
    const betoSt = await http().get(`/public/stores/${slug}/fidelidade?telefone=${BETO}`);
    expect(betoSt.body.customer.points).toBe(40);

    // Segundo pedido do Beto: a indicação não vale mais.
    const second = await http().post(`/public/stores/${slug}/quote`).send({ type: 'PICKUP', items: [{ productId: ids.pizza, quantity: 1 }], phone: BETO, referralCode: ids.anaCode });
    expect(second.body.loyalty.referralDiscountCents).toBe(0);
    expect(second.body.loyalty.referralNote).toContain('primeiro pedido');
  });

  it('painel: clientes por saldo, extrato, ajuste manual e resumo do mês', async () => {
    const list = await as(staffToken).get('/cardapio/fidelidade/clientes');
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ name: 'Ana Paula', points: 150, level: 'Ouro', referrals: 1 });
    expect(list.body[1]).toMatchObject({ name: 'Beto Lima', points: 40, referredBy: 'Ana Paula' });

    const anaId = list.body[0].id;
    expect((await owner().post(`/cardapio/fidelidade/clientes/${anaId}/ajuste`).send({ points: -500, note: 'teste' })).status).toBe(400);
    const adj = await owner().post(`/cardapio/fidelidade/clientes/${anaId}/ajuste`).send({ points: 25, note: 'Aniversário' });
    expect(adj.body.points).toBe(175);
    const ext = (await owner().get(`/cardapio/fidelidade/clientes/${anaId}/extrato`)).body;
    expect(ext.map((e: { kind: string }) => e.kind)).toEqual(['ADJUST', 'REFERRAL', 'REFUND', 'REDEEM', 'EARN']);

    const ov = (await owner().get('/cardapio/fidelidade')).body;
    expect(ov.month).toMatchObject({ pointsIssued: 190, pointsRedeemed: 80, redemptions: 1, referralCents: 1000, newReferred: 1 });
  });
});
