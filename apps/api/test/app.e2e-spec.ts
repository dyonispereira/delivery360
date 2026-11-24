import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
process.env.JWT_SECRET = 'segredo-de-teste';

// Importados depois das variáveis de ambiente.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupApp } = require('../src/setup-app');

describe('Núcleo: login, admin e chaves de módulo (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let tenantId: string;
  let ownerToken: string;
  let plans: { id: string; name: string; modules: string[] }[];

  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
  const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${ownerToken}`).set('x-tenant-id', tenantId);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('recusa senha errada com mensagem genérica', async () => {
    const res = await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'errada' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('E-mail ou senha incorretos.');
  });

  it('super admin faz login', async () => {
    const res = await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.user.staffRole).toBe('SUPER_ADMIN');
    adminToken = res.body.accessToken;
  });

  it('rotas privadas exigem login', async () => {
    expect((await http().get('/auth/me')).status).toBe(401);
    expect((await http().get('/admin/tenants')).status).toBe(401);
  });

  it('lista os planos do seed', async () => {
    const res = await asAdmin(http().get('/admin/plans'));
    expect(res.status).toBe(200);
    plans = res.body;
    expect(plans.map((p) => p.name)).toEqual(['Cardápio Digital', 'Essencial', 'Crescimento', 'Gestão 360']);
  });

  it('cria restaurante no plano Essencial com gestão e cardápio ligados', async () => {
    const essencial = plans.find((p) => p.name === 'Essencial')!;
    const res = await asAdmin(http().post('/admin/tenants')).send({
      name: 'Pizzaria Teste',
      cnpj: '12345678000190',
      planId: essencial.id,
    });
    expect(res.status).toBe(201);
    tenantId = res.body.id;
    expect(res.body.activeModules).toEqual(['cardapio', 'gestao']);
  });

  it('não aceita CNPJ repetido', async () => {
    const res = await asAdmin(http().post('/admin/tenants')).send({ name: 'Outra', cnpj: '12345678000190' });
    expect(res.status).toBe(409);
  });

  it('cria o dono do restaurante, que faz login e vê seus módulos', async () => {
    const add = await asAdmin(http().post(`/admin/tenants/${tenantId}/users`)).send({
      name: 'Dono Teste',
      email: 'dono@pizzaria.test',
      password: 'senha-forte-1',
      role: 'OWNER',
    });
    expect(add.status).toBe(201);

    const login = await http().post('/auth/login').send({ email: 'dono@pizzaria.test', password: 'senha-forte-1' });
    expect(login.status).toBe(200);
    ownerToken = login.body.accessToken;
    expect(login.body.user.tenants).toEqual([
      expect.objectContaining({ id: tenantId, role: 'OWNER', activeModules: ['cardapio', 'gestao'] }),
    ]);
  });

  it('o dono não acessa o painel admin', async () => {
    const res = await http().get('/admin/tenants').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('módulo ligado responde; módulo desligado é bloqueado', async () => {
    expect((await asOwner(http().get('/gestao/status'))).status).toBe(200);
    const blocked = await asOwner(http().get('/trafego/status'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('trafego');
  });

  it('rota de módulo exige o restaurante no cabeçalho', async () => {
    const res = await http().get('/gestao/status').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('admin liga o tráfego e o dono passa a acessar; desligar bloqueia de novo', async () => {
    const on = await asAdmin(http().put(`/admin/tenants/${tenantId}/modules/trafego`)).send({ active: true });
    expect(on.status).toBe(200);
    expect((await asOwner(http().get('/trafego/status'))).status).toBe(200);

    await asAdmin(http().put(`/admin/tenants/${tenantId}/modules/trafego`)).send({ active: false });
    expect((await asOwner(http().get('/trafego/status'))).status).toBe(403);
  });

  it('trocar de plano sincroniza as chaves', async () => {
    const cardapio = plans.find((p) => p.name === 'Cardápio Digital')!;
    const res = await asAdmin(http().put(`/admin/tenants/${tenantId}/plan`)).send({ planId: cardapio.id });
    expect(res.status).toBe(200);
    expect(res.body.activeModules).toEqual(['cardapio']);
    expect((await asOwner(http().get('/gestao/status'))).status).toBe(403);
    const ctx = await asOwner(http().get('/tenant/context'));
    expect(ctx.body.activeModules).toEqual(['cardapio']);
  });

  it('usuário de outro restaurante não entra neste', async () => {
    const other = await asAdmin(http().post('/admin/tenants')).send({ name: 'Hamburgueria Teste' });
    const res = await http()
      .get('/tenant/context')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-tenant-id', other.body.id);
    expect(res.status).toBe(403);
  });

  it('suspender o restaurante bloqueia o dono, mas não o admin', async () => {
    await asAdmin(http().patch(`/admin/tenants/${tenantId}`)).send({ status: 'SUSPENDED' });
    expect((await asOwner(http().get('/tenant/context'))).status).toBe(403);
    const adminCtx = await asAdmin(http().get('/tenant/context')).set('x-tenant-id', tenantId);
    expect(adminCtx.status).toBe(200);
  });

  it('gestor de conta só vê a carteira e não mexe em módulos', async () => {
    const staff = await asAdmin(http().post('/admin/staff')).send({
      name: 'Gestora',
      email: 'gestora@delivery360.local',
      password: 'senha-forte-2',
      staffRole: 'ACCOUNT_MANAGER',
    });
    expect(staff.status).toBe(201);
    const login = await http().post('/auth/login').send({ email: 'gestora@delivery360.local', password: 'senha-forte-2' });
    const amToken = login.body.accessToken;

    expect((await http().get('/admin/tenants').set('Authorization', `Bearer ${amToken}`)).body).toEqual([]);

    await asAdmin(http().put(`/admin/tenants/${tenantId}/account-managers`)).send({ userIds: [staff.body.id] });
    const list = await http().get('/admin/tenants').set('Authorization', `Bearer ${amToken}`);
    expect(list.body.map((t: { id: string }) => t.id)).toEqual([tenantId]);

    const toggle = await http()
      .put(`/admin/tenants/${tenantId}/modules/gestao`)
      .set('Authorization', `Bearer ${amToken}`)
      .send({ active: true });
    expect(toggle.status).toBe(403);
  });

  it('registra tudo no log de auditoria', async () => {
    const res = await asAdmin(http().get(`/admin/audit-logs?tenantId=${tenantId}`));
    const actions = res.body.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(['tenant.create', 'membership.create', 'tenant.set_module', 'tenant.set_plan', 'tenant.update']),
    );
  });
});
