import { MenuProduct, OrderValidationError, StoreRules, normalizePhone, priceOrder } from './order-pricing';

const store: StoreRules = {
  isOpen: true,
  acceptsDelivery: true,
  acceptsPickup: true,
  minOrderCents: 2000,
  paymentMethods: ['PIX', 'CASH_ON_DELIVERY'],
};
const pizza: MenuProduct = {
  id: 'pizza',
  name: 'Pizza Calabresa',
  priceCents: 4500,
  active: true,
  available: true,
  categoryActive: true,
  optionGroups: [
    {
      id: 'borda',
      name: 'Borda',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'tradicional', name: 'Tradicional', priceCents: 0, available: true },
        { id: 'catupiry', name: 'Catupiry', priceCents: 800, available: true },
        { id: 'cheddar', name: 'Cheddar', priceCents: 900, available: false },
      ],
    },
    {
      id: 'extras',
      name: 'Extras',
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: 'bacon', name: 'Bacon', priceCents: 500, available: true },
        { id: 'ovo', name: 'Ovo', priceCents: 300, available: true },
        { id: 'milho', name: 'Milho', priceCents: 200, available: true },
      ],
    },
  ],
};
const products = new Map([[pizza.id, pizza]]);
const zones = [
  { id: 'centro', name: 'Centro', feeCents: 500, active: true },
  { id: 'longe', name: 'Longe', feeCents: 1500, active: false },
];
const base = { type: 'DELIVERY' as const, zoneId: 'centro', paymentMethod: 'PIX' as const };
const expectError = (fn: () => unknown, msg: string | RegExp) => {
  expect(fn).toThrow(OrderValidationError);
  expect(fn).toThrow(msg);
};

describe('priceOrder', () => {
  it('soma produto + adicionais x quantidade + taxa do bairro', () => {
    const r = priceOrder(
      { ...base, items: [{ productId: 'pizza', quantity: 2, optionIds: ['catupiry', 'bacon', 'ovo'] }] },
      store,
      products,
      zones,
    );
    expect(r.items[0].unitPriceCents).toBe(4500 + 800 + 500 + 300);
    expect(r.subtotalCents).toBe(6100 * 2);
    expect(r.deliveryFeeCents).toBe(500);
    expect(r.totalCents).toBe(12200 + 500);
    expect(r.items[0].options.map((o) => o.name)).toEqual(['Catupiry', 'Bacon', 'Ovo']);
  });

  it('retirada não cobra taxa nem exige bairro', () => {
    const r = priceOrder({ type: 'PICKUP', paymentMethod: 'PIX', items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, products, zones);
    expect(r.deliveryFeeCents).toBe(0);
    expect(r.zone).toBeNull();
  });

  it('exige a escolha obrigatória', () =>
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1 }] }, store, products, zones), /Escolha uma opção em "Borda"/));

  it('respeita o máximo do grupo', () =>
    expectError(
      () => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional', 'bacon', 'ovo', 'milho'] }] }, store, products, zones),
      /no máximo 2/,
    ));

  it('recusa adicional de outro produto ou inexistente', () =>
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional', 'xxx'] }] }, store, products, zones), /Adicional inválido/));

  it('recusa adicional esgotado', () =>
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1, optionIds: ['cheddar'] }] }, store, products, zones), /Cheddar está esgotado/));

  it('recusa produto esgotado ou fora do cardápio', () => {
    const esgotado = new Map([[pizza.id, { ...pizza, available: false }]]);
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, esgotado, zones), /esgotado/);
    expectError(() => priceOrder({ ...base, items: [{ productId: 'nada', quantity: 1 }] }, store, products, zones), /não está mais no cardápio/);
  });

  it('recusa quantidade inválida', () =>
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 0, optionIds: ['tradicional'] }] }, store, products, zones), /Quantidade inválida/));

  it('aplica o pedido mínimo sobre o subtotal', () => {
    const barato = new Map([[pizza.id, { ...pizza, priceCents: 1000 }]]);
    expectError(() => priceOrder({ ...base, items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, barato, zones), /pedido mínimo é de R\$ 20,00/);
  });

  it('exige bairro atendido e ativo', () =>
    expectError(() => priceOrder({ ...base, zoneId: 'longe', items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, products, zones), /bairro/));

  it('loja fechada não recebe pedido', () =>
    expectError(() => priceOrder({ ...base, items: [] }, { ...store, isOpen: false }, products, zones), /fechada/));

  it('forma de pagamento precisa estar habilitada', () =>
    expectError(() => priceOrder({ ...base, paymentMethod: 'CARD_ON_DELIVERY', items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, products, zones), /Forma de pagamento/));

  it('troco precisa ser maior que o total', () =>
    expectError(
      () => priceOrder({ ...base, paymentMethod: 'CASH_ON_DELIVERY', changeForCents: 3000, items: [{ productId: 'pizza', quantity: 1, optionIds: ['tradicional'] }] }, store, products, zones),
      /troco/,
    ));
});

describe('normalizePhone', () => {
  it('aceita celular e fixo com DDD, com ou sem +55 e máscara', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone('+55 11 98765-4321')).toBe('11987654321');
    expect(normalizePhone('1133334444')).toBe('1133334444');
  });
  it('recusa números curtos', () => expect(normalizePhone('98765-4321')).toBeNull());
});
