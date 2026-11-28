import {
  cartTotals,
  consumptionModes,
  demoTicket,
  orderOrigin,
  totemModes,
  totemTicket,
  selectionErrors,
  setQuantity,
  toggleOption,
  unitPrice,
  upsertLine,
  type PublicProduct,
  type TotemLine,
} from '@delivery360/shared';

const pizza: PublicProduct = {
  id: 'pizza',
  name: 'Pizza Grande',
  description: null,
  priceCents: 5000,
  listPriceCents: null,
  promoEndsAt: null,
  imageUrl: null,
  available: true,
  optionGroups: [
    {
      id: 'massa',
      name: 'Massa',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'fina', name: 'Fina', priceCents: 0, available: true },
        { id: 'grossa', name: 'Grossa', priceCents: 300, available: true },
      ],
    },
    {
      id: 'extras',
      name: 'Adicionais',
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: 'bacon', name: 'Bacon', priceCents: 600, available: true },
        { id: 'catupiry', name: 'Catupiry', priceCents: 500, available: true },
        { id: 'cheddar', name: 'Cheddar', priceCents: 500, available: true },
        { id: 'atum', name: 'Atum', priceCents: 700, available: false },
      ],
    },
  ],
};

const line = (key: string, unitPriceCents: number, quantity = 1): TotemLine => ({
  key,
  productId: 'pizza',
  name: 'Pizza Grande',
  imageUrl: null,
  optionIds: [],
  optionNames: [],
  notes: '',
  quantity,
  unitPriceCents,
});

describe('totem: escolha de adicionais', () => {
  it('adicional obrigatório bloqueia o avanço até escolher', () => {
    expect(selectionErrors(pizza, [])).toEqual(['Escolha uma opção em "Massa".']);
    expect(selectionErrors(pizza, ['fina'])).toEqual([]);
  });

  it('grupo de escolha única troca a opção em vez de somar', () => {
    const g = pizza.optionGroups[0];
    expect(toggleOption(g, ['fina'], 'grossa')).toEqual(['grossa']);
    expect(toggleOption(g, ['grossa'], 'grossa')).toEqual([]);
  });

  it('respeita o máximo e ignora opção indisponível', () => {
    const g = pizza.optionGroups[1];
    let picked = toggleOption(g, ['fina'], 'bacon');
    picked = toggleOption(g, picked, 'catupiry');
    expect(toggleOption(g, picked, 'cheddar')).toEqual(picked);
    expect(toggleOption(g, picked, 'atum')).toEqual(picked);
    expect(picked).toEqual(['fina', 'bacon', 'catupiry']);
  });

  it('o preço acompanha cada adicional', () => {
    expect(unitPrice(pizza, ['fina'])).toBe(5000);
    expect(unitPrice(pizza, ['grossa', 'bacon'])).toBe(5900);
  });
});

describe('totem: carrinho', () => {
  it('total soma quantidade x preço com adicionais', () => {
    const cart = [line('a', 5900, 2), line('b', 5000)];
    expect(cartTotals(cart)).toEqual({ items: 3, totalCents: 16800 });
  });

  it('editar troca o item no mesmo lugar; quantidade zero remove', () => {
    const cart = [line('a', 5000), line('b', 5000)];
    const edited = upsertLine(cart, { ...line('a', 6100), optionIds: ['grossa', 'bacon'] });
    expect(edited.map((l) => [l.key, l.unitPriceCents])).toEqual([['a', 6100], ['b', 5000]]);
    expect(setQuantity(edited, 'a', 0).map((l) => l.key)).toEqual(['b']);
    expect(setQuantity(edited, 'b', 50).find((l) => l.key === 'b')!.quantity).toBe(20);
  });
});

describe('totem: configuração e senha', () => {
  it('modos de consumo vêm da configuração (padrão: os dois)', () => {
    expect(consumptionModes(null)).toEqual(['EAT_IN', 'TAKEAWAY']);
    expect(consumptionModes('levar')).toEqual(['TAKEAWAY']);
    expect(consumptionModes('AQUI')).toEqual(['EAT_IN']);
  });

  it('senha de demonstração tem 3 dígitos', () => {
    expect(demoTicket(() => 0)).toBe('100');
    expect(demoTicket(() => 0.9999)).toBe('999');
  });
});

describe('totem real: cadastro, senha e origem', () => {
  it('modos de consumo vêm do cadastro do totem (nenhum ligado = os dois)', () => {
    expect(totemModes({ eatIn: true, takeaway: false })).toEqual(['EAT_IN']);
    expect(totemModes({ eatIn: false, takeaway: true })).toEqual(['TAKEAWAY']);
    expect(totemModes({ eatIn: false, takeaway: false })).toEqual(['EAT_IN', 'TAKEAWAY']);
  });

  it('senha sai do número do pedido: 3 dígitos, de 100 a 999, e recomeça', () => {
    expect(totemTicket(1)).toBe('100');
    expect(totemTicket(42)).toBe('141');
    expect(totemTicket(900)).toBe('999');
    expect(totemTicket(901)).toBe('100');
  });

  it('cupom e comanda mostram a origem "Totem (autoatendimento)"', () => {
    expect(orderOrigin('COUNTER', 'LOJA', true)).toBe('Totem (autoatendimento)');
    expect(orderOrigin('COUNTER', 'LOJA')).toBe('PDV (balcão)');
    expect(orderOrigin('DELIVERY', 'IFOOD', true)).toBe('iFood');
  });
});
