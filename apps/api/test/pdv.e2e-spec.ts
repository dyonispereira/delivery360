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

describe('PDV: caixa, venda de balcão, cupom e NFC-e (e2e)', () => {
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
    tenantId = (await admin(http().post('/admin/tenants')).send({ name: 'Lanchonete do Balcão' })).body.id;
    for (const m of ['cardapio', 'gestao']) await admin(http().put(`/admin/tenants/${tenantId}/modules/${m}`)).send({ active: true });
    for (const [name, email, role] of [
      ['Dona Rosa', 'dono@pdv.test', 'OWNER'],
      ['Caio Brandão Lima', 'garcom@pdv.test', 'STAFF'],
    ]) {
      await admin(http().post(`/admin/tenants/${tenantId}/users`)).send({ name, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@pdv.test', password: 'senha-forte-1' })).body.accessToken;
    waiterToken = (await http().post('/auth/login').send({ email: 'garcom@pdv.test', password: 'senha-forte-1' })).body.accessToken;

    await owner().get('/cardapio/store');
    ids.cat = (await owner().post('/cardapio/categories').send({ name: 'Pratos' })).body.id;
    ids.prato = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Parmegiana', priceCents: 5000 })).body.id;
    ids.refri = (await owner().post('/cardapio/products').send({ categoryId: ids.cat, name: 'Refrigerante lata', priceCents: 700 })).body.id;
    await owner().put('/gestao/settings').send({ salesTaxBps: 600, pixFeeBps: 100, cardOnDeliveryFeeBps: 250, taxDueDay: 20 });
  });

  afterAll(async () => {
    await app.close();
  });

  const sync = () => app.get(GestaoSyncService).processPending(tenantId);

  it('sem caixa aberto não vende; abre com fundo de troco (um caixa por vez)', async () => {
    expect((await owner().get('/cardapio/pdv/caixa')).body.session).toBeNull();
    const sale = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'PIX', amountCents: 700 }], kitchen: false, receipt: 'NAO_FISCAL' });
    expect(sale.status).toBe(409);
    expect(sale.body.message).toMatch(/Abra o caixa/);
    const open = await waiter().post('/cardapio/pdv/caixa/abrir').send({ openingCents: 10000 });
    expect(open.status).toBe(201);
    expect(open.body).toMatchObject({ status: 'OPEN', openedByName: 'Caio Brandão', summary: { expectedCashCents: 10000 } });
    expect((await owner().post('/cardapio/pdv/caixa/abrir').send({ openingCents: 0 })).status).toBe(409);
  });

  it('venda com dinheiro e troco, desconto e cupom não fiscal; vai para a cozinha', async () => {
    const res = await waiter().post('/cardapio/pdv/vendas').send({
      items: [{ productId: ids.prato, quantity: 1, optionIds: [] }, { productId: ids.refri, quantity: 2 }],
      payments: [{ key: 'CASH', amountCents: 6000, receivedCents: 10000 }],
      discountCents: 400,
      customerName: 'Joana',
      kitchen: true,
      receipt: 'NAO_FISCAL',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalCents: 6000, changeCents: 4000, fiscalError: null });
    expect(res.body.receipt).toMatchObject({ kind: 'NAO_FISCAL', origin: 'PDV (balcão)', totalCents: 6000, discountCents: 400, changeCents: 4000, payments: [{ label: 'Dinheiro', amountCents: 10000 }], customer: { name: 'Joana' } });
    ids.sale1 = res.body.orderId;
    const order = await prisma.order.findUnique({ where: { id: ids.sale1 } });
    expect(order).toMatchObject({ type: 'COUNTER', status: 'PAID', paymentMethod: 'CASH_ON_DELIVERY' });
    const kitchen = await owner().get('/cardapio/orders/board');
    expect(kitchen.body.some((o: { id: string }) => o.id === ids.sale1)).toBe(true);
  });

  it('confere os pagamentos: falta, sobra e CPF inválido', async () => {
    const short = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'PIX', amountCents: 500 }], kitchen: false, receipt: 'NAO_FISCAL' });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/Falta receber R\$ 2,00/);
    const over = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'CREDIT', amountCents: 900 }], kitchen: false, receipt: 'NAO_FISCAL' });
    expect(over.status).toBe(400);
    const cpf = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'PIX', amountCents: 700 }], document: '111.111.111-11', kitchen: false, receipt: 'NAO_FISCAL' });
    expect(cpf.status).toBe(400);
  });

  it('NFC-e: só com os dados fiscais completos; produção fica bloqueada no emissor simulado', async () => {
    const no = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'PIX', amountCents: 700 }], kitchen: false, receipt: 'NFCE' });
    expect(no.status).toBe(400);
    expect(no.body.message).toMatch(/Dados fiscais/);
    expect((await waiter().put('/cardapio/pdv/fiscal').send({ enabled: true })).status).toBe(403);
    expect((await owner().put('/cardapio/pdv/fiscal').send({ environment: 'PRODUCAO' })).status).toBe(400);
    const half = await owner().put('/cardapio/pdv/fiscal').send({ enabled: true, cnpj: '11222333000181' });
    expect(half.body.missing).toEqual(['inscrição estadual', 'UF']);
    const ok = await owner().put('/cardapio/pdv/fiscal').send({ stateRegistration: '123456789012', uf: 'SP', legalName: 'Lanchonete do Balcão LTDA', cscId: '000001', cscToken: 'ABCDEF1234567890XYZ', pdvReceipt: 'NFCE' });
    expect(ok.body).toMatchObject({ missing: [], hasCscToken: true, pdvReceipt: 'NFCE' });
    expect(ok.body.cscTokenEncrypted).toBeUndefined();
    expect((await waiter().get('/cardapio/pdv/caixa')).body.nfce).toEqual({ available: true, defaultReceipt: 'NFCE', environment: 'HOMOLOGACAO' });
  });

  it('venda dividida (Pix + débito) com NFC-e e CPF: nota autorizada, chave, QR Code e PDF', async () => {
    const res = await waiter().post('/cardapio/pdv/vendas').send({
      items: [{ productId: ids.refri, quantity: 2 }],
      payments: [{ key: 'PIX', amountCents: 400 }, { key: 'DEBIT', amountCents: 1000 }],
      document: '529.982.247-25',
      kitchen: false,
      receipt: 'NFCE',
    });
    expect(res.status).toBe(201);
    expect(res.body.fiscalError).toBeNull();
    const r = res.body.receipt;
    expect(r).toMatchObject({ kind: 'NFCE', test: true, customer: { document: '52998224725' }, payments: [{ label: 'Pix', amountCents: 400 }, { label: 'Débito', amountCents: 1000 }] });
    expect(r.fiscal).toMatchObject({ status: 'AUTHORIZED', series: 1, number: 1 });
    expect(r.fiscal.accessKey).toMatch(/^35\d{4}11222333000181650010000000011\d{9}$/);
    expect(r.fiscal.qrCodeUrl).toContain(`?p=${r.fiscal.accessKey}|2|2|1|`);
    ids.sale2 = res.body.orderId;
    expect(await prisma.order.findUnique({ where: { id: ids.sale2 }, select: { status: true } })).toEqual({ status: 'COMPLETED' });
    const doc = await prisma.fiscalDocument.findFirstOrThrow({ where: { orderId: ids.sale2 } });
    expect(doc.payload).toMatchObject({ informacoes_adicionais_contribuinte: 'Origem do pedido: PDV (balcão)', cpf_destinatario: '52998224725', formas_pagamento: [{ forma_pagamento: '17', valor_pagamento: 4 }, { forma_pagamento: '04', valor_pagamento: 10, tipo_integracao: 2 }] });

    // Emitir de novo devolve a mesma nota (sem número novo).
    const again = await waiter().post(`/cardapio/pdv/pedidos/${ids.sale2}/nfce`).send({});
    expect(again.body).toMatchObject({ number: 1, status: 'AUTHORIZED' });

    const pdf = await waiter().get(`/cardapio/pdv/pedidos/${ids.sale2}/cupom.pdf`).buffer(true).parse((res2, cb) => {
      const chunks: Buffer[] = [];
      res2.on('data', (c: Buffer) => chunks.push(c));
      res2.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // O mesmo pedido pode sair como cupom não fiscal (reimpressão simples).
    expect((await waiter().get(`/cardapio/pdv/pedidos/${ids.sale2}/cupom?tipo=NAO_FISCAL`)).body.kind).toBe('NAO_FISCAL');
  });

  it('sangria e suprimento; financeiro lança cada pagamento no 1.8 Balcão pelo que entrou', async () => {
    expect((await waiter().post('/cardapio/pdv/caixa/movimento').send({ kind: 'SANGRIA', amountCents: 999999 })).status).toBe(400);
    await waiter().post('/cardapio/pdv/caixa/movimento').send({ kind: 'SANGRIA', amountCents: 5000, reason: 'Cofre' });
    const sup = await waiter().post('/cardapio/pdv/caixa/movimento').send({ kind: 'SUPRIMENTO', amountCents: 2000, reason: 'Moedas' });
    expect(sup.body.summary).toMatchObject({ openingCents: 10000, cashSalesCents: 6000, sangriaCents: 5000, suprimentoCents: 2000, expectedCashCents: 13000, salesCount: 2 });
    expect(sup.body.summary.byMethod).toEqual([
      { label: 'Dinheiro', pdvCents: 6000, salaoCents: 0, totalCents: 6000 },
      { label: 'Pix', pdvCents: 400, salaoCents: 0, totalCents: 400 },
      { label: 'Débito', pdvCents: 1000, salaoCents: 0, totalCents: 1000 },
    ]);

    await sync();
    type Entry = { externalKey: string; amountCents: number; paymentMethod: string; status: string; memo: boolean; description: string; account: { code: string } };
    const entries: Entry[] = await prisma.financialEntry.findMany({ where: { tenantId, source: 'cardapio', status: { not: 'CANCELLED' } }, include: { account: true } });
    const sales = entries.filter((e) => e.account.code === '1.8' && !e.memo);
    expect(sales.map((e) => [e.amountCents, e.paymentMethod, e.status]).sort()).toEqual([[1000, 'CARD_ON_DELIVERY', 'PAID'], [400, 'PIX', 'PAID'], [6000, 'CASH_ON_DELIVERY', 'PAID']].sort());
    const discount = entries.find((e) => e.externalKey === `order:${ids.sale1}:coupon`);
    expect(discount).toMatchObject({ amountCents: 400, memo: true, description: expect.stringContaining('Desconto no balcão') });
    expect(entries.find((e) => e.externalKey === `order:${ids.sale1}:tax`)?.amountCents).toBe(360);
  });

  it('cancelar venda: só dono/gerente; cancela a NFC-e e tira do caixa e do financeiro', async () => {
    expect((await waiter().post(`/cardapio/pdv/vendas/${ids.sale2}/cancelar`).send({ reason: 'Cliente desistiu da compra' })).status).toBe(403);
    expect((await owner().post(`/cardapio/pdv/vendas/${ids.sale2}/cancelar`).send({ reason: 'curto' })).status).toBe(400);
    const res = await owner().post(`/cardapio/pdv/vendas/${ids.sale2}/cancelar`).send({ reason: 'Cliente desistiu da compra' });
    expect(res.status).toBe(201);
    expect(await prisma.fiscalDocument.findFirst({ where: { orderId: ids.sale2 }, select: { status: true } })).toEqual({ status: 'CANCELLED' });
    expect((await waiter().get(`/cardapio/pdv/pedidos/${ids.sale2}/cupom`)).body.fiscal.status).toBe('CANCELLED');
    await sync();
    const left: { amountCents: number }[] = await prisma.financialEntry.findMany({ where: { tenantId, externalKey: { startsWith: 'pdvpay:' }, status: { not: 'CANCELLED' } } });
    expect(left.map((e) => e.amountCents)).toEqual([6000]);
    const list = await waiter().get('/cardapio/pdv/vendas');
    expect(list.body.find((s: { id: string }) => s.id === ids.sale2)).toMatchObject({ status: 'CANCELLED', receipt: 'NFCE', fiscalStatus: 'CANCELLED' });
  });

  it('rateio entre clientes: um cartão para cada, com o nome no cupom e no financeiro', async () => {
    const res = await waiter().post('/cardapio/pdv/vendas').send({
      items: [{ productId: ids.prato, quantity: 1 }],
      payments: [
        { key: 'CREDIT', amountCents: 1700, label: 'Ana' },
        { key: 'CREDIT', amountCents: 1650, label: 'Bia' },
        { key: 'DEBIT', amountCents: 1650, label: 'Caio' },
      ],
      kitchen: false,
      receipt: 'NAO_FISCAL',
    });
    expect(res.status).toBe(201);
    expect(res.body.receipt.payments.map((p: { label: string }) => p.label)).toEqual(['Crédito (Ana)', 'Crédito (Bia)', 'Débito (Caio)']);
    await sync();
    const rows: { counterparty: string | null; amountCents: number }[] = await prisma.financialEntry.findMany({
      where: { tenantId, externalKey: { startsWith: 'pdvpay:' }, account: { code: '1.8' }, description: { contains: `#${res.body.number}` } },
      orderBy: { amountCents: 'desc' },
    });
    expect(rows.map((r) => [r.counterparty, r.amountCents])).toEqual([['Ana', 1700], ['Bia', 1650], ['Caio', 1650]]);
    await owner().post(`/cardapio/pdv/vendas/${res.body.orderId}/cancelar`).send({ reason: 'Teste do rateio entre clientes' });
  });

  it('nota passou de 30 minutos: não cancela pela SEFAZ e a venda continua', async () => {
    const res = await waiter().post('/cardapio/pdv/vendas').send({ items: [{ productId: ids.refri, quantity: 1 }], payments: [{ key: 'CREDIT', amountCents: 700 }], kitchen: false, receipt: 'NFCE' });
    expect(res.body.receipt.fiscal.number).toBe(2);
    await prisma.fiscalDocument.updateMany({ where: { orderId: res.body.orderId }, data: { authorizedAt: new Date(Date.now() - 31 * 60_000) } });
    const cancel = await owner().post(`/cardapio/pdv/vendas/${res.body.orderId}/cancelar`).send({ reason: 'Cliente desistiu da compra' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.message).toMatch(/30 minutos/);
    expect(await prisma.order.findUnique({ where: { id: res.body.orderId }, select: { status: true } })).toEqual({ status: 'COMPLETED' });
  });

  it('fecha o caixa com a contagem da gaveta e mostra a diferença', async () => {
    const res = await waiter().post('/cardapio/pdv/caixa/fechar').send({ countedCents: 12950, notes: 'Faltou uma moeda' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CLOSED', expectedCents: 13000, countedCents: 12950, differenceCents: -50, summary: { cancelledCount: 2, salesCount: 2 } });
    expect((await waiter().get('/cardapio/pdv/caixa')).body.session).toBeNull();
    const hist = await waiter().get('/cardapio/pdv/caixas');
    expect(hist.body[0]).toMatchObject({ id: res.body.id, differenceCents: -50 });
  });
});
