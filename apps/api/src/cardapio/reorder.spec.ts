import { rebuildOrder, type PublicStore } from '@delivery360/shared';

const menu: Pick<PublicStore, 'categories'> = {
  categories: [
    {
      id: 'c1',
      name: 'Pizzas',
      products: [
        {
          id: 'meio',
          name: 'Pizza Meio Metro',
          description: null,
          priceCents: 12000,
          imageUrl: null, listPriceCents: null, promoEndsAt: null,
          available: true,
          optionGroups: [
            {
              id: 'sabores',
              name: 'Sabores',
              minSelect: 1,
              maxSelect: 3,
              options: [
                { id: 'bacon', name: 'Bacon', priceCents: 0, available: true },
                { id: 'atum', name: 'Atum', priceCents: 0, available: false },
                { id: 'baiana', name: 'Baiana', priceCents: 500, available: true },
              ],
            },
          ],
        },
        { id: 'coca', name: 'Coca-Cola 2L', description: null, priceCents: 2400, imageUrl: null, listPriceCents: null, promoEndsAt: null, available: true, optionGroups: [] },
        { id: 'guarana', name: 'Guaraná 2L', description: null, priceCents: 1400, imageUrl: null, listPriceCents: null, promoEndsAt: null, available: false, optionGroups: [] },
      ],
    },
  ],
};

const item = (productId: string | null, name: string, unit: number, options: { optionId: string | null; name: string }[] = [], quantity = 1) => ({
  productId,
  name,
  quantity,
  unitPriceCents: unit,
  totalCents: unit * quantity,
  notes: null,
  options: options.map((o) => ({ ...o, groupName: 'Sabores', priceCents: 0 })),
});

describe('rebuildOrder (Pedir de novo)', () => {
  it('remonta itens iguais sem avisos', () => {
    const r = rebuildOrder({ items: [item('coca', 'Coca-Cola 2L', 2400, [], 2), item('meio', 'Pizza Meio Metro', 12500, [{ optionId: 'bacon', name: 'Bacon' }, { optionId: 'baiana', name: 'Baiana' }])] }, menu);
    expect(r.warnings).toEqual([]);
    expect(r.items).toEqual([
      expect.objectContaining({ productId: 'coca', quantity: 2, unitPriceCents: 2400 }),
      expect.objectContaining({ productId: 'meio', optionIds: ['bacon', 'baiana'], unitPriceCents: 12500 }),
    ]);
  });

  it('avisa quando o preço mudou e usa o preço de hoje', () => {
    const r = rebuildOrder({ items: [item('coca', 'Coca-Cola 2L', 2200)] }, menu);
    expect(r.items[0].unitPriceCents).toBe(2400);
    expect(r.warnings).toEqual(['Coca-Cola 2L mudou de R$ 22,00 para R$ 24,00.']);
  });

  it('tira produto em falta ou apagado', () => {
    const r = rebuildOrder({ items: [item('guarana', 'Guaraná 2L', 1400), item(null, 'Esfiha', 800)] }, menu);
    expect(r.items).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });

  it('tira só o sabor que acabou quando o resto ainda vale', () => {
    const r = rebuildOrder({ items: [item('meio', 'Pizza Meio Metro', 12000, [{ optionId: 'bacon', name: 'Bacon' }, { optionId: 'atum', name: 'Atum' }])] }, menu);
    expect(r.items[0].optionIds).toEqual(['bacon']);
    expect(r.warnings).toEqual(['Pizza Meio Metro: Atum acabou e saiu do item.']);
  });

  it('pede para escolher de novo quando o item fica sem o mínimo', () => {
    const r = rebuildOrder({ items: [item('meio', 'Pizza Meio Metro', 12000, [{ optionId: 'atum', name: 'Atum' }])] }, menu);
    expect(r.items).toEqual([]);
    expect(r.warnings[0]).toContain('Toque no produto para escolher de novo');
  });
});
