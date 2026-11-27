import { statusMessage, whatsappNumber } from './order-messages';
import { EvolutionProvider, type FetchLike } from './whatsapp.provider';

describe('WhatsApp', () => {
  const base = { type: 'DELIVERY' as const, number: 12, storeName: 'Fornalha', customerName: 'Ana Souza', trackingUrl: 'https://x.test/pedido/abc' };

  it('mensagens de cada status; aguardando pagamento não gera mensagem', () => {
    expect(statusMessage({ ...base, status: 'AWAITING_PAYMENT' })).toBeNull();
    expect(statusMessage({ ...base, status: 'PAID', estimatedMinutes: 40 })).toContain('Oi, Ana!');
    expect(statusMessage({ ...base, status: 'OUT_FOR_DELIVERY', courierName: 'Carlos Lima' })).toContain('Carlos está a caminho');
    expect(statusMessage({ ...base, status: 'COMPLETED', type: 'PICKUP' })).toContain('retirado');
    expect(statusMessage({ ...base, status: 'COMPLETED', trackingUrl: null })).not.toContain('Conta pra gente');
  });

  it('número no formato do WhatsApp', () => {
    expect(whatsappNumber('(11) 98765-4321')).toBe('5511987654321');
    expect(whatsappNumber('1133334444')).toBe('551133334444');
    expect(whatsappNumber('5511987654321')).toBe('5511987654321');
    expect(whatsappNumber('123')).toBeNull();
  });

  it('Evolution API: cria a instância com QR, reaproveita se já existe e envia texto com a apikey', async () => {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
    let createStatus = 201;
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      const path = url.replace('https://wa.test', '');
      const reply = (status: number, json: unknown) => ({ ok: status < 300, status, text: async () => JSON.stringify(json) });
      if (path === '/instance/create') {
        return createStatus === 201
          ? reply(201, { instance: { instanceName: 'd360-a' }, qrcode: { base64: 'data:image/png;base64,QR', pairingCode: 'ABCD1234' } })
          : reply(403, { status: 403, error: 'Forbidden', response: { message: ['This name "d360-a" is already in use.'] } });
      }
      if (path === '/instance/connect/d360-a') return reply(200, { base64: 'data:image/png;base64,QR2', pairingCode: null, count: 2 });
      if (path === '/instance/connectionState/d360-a') return reply(200, { instance: { instanceName: 'd360-a', state: 'open' } });
      if (path === '/instance/fetchInstances?instanceName=d360-a') return reply(200, [{ ownerJid: '5511999990000@s.whatsapp.net' }]);
      if (path === '/message/sendText/d360-a') return reply(201, { key: { id: 'm1' } });
      return reply(404, { message: 'not found' });
    };
    const p = new EvolutionProvider('https://wa.test/', 'chave', fetchImpl);
    expect(await p.connect('d360-a')).toEqual({ state: 'connecting', qr: 'data:image/png;base64,QR', pairingCode: 'ABCD1234' });
    expect(calls[0]).toMatchObject({ headers: { apikey: 'chave' }, body: { instanceName: 'd360-a', qrcode: true, integration: 'WHATSAPP-BAILEYS' } });
    createStatus = 403;
    expect(await p.connect('d360-a')).toEqual({ state: 'connecting', qr: 'data:image/png;base64,QR2', pairingCode: undefined });
    expect(await p.state('d360-a')).toBe('open');
    expect(await p.state('outra')).toBeNull();
    expect(await p.ownerPhone('d360-a')).toBe('5511999990000');
    await p.sendText('d360-a', '5511988887777', 'oi');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { number: '5511988887777', text: 'oi' } });
  });
});
