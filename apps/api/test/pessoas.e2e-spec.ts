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

describe('Gestão de pessoas: funcionários, folgas e folha (e2e)', () => {
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const full = plans.find((p: { name: string }) => p.name === 'Gestão 360');
    tenantId = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Restaurante Pessoas', planId: full.id })).body.id;
    for (const [email, role] of [
      ['dono@pessoas.test', 'OWNER'],
      ['func@pessoas.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@pessoas.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@pessoas.test', password: 'senha-forte-1' })).body.accessToken;

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
  const M = '2026-10';
  const emp: Record<string, string> = {};
  type Entry = { description: string; amountCents: number; status: string; dueDate: string; competenceDate: string; account: { code: string } };
  const payrollEntries = async () =>
    ((await owner().get('/gestao/entries?type=PAYABLE&search=10/2026')).body.items as Entry[]).filter((e) => e.competenceDate === '2026-10-31');

  it('cadastra funcionários; equipe não vê salários', async () => {
    const ana = await owner().post('/gestao/employees').send({
      name: 'Ana Cozinheira', role: 'Cozinheira', type: 'CLT', salaryCents: 300_000, transportCents: 30_000, weeklyDayOff: 1, admissionDate: '2025-03-01',
    });
    expect(ana.status).toBe(201);
    emp.ana = ana.body.id;
    emp.beto = (await owner().post('/gestao/employees').send({ name: 'Beto Diarista', role: 'Garçom', type: 'DIARISTA', dailyRateCents: 12_000, admissionDate: '2026-01-01' })).body.id;
    emp.caio = (await owner().post('/gestao/employees').send({ name: 'Caio Novo', role: 'Atendente', type: 'CLT', salaryCents: 200_000, admissionDate: '2026-10-16' })).body.id;
    expect((await owner().post('/gestao/employees').send({ name: 'Sem Salário', role: 'X1', type: 'CLT', admissionDate: '2026-01-01' })).body.message).toContain('salário');
    expect((await staff().get('/gestao/employees')).status).toBe(403);
    const list = (await owner().get('/gestao/employees')).body;
    expect(list.find((e: { id: string }) => e.id === emp.ana)).toMatchObject({ admissionDate: '2025-03-01', weeklyDayOff: 1, active: true });
  });

  it('folgas e faltas no período; falta desconta na folha', async () => {
    expect((await owner().post('/gestao/absences').send({ employeeId: emp.ana, kind: 'FALTA', startDate: '2026-10-05', endDate: '2026-10-04' })).status).toBe(400);
    await owner().post('/gestao/absences').send({ employeeId: emp.ana, kind: 'FALTA', startDate: '2026-10-06', endDate: '2026-10-06' });
    await owner().post('/gestao/absences').send({ employeeId: emp.ana, kind: 'ATESTADO', startDate: '2026-10-20', endDate: '2026-10-21', notes: 'Gripe' });
    const list = (await owner().get('/gestao/absences?from=2026-10-01&to=2026-10-31')).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: 'FALTA', startDate: '2026-10-06', employee: { name: 'Ana Cozinheira' } });

    const p = (await owner().get(`/gestao/payroll/${M}`)).body;
    expect(p.status).toBe('DRAFT');
    const ana = p.items.find((i: { employeeId: string }) => i.employeeId === emp.ana);
    expect(ana).toMatchObject({ days: 30, baseCents: 300_000, absenceDays: 1, absenceCents: 10_000, chargesCents: 23_200 });
    const caio = p.items.find((i: { employeeId: string }) => i.employeeId === emp.caio);
    expect(caio).toMatchObject({ days: 16, baseCents: Math.round((200_000 * 16) / 30) });
  });

  it('diárias, extras e adiantamento; fechar gera as contas a pagar da folha', async () => {
    let p = (await owner().get(`/gestao/payroll/${M}`)).body;
    const item = (id: string) => p.items.find((i: { employeeId: string }) => i.employeeId === id);
    p = (await owner().patch(`/gestao/payroll/items/${item(emp.beto).id}`).send({ days: 8 })).body;
    expect(item(emp.beto)).toMatchObject({ baseCents: 96_000, netCents: 96_000 });
    expect((await owner().patch(`/gestao/payroll/items/${item(emp.ana).id}`).send({ days: 3 })).status).toBe(400);
    p = (await owner().patch(`/gestao/payroll/items/${item(emp.ana).id}`).send({ extrasCents: 20_000, advanceCents: 100_000 })).body;
    expect(item(emp.ana).netCents).toBe(300_000 - 10_000 + 20_000 - 100_000);

    const closed = await owner().post(`/gestao/payroll/${M}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('CLOSED');
    const rows = await payrollEntries();
    const find = (text: string) => rows.find((e) => e.description.includes(text))!;
    expect(find('Salário 10/2026 · Ana')).toMatchObject({ amountCents: 190_000, status: 'OPEN', dueDate: '2026-11-05', account: { code: '4.1' } });
    expect(find('Adiantamento 10/2026 · Ana')).toMatchObject({ amountCents: 100_000, status: 'PAID' });
    expect(find('Extras e prêmios 10/2026 · Ana')).toMatchObject({ amountCents: 20_000, account: { code: '4.2' } });
    expect(find('Diárias (8) 10/2026 · Beto')).toMatchObject({ amountCents: 96_000, account: { code: '4.3' } });
    expect(find('Encargos da folha')).toMatchObject({ account: { code: '4.4' }, dueDate: '2026-11-20' });
    expect(find('Vale-transporte')).toMatchObject({ account: { code: '4.5' }, amountCents: 29_000 });
    expect(find('Reserva de férias e 13º')).toMatchObject({ account: { code: '4.6' }, dueDate: '2026-12-20' });

    // DRE de outubro tem o custo de pessoal inteiro (inclusive o adiantamento).
    const dre = (await owner().get('/gestao/dre?from=2026-10-01&to=2026-10-31')).body;
    expect(JSON.stringify(dre)).toContain('Despesas com pessoal');
    const total = rows.reduce((t, e) => t + e.amountCents, 0);
    expect(total).toBe(closed.body.totals.costCents);
  });

  it('folha fechada trava alterações; reabrir apaga os lançamentos se nada foi pago', async () => {
    const p = (await owner().get(`/gestao/payroll/${M}`)).body;
    expect(p.status).toBe('CLOSED');
    expect((await owner().patch(`/gestao/payroll/items/${p.items[0].id}`).send({ bonusCents: 100 })).status).toBe(409);
    expect((await owner().post('/gestao/absences').send({ employeeId: emp.ana, kind: 'FOLGA', startDate: '2026-10-30', endDate: '2026-10-30' })).status).toBe(409);
    expect((await owner().post(`/gestao/payroll/${M}/close`)).status).toBe(409);

    const salary = (await payrollEntries()).find((e) => e.description.includes('Salário 10/2026 · Ana')) as Entry & { id: string };
    await owner().post(`/gestao/entries/${salary.id}/pay`).send({});
    expect((await owner().post(`/gestao/payroll/${M}/reopen`)).status).toBe(409);
    await owner().post(`/gestao/entries/${salary.id}/reopen`).send({});
    const reopened = await owner().post(`/gestao/payroll/${M}/reopen`);
    expect(reopened.body.status).toBe('DRAFT');
    expect(await payrollEntries()).toHaveLength(0);
  });

  it('desligamento tira o funcionário da folha dos meses seguintes', async () => {
    const res = await owner().patch(`/gestao/employees/${emp.caio}`).send({ terminationDate: '2026-11-10' });
    expect(res.body).toMatchObject({ active: false, terminationDate: '2026-11-10' });
    const nov = (await owner().get('/gestao/payroll/2026-11')).body;
    expect(nov.items.find((i: { employeeId: string }) => i.employeeId === emp.caio)).toMatchObject({ days: 10 });
    const dec = (await owner().get('/gestao/payroll/2026-12')).body;
    expect(dec.items.find((i: { employeeId: string }) => i.employeeId === emp.caio)).toBeUndefined();
    expect((await owner().get('/gestao/payroll/2026-13')).status).toBe(400);
  });
});
