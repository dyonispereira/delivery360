import { LoyaltyError, levelFor, loyaltyDiscounts, makeReferralCode, nextLevel, pointsFor, type RewardRule } from './loyalty-rules';

const cart = (over: Partial<Parameters<typeof loyaltyDiscounts>[0]> = {}) => ({
  subtotalCents: 10_000,
  deliveryFeeCents: 800,
  items: [
    { productId: 'pizza', basePriceCents: 6000 },
    { productId: 'coca', basePriceCents: 1200 },
  ],
  remainingCents: 10_800,
  hasCoupon: false,
  ...over,
});
const reward = (over: Partial<RewardRule> = {}): RewardRule => ({
  id: 'r1',
  name: 'R$ 10 de desconto',
  pointsCost: 100,
  type: 'FIXED',
  valueCents: 1000,
  productId: null,
  minOrderCents: 0,
  active: true,
  ...over,
});
const none = { level: null, reward: null, balance: 0, referral: null };

describe('pontos', () => {
  it('1 ponto por real pago nos produtos, sem a taxa de entrega', () => {
    expect(pointsFor(5890, 800, 1)).toBe(50);
    expect(pointsFor(5890, 800, 2)).toBe(101);
    expect(pointsFor(500, 800, 1)).toBe(0);
  });
});

describe('prêmio por pontos', () => {
  it('desconto em reais quando tem saldo', () => {
    const r = loyaltyDiscounts(cart(), { ...none, reward: reward(), balance: 150 });
    expect(r).toMatchObject({ rewardDiscountCents: 1000, pointsSpent: 100, totalCents: 1000 });
  });
  it('sem saldo suficiente diz quanto falta', () => {
    expect(() => loyaltyDiscounts(cart(), { ...none, reward: reward(), balance: 40 })).toThrow('Faltam 60 pontos');
  });
  it('produto grátis: precisa estar no carrinho e sai pelo preço sem adicionais', () => {
    const r = loyaltyDiscounts(cart(), { ...none, reward: reward({ type: 'PRODUCT', productId: 'coca', valueCents: 0 }), balance: 100 });
    expect(r.rewardDiscountCents).toBe(1200);
    expect(() => loyaltyDiscounts(cart(), { ...none, reward: reward({ type: 'PRODUCT', productId: 'sobremesa' }), balance: 100 })).toThrow(LoyaltyError);
  });
  it('entrega grátis desconta a taxa e recusa pedido sem taxa', () => {
    expect(loyaltyDiscounts(cart(), { ...none, reward: reward({ type: 'FREE_DELIVERY' }), balance: 100 }).rewardDiscountCents).toBe(800);
    expect(() => loyaltyDiscounts(cart({ deliveryFeeCents: 0 }), { ...none, reward: reward({ type: 'FREE_DELIVERY' }), balance: 100 })).toThrow('sem taxa');
  });
  it('pedido mínimo do prêmio', () => {
    expect(() => loyaltyDiscounts(cart({ subtotalCents: 2000 }), { ...none, reward: reward({ minOrderCents: 5000 }), balance: 100 })).toThrow('R$ 50,00');
  });
  it('nunca passa do que falta pagar', () => {
    const r = loyaltyDiscounts(cart({ remainingCents: 600 }), { ...none, reward: reward(), balance: 100 });
    expect(r.rewardDiscountCents).toBe(600);
  });
});

describe('clube de benefícios', () => {
  const ouro = { name: 'Ouro', minPoints: 1000, discountBps: 1000, freeDelivery: true };
  it('desconto % nos produtos + entrega grátis', () => {
    const r = loyaltyDiscounts(cart(), { ...none, level: ouro });
    expect(r.clubDiscountCents).toBe(1000 + 800);
  });
  it('não soma com cupom', () => {
    const r = loyaltyDiscounts(cart({ hasCoupon: true, remainingCents: 9000 }), { ...none, level: ouro });
    expect(r.clubDiscountCents).toBe(0);
  });
  it('soma com o prêmio, mas o prêmio de entrega grátis não repete', () => {
    expect(loyaltyDiscounts(cart(), { ...none, level: ouro, reward: reward(), balance: 100 }).totalCents).toBe(2800);
    expect(() => loyaltyDiscounts(cart(), { ...none, level: ouro, reward: reward({ type: 'FREE_DELIVERY' }), balance: 100 })).toThrow();
  });
  it('nível pelo maior mínimo alcançado e quanto falta para o próximo', () => {
    const levels = [
      { name: 'Prata', minPoints: 300 },
      { name: 'Ouro', minPoints: 1000 },
    ];
    expect(levelFor(levels, 299)).toBeNull();
    expect(levelFor(levels, 300)?.name).toBe('Prata');
    expect(levelFor(levels, 5000)?.name).toBe('Ouro');
    expect(nextLevel(levels, 450)).toMatchObject({ name: 'Ouro', missing: 550 });
    expect(nextLevel(levels, 1200)).toBeNull();
  });
});

describe('Indique e Ganhe', () => {
  it('desconto do amigo no pedido que passa do mínimo', () => {
    expect(loyaltyDiscounts(cart(), { ...none, referral: { discountCents: 1000, minOrderCents: 3000 } }).referralDiscountCents).toBe(1000);
    expect(loyaltyDiscounts(cart({ subtotalCents: 2000 }), { ...none, referral: { discountCents: 1000, minOrderCents: 3000 } }).referralDiscountCents).toBe(0);
  });
  it('código com o começo do nome, sem acento', () => {
    expect(makeReferralCode('Átila Souza', () => 0)).toBe('ATILAAA');
    expect(makeReferralCode('Jo', () => 0.99)).toMatch(/^JO[A-Z2-9]{3}$/);
    expect(makeReferralCode('123', () => 0)).toBe('AMIGOAAA');
  });
});
