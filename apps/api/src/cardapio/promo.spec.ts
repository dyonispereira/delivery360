import { activePromoPrice, discountPct, effectivePrice } from '@delivery360/shared';
import { MenuProduct, StoreRules, priceOrder } from './order-pricing';

const now = new Date('2026-11-25T18:00:00Z');

describe('preço de/por', () => {
  it('vale dentro do período e some fora dele', () => {
    const p = { priceCents: 11800, promoPriceCents: 6990, promoStartsAt: '2026-11-24T00:00:00Z', promoEndsAt: '2026-11-30T00:00:00Z' };
    expect(activePromoPrice(p, now)).toBe(6990);
    expect(activePromoPrice(p, new Date('2026-11-23T23:59:59Z'))).toBeNull();
    expect(activePromoPrice(p, new Date('2026-11-30T00:00:00Z'))).toBeNull();
    expect(effectivePrice({ priceCents: 11800 }, now)).toBe(11800);
  });

  it('sem datas vale até tirar; promoção maior que o preço é ignorada', () => {
    expect(activePromoPrice({ priceCents: 5000, promoPriceCents: 4000 }, now)).toBe(4000);
    expect(activePromoPrice({ priceCents: 5000, promoPriceCents: 5000 }, now)).toBeNull();
  });

  it('selo de % arredonda para baixo', () => {
    expect(discountPct(11800, 6990)).toBe(40);
    expect(discountPct(11000, 7590)).toBe(31);
    expect(discountPct(1000, 1000)).toBe(0);
  });

  it('o pedido cobra o preço promocional e registra a economia', () => {
    const store: StoreRules = { isOpen: true, acceptsDelivery: true, acceptsPickup: true, minOrderCents: 0, paymentMethods: ['PIX'] };
    const pizza: MenuProduct = {
      id: 'meio',
      name: 'Meio Metro',
      priceCents: 6990,
      listPriceCents: 11800,
      active: true,
      available: true,
      categoryActive: true,
      optionGroups: [{ id: 'borda', name: 'Borda', minSelect: 0, maxSelect: 1, options: [{ id: 'cat', name: 'Catupiry', priceCents: 800, available: true }] }],
    };
    const r = priceOrder({ type: 'PICKUP', paymentMethod: 'PIX', items: [{ productId: 'meio', quantity: 2, optionIds: ['cat'] }] }, store, new Map([['meio', pizza]]), []);
    expect(r.items[0]).toMatchObject({ unitPriceCents: 7790, listUnitPriceCents: 12600, totalCents: 15580 });
    expect(r.promoDiscountCents).toBe(2 * (11800 - 6990));
    expect(r.totalCents).toBe(15580);
  });
});
