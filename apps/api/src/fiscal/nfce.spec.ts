import { createHash } from 'node:crypto';
import { PdvPaymentError, settlePayments } from '@delivery360/shared';
import { accessKey, allocate, buildNfcePayload, FiscalError, mod11, qrCodeUrl, TPAG, type NfceInput } from './nfce';

const base: NfceInput = {
  environment: 'HOMOLOGACAO',
  cnpj: '11222333000181',
  uf: 'SP',
  taxRegime: 1,
  csosn: '102',
  series: 1,
  number: 7,
  issuedAt: new Date('2026-11-28T15:00:00Z'),
  presence: 1,
  items: [
    { code: 'X1', name: 'X-Burger', ncm: '21069090', cfop: '5102', quantity: 2, totalCents: 5000 },
    { code: 'REF', name: 'Refrigerante', ncm: '22021000', cfop: '5405', quantity: 1, totalCents: 700 },
  ],
  discountCents: 0,
  freightCents: 0,
  payments: [{ tPag: TPAG.CASH, amountCents: 5700 }],
  changeCents: 300,
  document: '52998224725',
  customerName: 'Ana',
};

describe('NFC-e', () => {
  it('divide o desconto entre os itens sem perder centavos', () => {
    expect(allocate([5000, 700], 1000)).toEqual([877, 123]);
    expect(allocate([100, 100, 100], 100).reduce((a, b) => a + b, 0)).toBe(100);
    expect(() => allocate([100], 200)).toThrow(FiscalError);
  });

  it('monta a nota: troco no dinheiro, CPF do consumidor e aviso de homologação', () => {
    const { body, totalCents } = buildNfcePayload(base);
    expect(totalCents).toBe(5700);
    expect(body.valor_total).toBe(57);
    expect(body.formas_pagamento).toEqual([{ forma_pagamento: '01', valor_pagamento: 60 }]);
    expect(body.valor_troco).toBe(3);
    expect((body as Record<string, unknown>).cpf_destinatario).toBe('52998224725');
    expect(body.items[0].descricao).toContain('HOMOLOGACAO');
    expect(body.items[0].valor_unitario_comercial).toBe(25);
    expect(body.modalidade_frete).toBe(9);
  });

  it('entrega em domicílio leva o frete, e o cartão sai como não integrado', () => {
    const { body } = buildNfcePayload({
      ...base,
      environment: 'PRODUCAO',
      presence: 4,
      freightCents: 800,
      discountCents: 500,
      changeCents: 0,
      document: null,
      payments: [{ tPag: TPAG.DEBIT, amountCents: 6000 }],
    });
    expect(body.items[0].descricao).toBe('X-Burger');
    expect((body as Record<string, unknown>).valor_frete).toBe(8);
    expect(body.modalidade_frete).toBe(0);
    expect(body.formas_pagamento[0]).toEqual({ forma_pagamento: '04', valor_pagamento: 60, tipo_integracao: 2 });
    expect(body.items.reduce((s, i) => s + i.valor_desconto, 0)).toBeCloseTo(5);
  });

  it('recusa NCM errado, falta de CNPJ e pagamento que não fecha', () => {
    expect(() => buildNfcePayload({ ...base, items: [{ ...base.items[0], ncm: '123' }] })).toThrow(/NCM de "X-Burger"/);
    expect(() => buildNfcePayload({ ...base, cnpj: '' })).toThrow(/CNPJ/);
    expect(() => buildNfcePayload({ ...base, payments: [{ tPag: TPAG.PIX, amountCents: 100 }] })).toThrow(/pagamentos/);
  });

  it('chave de acesso: 44 dígitos, modelo 65 e dígito verificador módulo 11', () => {
    expect(mod11('123')).toBe(6);
    const key = accessKey({ uf: 'SP', issuedAt: base.issuedAt, cnpj: base.cnpj, series: 1, number: 7, code: 12345678 });
    expect(key).toHaveLength(44);
    expect(key.slice(0, 6)).toBe('352611');
    expect(key.slice(6, 20)).toBe(base.cnpj);
    expect(key.slice(20, 22)).toBe('65');
    expect(key.slice(22, 34)).toBe('001000000007');
    expect(Number(key[43])).toBe(mod11(key.slice(0, 43)));
  });

  it('QR Code versão 2 com hash SHA-1 do CSC', () => {
    const key = '3'.repeat(44);
    const url = qrCodeUrl({ key, environment: 'HOMOLOGACAO', cscId: '000001', csc: 'ABCDEF1234567890', uf: 'SP' });
    const hash = createHash('sha1').update(`${key}|2|2|1ABCDEF1234567890`).digest('hex').toUpperCase();
    expect(url).toBe(`https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${key}|2|2|1|${hash}`);
  });
});

describe('Pagamento no PDV', () => {
  it('dinheiro com troco e pagamento dividido', () => {
    const r = settlePayments(4200, [
      { key: 'PIX', amountCents: 2000 },
      { key: 'CASH', amountCents: 2200, receivedCents: 5000 },
    ]);
    expect(r[1]).toMatchObject({ method: 'CASH_ON_DELIVERY', changeCents: 2800, receivedCents: 5000 });
    expect(r[0]).toMatchObject({ method: 'PIX', changeCents: 0 });
    expect(settlePayments(1000, [{ key: 'DEBIT', amountCents: 1000 }])[0]).toMatchObject({ method: 'CARD_ON_DELIVERY', cardKind: 'DEBIT' });
  });

  it('recusa falta, sobra e dinheiro entregue a menos', () => {
    expect(() => settlePayments(1000, [{ key: 'PIX', amountCents: 900 }])).toThrow(/Falta receber R\$ 1,00/);
    expect(() => settlePayments(1000, [{ key: 'CREDIT', amountCents: 1200 }])).toThrow(/passam do total/);
    expect(() => settlePayments(1000, [{ key: 'CASH', amountCents: 1000, receivedCents: 500 }])).toThrow(PdvPaymentError);
    expect(() => settlePayments(1000, [])).toThrow(/forma de pagamento/);
  });
});
