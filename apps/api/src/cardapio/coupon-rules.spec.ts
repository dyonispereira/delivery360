import { CouponContext, CouponError, CouponRule, couponDiscount, couponLabel, weekdayInBrazil } from './coupon-rules';

const rule = (over: Partial<CouponRule> = {}): CouponRule => ({
  code: 'TESTE',
  type: 'PERCENT',
  value: 1000,
  maxDiscountCents: null,
  minOrderCents: 0,
  startsAt: null,
  endsAt: null,
  weekdays: [],
  maxUses: null,
  maxUsesPerCustomer: 1,
  firstOrderOnly: false,
  combinesWithPromo: false,
  active: true,
  ...over,
});

// Quinta-feira, 26/11/2026, 15h em Brasília.
const NOW = new Date('2026-11-26T18:00:00Z');
const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  now: NOW,
  subtotalCents: 10_000,
  promoItemsCents: 0,
  deliveryFeeCents: 700,
  orderType: 'DELIVERY',
  usesTotal: 0,
  usesByCustomer: 0,
  customerHasOrders: false,
  ...over,
});

const reason = (c: CouponRule, x: CouponContext) => {
  try {
    couponDiscount(c, x);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(CouponError);
    return (e as Error).message;
  }
};

describe('couponDiscount', () => {
  it('percentual arredonda para baixo e respeita o teto', () => {
    expect(couponDiscount(rule({ value: 1500 }), ctx({ subtotalCents: 3333 }))).toBe(499);
    expect(couponDiscount(rule({ value: 5000, maxDiscountCents: 1500 }), ctx())).toBe(1500);
  });

  it('valor fixo nunca passa do subtotal', () => {
    expect(couponDiscount(rule({ type: 'FIXED', value: 1000 }), ctx())).toBe(1000);
    expect(couponDiscount(rule({ type: 'FIXED', value: 50_000 }), ctx())).toBe(10_000);
  });

  it('entrega grátis desconta a taxa e não vale para retirada', () => {
    expect(couponDiscount(rule({ type: 'FREE_DELIVERY', value: 0 }), ctx())).toBe(700);
    expect(reason(rule({ type: 'FREE_DELIVERY', value: 0 }), ctx({ orderType: 'PICKUP' }))).toContain('retirar');
  });

  it('não soma com produto em promoção, a menos que o cupom permita', () => {
    expect(couponDiscount(rule(), ctx({ promoItemsCents: 4000 }))).toBe(600);
    expect(couponDiscount(rule({ combinesWithPromo: true }), ctx({ promoItemsCents: 4000 }))).toBe(1000);
    expect(reason(rule(), ctx({ promoItemsCents: 10_000 }))).toContain('promoção');
  });

  it('datas, dias da semana e pedido mínimo', () => {
    expect(reason(rule({ active: false }), ctx())).toContain('não está mais');
    expect(reason(rule({ startsAt: new Date('2026-12-01') }), ctx())).toContain('ainda não começou');
    expect(reason(rule({ endsAt: NOW }), ctx())).toContain('venceu');
    expect(reason(rule({ weekdays: [5, 6] }), ctx())).toBe('Este cupom vale só sexta, sábado.');
    expect(couponDiscount(rule({ weekdays: [4] }), ctx())).toBe(1000);
    expect(reason(rule({ minOrderCents: 12_000 }), ctx())).toContain('acima de R$ 120,00');
  });

  it('limites de uso e primeiro pedido; sem telefone ainda, não barra', () => {
    expect(reason(rule({ maxUses: 10 }), ctx({ usesTotal: 10 }))).toContain('todo usado');
    expect(reason(rule(), ctx({ usesByCustomer: 1 }))).toContain('já usou');
    expect(couponDiscount(rule({ maxUsesPerCustomer: null }), ctx({ usesByCustomer: 5 }))).toBe(1000);
    expect(couponDiscount(rule(), ctx({ usesByCustomer: null }))).toBe(1000);
    expect(reason(rule({ firstOrderOnly: true }), ctx({ customerHasOrders: true }))).toContain('primeiro pedido');
    expect(couponDiscount(rule({ firstOrderOnly: true }), ctx({ customerHasOrders: null }))).toBe(1000);
  });
});

describe('weekdayInBrazil e couponLabel', () => {
  it('usa o dia de Brasília, não o UTC', () => {
    // 02h UTC de sexta ainda é quinta à noite em Brasília.
    expect(weekdayInBrazil(new Date('2026-11-27T02:00:00Z'))).toBe(4);
  });

  it('descreve o cupom em poucas palavras', () => {
    expect(couponLabel({ type: 'PERCENT', value: 1500, maxDiscountCents: 2000, minOrderCents: 5000 })).toBe('15% off até R$ 20,00 acima de R$ 50,00');
    expect(couponLabel({ type: 'PERCENT', value: 1250, maxDiscountCents: null, minOrderCents: 0 })).toBe('12,5% off');
    expect(couponLabel({ type: 'FIXED', value: 1000, maxDiscountCents: null, minOrderCents: 0 })).toBe('R$ 10,00 off');
    expect(couponLabel({ type: 'FREE_DELIVERY', value: 0, maxDiscountCents: null, minOrderCents: 0 })).toBe('Entrega grátis');
  });
});
