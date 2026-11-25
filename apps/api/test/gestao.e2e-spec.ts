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

describe('Gestão: financeiro, lançamentos automáticos e DRE (e2e)', () => {
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
    tenantId = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Cantina Gestão', planId: full.id })).body.id;
    for (const [email, role] of [
      ['dono@cantina.test', 'OWNER'],
      ['func@cantina.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@cantina.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@cantina.test', password: 'senha-forte-1' })).body.accessToken;

    slug = (await owner().get('/cardapio/store')).body.slug;
    await owner().put('/cardapio/store').send({ isOpen: true });
    const cat = (await owner().post('/cardapio/categories').send({ name: 'Lanches' })).body.id;
    ids.product = (await owner().post('/cardapio/products').send({ categoryId: cat, name: 'X-Burger', priceCents: 3000 })).body.id;
    ids.zone = (await owner().post('/cardapio/zones').send({ name: 'Centro', feeCents: 500 })).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const month = today.slice(0, 7);
  const acc = async (code: string) => {
    const groups = (await owner().get('/gestao/accounts')).body;
    return groups.flatMap((g: { accounts: { id: string; code: string }[] }) => g.accounts).find((a: { code: string }) => a.code === code).id as string;
  };

  it('plano de contas de restaurante vem pronto; equipe não vê o financeiro', async () => {
    const groups = (await owner().get('/gestao/accounts')).body;
    expect(groups).toHaveLength(11);
    expect(groups[5]).toMatchObject({ group: 6, name: 'Despesas de entrega' });
    expect(groups[5].accounts.map((a: { code: string }) => a.code)).toEqual(['6.1', '6.2', '6.3']);
    expect((await staff().get('/gestao/accounts')).status).toBe(403);
    expect((await staff().get('/gestao/dre?from=2026-01-01&to=2026-01-31')).status).toBe(403);
  });

  it('conta nova ganha o próximo código do grupo; conta padrão não é desativada', async () => {
    const res = await owner().post('/gestao/accounts').send({ group: 3, name: 'Carnes' });
    expect(res.body).toMatchObject({ code: '3.5', kind: 'EXPENSE', system: false });
    const rent = await acc('5.1');
    expect((await owner().patch(`/gestao/accounts/${rent}`).send({ active: false })).status).toBe(400);
    expect((await owner().patch(`/gestao/accounts/${rent}`).send({ name: 'Aluguel da loja' })).body.name).toBe('Aluguel da loja');
  });

  it('pedidos, motoboy e gorjeta viram lançamentos sozinhos', async () => {
    // pedido pago na entrega, entregue pelo motoboy (R$ 7 por entrega), com gorjeta de R$ 5
    const order = await readyOrder();
    const courier = (await owner().post('/entregas/couriers').send({ name: 'Paulo Moto', phone: '11922223333', feeCents: 700 })).body;
    await staff().post('/entregas/batches').send({ courierId: courier.id, orderIds: [order.id] });
    // antes de entregar: a receber em aberto
    let rec = (await owner().get('/gestao/entries?type=RECEIVABLE')).body;
    expect(rec.items).toEqual([expect.objectContaining({ description: 'Pedido #1', amountCents: 3500, status: 'OPEN', source: 'cardapio' })]);
    expect(rec.items[0].account.code).toBe('1.2');

    await http().post(`/public/courier/${courier.accessToken}/orders/${order.id}/deliver`).send({ code: '4321', receiverName: 'Cliente' });
    await http().post(`/public/orders/${order.code}/tip`).send({ amountCents: 500 });
    await http().post(`/public/orders/${order.code}/tip/simulate-payment`);

    rec = (await owner().get('/gestao/entries?type=RECEIVABLE')).body;
    expect(rec.items.find((e: { account: { code: string } }) => e.account.code === '1.2')).toMatchObject({ status: 'PAID', paidAt: today });
    expect(rec.items.find((e: { account: { code: string } }) => e.account.code === '11.1')).toMatchObject({ amountCents: 500, status: 'PAID' });
    const pay = (await owner().get('/gestao/entries?type=PAYABLE')).body;
    expect(pay.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Entrega do pedido #1', counterparty: 'Paulo Moto', amountCents: 700, status: 'OPEN' }),
        expect.objectContaining({ description: 'Repassar gorjeta do pedido #1', amountCents: 500, status: 'OPEN' }),
      ]),
    );
    // processar de novo não duplica
    await prisma.domainEvent.updateMany({ where: { tenantId }, data: { processedAt: null } });
    expect((await owner().get('/gestao/entries')).body.items).toHaveLength(4);

    // repasse da gorjeta dá baixa no 11.2
    await owner().post(`/entregas/couriers/${courier.id}/tips/pay-out`);
    const tipOut = (await owner().get('/gestao/entries?type=PAYABLE')).body.items.find((e: { account: { code: string } }) => e.account.code === '11.2');
    expect(tipOut.status).toBe('PAID');
  });

  it('pedido cancelado: em aberto é cancelado; PIX já pago vira devolução a pagar', async () => {
    const open = await readyOrder();
    await owner().patch(`/cardapio/orders/${open.id}/status`).send({ status: 'CANCELLED', note: 'teste' });
    const pixRes = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({ type: 'PICKUP', customer: { name: 'Pix Pago', phone: '11955554444' }, items: [{ productId: ids.product, quantity: 1 }], paymentMethod: 'PIX' });
    await http().post(`/public/orders/${pixRes.body.trackingCode}/simulate-payment`);
    const pixOrder = await prisma.order.findUniqueOrThrow({ where: { trackingCode: pixRes.body.trackingCode } });
    await owner().patch(`/cardapio/orders/${pixOrder.id}/status`).send({ status: 'CANCELLED', note: 'acabou o queijo' });

    const all = (await owner().get('/gestao/entries?status=CANCELLED')).body.items;
    expect(all).toEqual([expect.objectContaining({ description: `Pedido #${(await prisma.order.findUniqueOrThrow({ where: { id: open.id } })).number}`, status: 'CANCELLED' })]);
    const refund = (await owner().get('/gestao/entries?type=PAYABLE&search=Devolução')).body.items;
    expect(refund).toEqual([expect.objectContaining({ amountCents: 3000, status: 'OPEN' })]);
    expect(refund[0].account.code).toBe('2.5');
  });

  it('conta a pagar manual com repetição mensal, baixa e reabertura', async () => {
    const rent = await acc('5.1');
    const res = await owner().post('/gestao/entries').send({
      type: 'PAYABLE',
      accountId: rent,
      description: 'Aluguel',
      counterparty: 'Imobiliária',
      amountCents: 300_000,
      competenceDate: `${month}-01`,
      dueDate: `${month}-31`.replace(/-(02|04|06|09|11)-31$/, '-$1-28'),
      repeatMonths: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    expect(res.body[1].description).toBe('Aluguel (2/3)');
    expect(res.body[1].competenceDate.slice(8)).toBe('01');
    const first = res.body[0].id;
    expect((await owner().post(`/gestao/entries/${first}/pay`).send({ paidAt: today })).body).toEqual({ count: 1 });
    expect((await owner().post(`/gestao/entries/${first}/pay`).send({})).status).toBe(409);
    expect((await owner().post(`/gestao/entries/${first}/reopen`)).status).toBe(200);
    expect((await owner().post('/gestao/entries/pay-many').send({ ids: [first] })).body).toEqual({ count: 1 });
    // automático não muda valor
    const auto = (await owner().get('/gestao/entries?search=Entrega do pedido')).body.items[0];
    expect((await owner().patch(`/gestao/entries/${auto.id}`).send({ amountCents: 1 })).status).toBe(400);
    expect((await owner().patch(`/gestao/entries/${auto.id}`).send({ notes: 'pago no pix' })).status).toBe(200);
    // validação em português
    const bad = await owner().post('/gestao/entries').send({ type: 'PAYABLE', accountId: rent, description: 'X', amountCents: 0, competenceDate: '01/11/2026', dueDate: today });
    expect(bad.status).toBe(400);
    expect(bad.body.message.join(' ')).toContain('Data inválida');
  });

  it('DRE do mês: receita, deduções, despesas e lucro; gorjeta e cancelado fora', async () => {
    const res = await owner().get(`/gestao/dre?from=${month}-01&to=${today}`);
    expect(res.status).toBe(200);
    const v = (k: string) => res.body.lines.find((l: { key: string }) => l.key === k).valueCents;
    // receita: pedido entregue 3500 + PIX 3000 (cancelado depois, mas recebido) ; dedução: devolução 3000
    expect(v('g1')).toBe(6500);
    expect(v('g2')).toBe(-3000);
    expect(v('net')).toBe(3500);
    expect(v('g5')).toBe(-300_000);
    expect(v('g6')).toBe(-700);
    expect(v('netProfit')).toBe(3500 - 300_000 - 700);
    expect(res.body.lines.some((l: { key: string }) => l.key === 'g11')).toBe(false);
    expect(res.body.orders.count).toBe(1);
    expect((await owner().get('/gestao/dre?from=2026-12-01&to=2026-11-01')).status).toBe(400);
  });

  it('resumo: contas vencidas, de hoje e dos próximos 7 dias, e o caixa do mês', async () => {
    const s = (await owner().get('/gestao/summary')).body;
    expect(s.today).toBe(today);
    expect(s.payable.today.cents).toBeGreaterThanOrEqual(700 + 3000);
    expect(s.month.cashInCents).toBe(3500 + 500 + 3000);
    expect(s.month.grossCents).toBe(6500);
  });

  it('ficha técnica: custo item por item no produto e nos adicionais; equipe não vê custos', async () => {
    const res = await owner().patch(`/cardapio/products/${ids.product}`).send({
      costItems: [
        { name: 'Pão', kind: 'INGREDIENT', costCents: 300 },
        { name: 'Hambúrguer', kind: 'INGREDIENT', costCents: 500 },
        { name: 'Fatia de queijo', kind: 'INGREDIENT', costCents: 100 },
        { name: 'Embalagem', kind: 'PACKAGING', costCents: 30 },
      ],
      extraCostBps: 200,
    });
    expect(res.status).toBe(200);
    expect(res.body.costItems).toHaveLength(4);
    const group = (await owner().post(`/cardapio/products/${ids.product}/groups`).send({ name: 'Adicionais', minSelect: 0, maxSelect: 2 })).body;
    ids.bacon = (await owner().post(`/cardapio/groups/${group.id}/options`).send({ name: 'Bacon', priceCents: 500, costCents: 150 })).body.id;
    const bad = await owner().patch(`/cardapio/products/${ids.product}`).send({ costItems: [{ name: '', kind: 'INGREDIENT', costCents: 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message.join(' ')).toContain('nome a cada item');

    const staffMenu = JSON.stringify((await staff().get('/cardapio/menu')).body);
    expect(staffMenu).not.toContain('costItems');
    expect(staffMenu).not.toContain('Hambúrguer');
    expect((await staff().get('/cardapio/cost-rates')).status).toBe(403);
    // loja pública nunca mostra custo
    expect(JSON.stringify((await http().get(`/public/stores/${slug}`)).body)).not.toContain('costCents');
  });

  it('impostos e taxas: venda gera imposto e taxa; PIX entra já recebido; custo fica gravado na venda', async () => {
    await owner().put('/gestao/settings').send({ salesTaxBps: 600, pixFeeBps: 100, cardOnDeliveryFeeBps: 250, taxDueDay: 20 });
    expect((await owner().get('/cardapio/cost-rates')).body).toMatchObject({ salesTaxBps: 600, configured: true });
    const pix = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({ type: 'PICKUP', customer: { name: 'Cliente Pix', phone: '11944443333' }, items: [{ productId: ids.product, quantity: 2, optionIds: [ids.bacon] }], paymentMethod: 'PIX' });
    expect(pix.status).toBe(201);
    await http().post(`/public/orders/${pix.body.trackingCode}/simulate-payment`);
    const order = await prisma.order.findUniqueOrThrow({ where: { trackingCode: pix.body.trackingCode }, include: { items: true } });
    expect(order.items[0].unitCostCents).toBe(930 + 150);

    const entries = (await owner().get(`/gestao/entries?search=pedido #${order.number}`)).body.items;
    const by = (code: string) => entries.find((e: { account: { code: string } }) => e.account.code === code);
    const sale = (await owner().get(`/gestao/entries?type=RECEIVABLE&search=Cliente Pix`)).body.items[0];
    expect(sale).toMatchObject({ amountCents: 7000, status: 'PAID', paymentMethod: 'PIX' });
    expect(by('2.3')).toMatchObject({ amountCents: 70, status: 'PAID', paymentMethod: 'PIX' });
    expect(by('2.1')).toMatchObject({ amountCents: 420, status: 'OPEN' });
    expect(by('2.1').dueDate.slice(8)).toBe('20');

    // retirada concluída entra na margem por produto
    await owner().patch(`/cardapio/orders/${order.id}/status`).send({ status: 'IN_PREPARATION' });
    await owner().patch(`/cardapio/orders/${order.id}/status`).send({ status: 'READY' });
    await owner().patch(`/cardapio/orders/${order.id}/status`).send({ status: 'COMPLETED' });
    const m = (await owner().get(`/gestao/products-margin?from=${month}-01&to=${today}`)).body;
    const burger = m.rows.find((r: { name: string }) => r.name === 'X-Burger');
    // pedido antigo (sem ficha, custo 0) + este (2 un. a R$ 10,80 de custo)
    expect(burger.quantity).toBe(3);
    expect(burger.cmvCents).toBe(2160);
    expect(m.missingCost).toEqual(['X-Burger']);
    const dre = (await owner().get(`/gestao/dre?from=${month}-01&to=${today}`)).body;
    expect(dre.cmv).toMatchObject({ theoreticalCents: 2160, missingCostItems: 1 });
  });

  it('venda cancelada não paga imposto', async () => {
    const o = await http()
      .post(`/public/stores/${slug}/orders`)
      .send({ type: 'PICKUP', customer: { name: 'Desistiu', phone: '11933332222' }, items: [{ productId: ids.product, quantity: 1 }], paymentMethod: 'CARD_ON_DELIVERY' });
    const order = await prisma.order.findUniqueOrThrow({ where: { trackingCode: o.body.trackingCode } });
    await owner().get('/gestao/summary');
    await owner().patch(`/cardapio/orders/${order.id}/status`).send({ status: 'CANCELLED' });
    const all = (await owner().get(`/gestao/entries?status=CANCELLED&search=pedido #${order.number}`)).body.items;
    const mine = all.filter((e: { description: string }) => new RegExp(`#${order.number}( |$)`).test(e.description));
    // venda, imposto e taxa da maquininha: tudo cancelado
    expect(mine.map((e: { account: { code: string } }) => e.account.code).sort()).toEqual(['1.2', '2.1', '2.3']);
  });

  it('sem o módulo Gestão contratado, as rotas ficam bloqueadas', async () => {
    await http().put(`/admin/tenants/${tenantId}/modules/gestao`).set('Authorization', `Bearer ${adminToken}`).send({ active: false });
    expect((await owner().get('/gestao/summary')).status).toBe(403);
    await http().put(`/admin/tenants/${tenantId}/modules/gestao`).set('Authorization', `Bearer ${adminToken}`).send({ active: true });
    expect((await owner().get('/gestao/summary')).status).toBe(200);
  });
});
