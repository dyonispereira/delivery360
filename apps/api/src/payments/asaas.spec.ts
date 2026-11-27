import { AsaasClient, AsaasError, type FetchLike } from './asaas.client';
import { AsaasGateway, todayInBrazil } from './payment-gateway';
import { open, seal } from './secret-box';

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };

/** Asaas de mentira, só para conferir o que mandamos e como lemos as respostas. */
function fakeAsaas(routes: Record<string, (body: unknown) => [number, unknown]>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url, headers: init.headers, body });
    const key = `${init.method} ${url.replace(/^https:\/\/[^/]+\/v3/, '').replace(/\?.*$/, '')}`;
    const route = routes[key];
    const [status, json] = route ? route(body) : [404, { errors: [{ description: `rota ${key}` }] }];
    return { ok: status < 300, status, text: async () => JSON.stringify(json) };
  };
  return { calls, fetchImpl };
}

describe('Asaas', () => {
  it('Pix: cadastra o cliente, cria a cobrança de hoje e devolve o QR Code', async () => {
    const asaas = fakeAsaas({
      'GET /customers': () => [200, { data: [] }],
      'POST /customers': () => [200, { id: 'cus_1' }],
      'POST /payments': () => [200, { id: 'pay_1', status: 'PENDING', value: 52.9, billingType: 'PIX' }],
      'GET /payments/pay_1/pixQrCode': () => [200, { encodedImage: 'iVBOR', payload: '000201pix', expirationDate: '2027-11-26 23:59:59' }],
    });
    const gw = new AsaasGateway(new AsaasClient('$aact_test_key', true, asaas.fetchImpl));
    const r = await gw.createCharge({ amountCents: 5290, method: 'PIX', description: 'Pedido Pizzaria', customer: { name: 'Ana', phone: '11987654321', document: '52998224725' } });

    expect(r).toMatchObject({ externalId: 'pay_1', pixCopyPaste: '000201pix', pixQrImage: 'iVBOR', gatewayCustomerId: 'cus_1' });
    expect(asaas.calls[0].url).toBe('https://api-sandbox.asaas.com/v3/customers?cpfCnpj=52998224725&limit=1');
    expect(asaas.calls[0].headers).toMatchObject({ access_token: '$aact_test_key', 'User-Agent': 'Delivery360' });
    expect(asaas.calls[1].body).toMatchObject({ name: 'Ana', cpfCnpj: '52998224725', mobilePhone: '11987654321', notificationDisabled: true });
    expect(asaas.calls[2].body).toEqual({ customer: 'cus_1', billingType: 'PIX', value: 52.9, dueDate: todayInBrazil(), description: 'Pedido Pizzaria' });
  });

  it('cartão transparente: aprovado devolve a taxa; em análise fica pendente; recusado vira erro; sem resposta consulta antes', async () => {
    const input = {
      card: { holderName: 'ANA', number: '4539656048392220', expiryMonth: '12', expiryYear: '2035', ccv: '123' },
      holder: { name: 'ANA', email: 'a@b.com', cpfCnpj: '52998224725', postalCode: '01310100', addressNumber: '10', mobilePhone: '11987654321' },
      remoteIp: '200.1.2.3',
    };
    let reply: [number, unknown] = [200, { id: 'pay_c', status: 'CONFIRMED', value: 50, netValue: 48.02, billingType: 'CREDIT_CARD' }];
    const asaas = fakeAsaas({
      'POST /payments/pay_c/payWithCreditCard': () => reply,
      'GET /payments/pay_c': () => [200, { id: 'pay_c', status: 'CONFIRMED', value: 50, netValue: 48.02, billingType: 'CREDIT_CARD' }],
    });
    const gw = new AsaasGateway(new AsaasClient('k', true, asaas.fetchImpl));
    expect(await gw.payCard('pay_c', input)).toEqual({ outcome: 'paid', feeCents: 198 });
    expect(asaas.calls[0].body).toEqual({ creditCard: input.card, creditCardHolderInfo: input.holder, remoteIp: '200.1.2.3' });

    reply = [200, { id: 'pay_c', status: 'AWAITING_RISK_ANALYSIS', value: 50, billingType: 'CREDIT_CARD' }];
    expect(await gw.payCard('pay_c', input)).toEqual({ outcome: 'pending' });

    reply = [400, { errors: [{ description: 'Transação não autorizada.' }] }];
    await expect(gw.payCard('pay_c', input)).rejects.toThrow('Transação não autorizada.');

    // Rede caiu no meio: consulta a cobrança e descobre que foi paga (não pede para pagar de novo).
    const flaky = new AsaasGateway(
      new AsaasClient('k', true, async (url, init) => {
        if (init.method === 'POST') throw new Error('socket hang up');
        return asaas.fetchImpl(url, init);
      }),
    );
    expect(await flaky.payCard('pay_c', input)).toMatchObject({ outcome: 'paid' });
  });

  it('cliente já conhecido não é cadastrado de novo; produção usa a URL de produção', async () => {
    const asaas = fakeAsaas({
      'POST /payments': () => [200, { id: 'pay_2', status: 'PENDING', value: 10, billingType: 'PIX' }],
      'GET /payments/pay_2/pixQrCode': () => [200, { encodedImage: 'x', payload: 'y' }],
    });
    const gw = new AsaasGateway(new AsaasClient('k', false, asaas.fetchImpl));
    await gw.createCharge({ amountCents: 1000, method: 'PIX', description: 'x', customer: { name: 'B', phone: '1', document: '52998224725', gatewayCustomerId: 'cus_9' } });
    expect(asaas.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.asaas.com/v3/payments',
      'GET https://api.asaas.com/v3/payments/pay_2/pixQrCode',
    ]);
  });

  it('cartão: cria a cobrança de cartão e devolve a página segura do Asaas, sem QR Code', async () => {
    const asaas = fakeAsaas({
      'POST /payments': () => [200, { id: 'pay_3', status: 'PENDING', value: 61, billingType: 'CREDIT_CARD', invoiceUrl: 'https://sandbox.asaas.com/i/pay3' }],
    });
    const gw = new AsaasGateway(new AsaasClient('k', true, asaas.fetchImpl));
    const r = await gw.createCharge({ amountCents: 6100, method: 'CREDIT_CARD', description: 'Pedido', customer: { name: 'C', phone: '1', document: '52998224725', gatewayCustomerId: 'cus_9' } });
    expect(r).toMatchObject({ externalId: 'pay_3', checkoutUrl: 'https://sandbox.asaas.com/i/pay3', gatewayCustomerId: 'cus_9' });
    expect(r.pixCopyPaste).toBeUndefined();
    expect(r.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(asaas.calls).toHaveLength(1);
    expect(asaas.calls[0].body).toMatchObject({ billingType: 'CREDIT_CARD', value: 61 });

    const noUrl = fakeAsaas({ 'POST /payments': () => [200, { id: 'pay_4', status: 'PENDING', value: 1, billingType: 'CREDIT_CARD' }] });
    await expect(
      new AsaasGateway(new AsaasClient('k', true, noUrl.fetchImpl)).createCharge({ amountCents: 100, method: 'CREDIT_CARD', description: 'x', customer: { name: 'C', phone: '1', document: '52998224725', gatewayCustomerId: 'cus_9' } }),
    ).rejects.toBeInstanceOf(AsaasError);
  });

  it('traduz os erros do Asaas', async () => {
    const asaas = fakeAsaas({
      'GET /myAccount/commercialInfo/': () => [401, {}],
      'POST /payments': () => [400, { errors: [{ code: 'invalid_value', description: 'O valor da cobrança é inválido.' }] }],
    });
    const client = new AsaasClient('k', true, asaas.fetchImpl);
    await expect(client.accountInfo()).rejects.toThrow('Chave da API do Asaas inválida');
    await expect(client.createPayment({ customer: 'c', billingType: 'PIX', value: 0, dueDate: '2026-11-26', description: 'x' })).rejects.toEqual(
      new AsaasError('O valor da cobrança é inválido.', 400),
    );
  });

  it('vencimento é a data de Brasília', () => {
    // 01h UTC do dia 27 ainda é dia 26 em Brasília.
    expect(todayInBrazil(new Date('2026-11-27T01:00:00Z'))).toBe('2026-11-26');
  });

  it('a chave da API fica cifrada', () => {
    process.env.JWT_SECRET ??= 'segredo-de-teste';
    const sealed = seal('$aact_chave');
    expect(sealed).not.toContain('chave');
    expect(open(sealed)).toBe('$aact_chave');
    expect(seal('$aact_chave')).not.toBe(sealed);
  });
});
