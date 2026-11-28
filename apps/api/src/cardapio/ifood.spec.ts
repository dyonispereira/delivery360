import { IfoodPayloadError, cents, ifoodOrderToDto, parseIfoodEvent, signIfood, validIfoodSignature, type IfoodOrder } from './ifood';

const order = (over: Partial<IfoodOrder> = {}): IfoodOrder => ({
  id: 'ifd-1',
  displayId: '4821',
  orderType: 'DELIVERY',
  customer: { name: 'Ana', phone: { number: '0800 700 1234', localizer: '55443322' } },
  delivery: { pickupCode: '1234', deliveryAddress: { streetName: 'Rua A', streetNumber: '10', neighborhood: 'Centro' } },
  items: [{ externalCode: 'XB01', name: 'X-Burger', quantity: 2, unitPrice: 35, options: [{ externalCode: 'AD-BACON', name: 'Bacon', unitPrice: 4, quantity: 1 }] }],
  total: { subTotal: 78, deliveryFee: 6.9, benefits: 10, orderAmount: 74.9 },
  benefits: [{ value: 10, sponsorshipValues: [{ name: 'IFOOD', value: 6 }, { name: 'MERCHANT', value: 4 }] }],
  payments: { methods: [{ method: 'CREDIT', type: 'ONLINE', value: 74.9 }] },
  financial: { commission: 9.36, paymentFee: 2.43, payout: 69.11 },
  ...over,
});

describe('Hub iFood: regras puras', () => {
  it('converte reais em centavos sem erro de arredondamento', () => {
    expect(cents(74.9)).toBe(7490);
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents(undefined)).toBe(0);
    expect(cents(-5)).toBe(0);
  });

  it('lê o evento, aceita o código curto e exige id e código', () => {
    expect(parseIfoodEvent({ id: 'e1', code: 'can', orderId: 'o1', merchantId: 'm1' })).toMatchObject({ id: 'e1', fullCode: 'CANCELLED', orderId: 'o1', merchantId: 'm1' });
    expect(parseIfoodEvent({ id: 'e2', fullCode: 'PLACED', order: { id: 'o2' } }).orderId).toBe('o2');
    expect(() => parseIfoodEvent({ fullCode: 'PLACED' })).toThrow(IfoodPayloadError);
    expect(() => parseIfoodEvent(null)).toThrow(IfoodPayloadError);
  });

  it('assinatura: só o corpo assinado com o segredo certo passa', () => {
    const body = JSON.stringify({ id: 'e1' });
    const sig = signIfood('segredo', body);
    expect(validIfoodSignature('segredo', body, sig)).toBe(true);
    expect(validIfoodSignature('outro', body, sig)).toBe(false);
    expect(validIfoodSignature('segredo', body, undefined)).toBe(false);
    expect(validIfoodSignature('segredo', body, 'abc')).toBe(false);
  });

  it('pedido de entrega pago no app: itens pelo código PDV, total = o que o cliente pagou, valores do iFood à parte', () => {
    const { dto, amounts } = ifoodOrderToDto(order());
    expect(dto).toMatchObject({
      channel: 'IFOOD',
      externalId: 'ifd-1',
      externalCode: '4821',
      type: 'DELIVERY',
      paymentMethod: 'APP_ONLINE',
      deliveryFeeCents: 690,
      discountCents: 1000,
      deliveryCode: '1234',
      address: { street: 'Rua A', number: '10', neighborhood: 'Centro' },
    });
    expect(dto.items[0]).toMatchObject({ pdvCode: 'XB01', quantity: 2, unitPriceCents: 3500, options: [{ pdvCode: 'AD-BACON', priceCents: 400, quantity: 1 }] });
    expect(dto.notes).toContain('55443322');
    expect(amounts).toEqual({
      subtotalCents: 7800,
      deliveryFeeCents: 690,
      ifoodDiscountCents: 600,
      merchantDiscountCents: 400,
      additionalFeesCents: 0,
      orderAmountCents: 7490,
      commissionCents: 936,
      paymentFeeCents: 243,
      payoutCents: 6911,
    });
  });

  it('retirada paga em dinheiro na loja, sem valores financeiros informados', () => {
    const { dto, amounts } = ifoodOrderToDto(
      order({
        orderType: 'TAKEOUT',
        delivery: undefined,
        benefits: [],
        total: { subTotal: 78, deliveryFee: 5, orderAmount: 78 },
        payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 78, cash: { changeFor: 100 } }] },
        financial: undefined,
      }),
    );
    expect(dto).toMatchObject({ type: 'PICKUP', paymentMethod: 'CASH_ON_DELIVERY', changeForCents: 10000, deliveryFeeCents: 0, discountCents: 0 });
    expect(dto.address).toBeUndefined();
    expect(amounts.commissionCents).toBeUndefined();
    expect(amounts.orderAmountCents).toBe(7800);
  });

  it('cartão na entrega vira maquininha; pedido sem itens ou sem endereço é recusado', () => {
    expect(ifoodOrderToDto(order({ payments: { methods: [{ method: 'DEBIT', type: 'OFFLINE' }] } })).dto.paymentMethod).toBe('CARD_ON_DELIVERY');
    expect(() => ifoodOrderToDto(order({ items: [] }))).toThrow('não tem itens');
    expect(() => ifoodOrderToDto(order({ delivery: {} }))).toThrow('sem endereço');
  });
});
