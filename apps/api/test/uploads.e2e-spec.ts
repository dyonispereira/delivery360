import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://delivery:delivery@localhost:5432/delivery360_test?schema=public';
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.PUBLIC_API_URL = 'https://loja.delivery360.test/api';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupApp } = require('../src/setup-app');

/** PNG 1x1 válido. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = (buf: Buffer, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

describe('Fotos enviadas pelo painel e banner com arte completa (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let ownerToken: string;
  let staffToken: string;
  let tenantId: string;
  let slug: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token}`).set('x-tenant-id', tenantId),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    adminToken = (await http().post('/auth/login').send({ email: 'admin@delivery360.local', password: 'admin123' })).body.accessToken;
    const plans = (await http().get('/admin/plans').set('Authorization', `Bearer ${adminToken}`)).body;
    const essencial = plans.find((p: { name: string }) => p.name === 'Essencial');
    tenantId = (await http().post('/admin/tenants').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Pizzaria Foto', planId: essencial.id })).body.id;
    for (const [email, role] of [
      ['dono@foto.test', 'OWNER'],
      ['func@foto.test', 'STAFF'],
    ]) {
      await http().post(`/admin/tenants/${tenantId}/users`).set('Authorization', `Bearer ${adminToken}`).send({ name: role, email, password: 'senha-forte-1', role });
    }
    ownerToken = (await http().post('/auth/login').send({ email: 'dono@foto.test', password: 'senha-forte-1' })).body.accessToken;
    staffToken = (await http().post('/auth/login').send({ email: 'func@foto.test', password: 'senha-forte-1' })).body.accessToken;
    slug = (await as(ownerToken).get('/cardapio/store')).body.slug;
  });

  afterAll(async () => {
    await app.close();
  });

  it('dono envia a foto, ela vira um link público com cache longo e serve de foto do produto', async () => {
    const res = await as(ownerToken).post('/cardapio/uploads').send({ dataUrl: dataUrl(PNG) });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe(`https://loja.delivery360.test/api/public/uploads/${res.body.id}`);

    const img = await http().get(`/public/uploads/${res.body.id}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);

    const cat = (await as(ownerToken).post('/cardapio/categories').send({ name: 'Pizzas' })).body.id;
    const prod = await as(ownerToken).post('/cardapio/products').send({ categoryId: cat, name: 'Presunto', priceCents: 5000, imageUrl: res.body.url });
    expect(prod.status).toBe(201);
    expect(prod.body.imageUrl).toBe(res.body.url);
  });

  it('recusa o que não é foto (SVG, texto disfarçado), arquivo grande e funcionário', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await as(ownerToken).post('/cardapio/uploads').send({ dataUrl: dataUrl(svg, 'image/svg+xml') })).status).toBe(400);
    expect((await as(ownerToken).post('/cardapio/uploads').send({ dataUrl: dataUrl(Buffer.from('não sou imagem'), 'image/png') })).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await as(ownerToken).post('/cardapio/uploads').send({ dataUrl: dataUrl(big) })).status).toBe(400);
    expect((await as(staffToken).post('/cardapio/uploads').send({ dataUrl: dataUrl(PNG) })).status).toBe(403);
    expect((await http().post('/cardapio/uploads').send({ dataUrl: dataUrl(PNG) })).status).toBe(401);
    expect((await http().get('/public/uploads/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('equipe sobe o banner e marca "arte completa": a loja recebe fullArt para mostrar a imagem inteira', async () => {
    const up = await http().post('/admin/uploads').set('Authorization', `Bearer ${adminToken}`).send({ dataUrl: dataUrl(PNG) });
    expect(up.status).toBe(201);
    expect((await as(ownerToken).post('/admin/uploads').send({ dataUrl: dataUrl(PNG) })).status).toBe(403);

    const camp = await http()
      .post('/admin/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Vantagens exclusivas', imageUrl: up.body.url, tenantIds: [tenantId], fullArt: true });
    expect(camp.status).toBe(201);
    await as(ownerToken).put('/cardapio/store').send({ isOpen: true });
    const store = (await http().get(`/public/stores/${slug}`)).body;
    expect(store.banners).toEqual([expect.objectContaining({ title: 'Vantagens exclusivas', imageUrl: up.body.url, fullArt: true })]);
  });
});
