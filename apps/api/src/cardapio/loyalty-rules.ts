/**
 * Regras da fidelidade (funções puras, sem banco, para testar fácil).
 *
 * - Pontos: o cliente ganha pontos por real pago nos produtos quando o pedido é entregue/retirado.
 * - Prêmio: troca pontos por desconto em reais, entrega grátis ou um produto de graça.
 * - Clube: nível pelos pontos ganhos em 12 meses, com desconto automático.
 * - Indique e Ganhe: o amigo ganha desconto no primeiro pedido; quem indicou ganha pontos.
 *
 * Tudo é custo do restaurante (vai para "Descontos e cupons" no DRE). O caixa recebe só o que o cliente pagou.
 */

export class LoyaltyError extends Error {}

export interface RewardRule {
  id: string;
  name: string;
  pointsCost: number;
  type: 'FIXED' | 'FREE_DELIVERY' | 'PRODUCT';
  valueCents: number;
  productId: string | null;
  minOrderCents: number;
  active: boolean;
}

export interface LevelRule {
  name: string;
  minPoints: number;
  discountBps: number;
  freeDelivery: boolean;
}

export interface LoyaltyCart {
  subtotalCents: number;
  deliveryFeeCents: number;
  /** Itens do carrinho: preço do produto sem os adicionais (para o prêmio "produto grátis"). */
  items: { productId: string; basePriceCents: number }[];
  /** Total depois do cupom (o que ainda dá para descontar). */
  remainingCents: number;
  /** O cliente usou um cupom: clube e indicação não somam com cupom. */
  hasCoupon: boolean;
}

export interface LoyaltyInput {
  /** Nível do cliente no clube (null = sem nível ou clube desligado). */
  level: LevelRule | null;
  /** Prêmio escolhido e o saldo de pontos do cliente. */
  reward: RewardRule | null;
  balance: number;
  /** Desconto do amigo indicado (0 = não se aplica). */
  referral: { discountCents: number; minOrderCents: number } | null;
}

export interface LoyaltyResult {
  clubDiscountCents: number;
  rewardDiscountCents: number;
  referralDiscountCents: number;
  pointsSpent: number;
  totalCents: number;
}

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

export function loyaltyDiscounts(cart: LoyaltyCart, input: LoyaltyInput): LoyaltyResult {
  let left = Math.max(0, cart.remainingCents);
  const take = (want: number) => {
    const d = Math.max(0, Math.min(want, left));
    left -= d;
    return d;
  };

  // Clube: só sem cupom (o cupom já é um desconto; não soma os dois).
  let clubDiscountCents = 0;
  let freeDeliveryUsed = false;
  if (input.level && !cart.hasCoupon) {
    const pct = Math.floor((cart.subtotalCents * input.level.discountBps) / 10_000);
    const ship = input.level.freeDelivery ? cart.deliveryFeeCents : 0;
    freeDeliveryUsed = ship > 0;
    clubDiscountCents = take(pct + ship);
  }

  // Indique e Ganhe: primeiro pedido do amigo, também não soma com cupom.
  let referralDiscountCents = 0;
  if (input.referral && !cart.hasCoupon && cart.subtotalCents >= input.referral.minOrderCents) {
    referralDiscountCents = take(input.referral.discountCents);
  }

  // Prêmio: o cliente pagou com pontos, então soma com tudo.
  let rewardDiscountCents = 0;
  let pointsSpent = 0;
  const r = input.reward;
  if (r) {
    if (!r.active) throw new LoyaltyError('Este prêmio não está mais disponível.');
    if (input.balance < r.pointsCost) {
      throw new LoyaltyError(`Faltam ${r.pointsCost - input.balance} pontos para trocar por "${r.name}".`);
    }
    if (cart.subtotalCents < r.minOrderCents) throw new LoyaltyError(`"${r.name}" vale em pedidos a partir de ${brl(r.minOrderCents)}.`);
    let want = 0;
    if (r.type === 'FIXED') want = r.valueCents;
    if (r.type === 'FREE_DELIVERY') {
      if (cart.deliveryFeeCents === 0 || freeDeliveryUsed) throw new LoyaltyError('Este pedido já está sem taxa de entrega.');
      want = cart.deliveryFeeCents;
    }
    if (r.type === 'PRODUCT') {
      const line = cart.items.filter((i) => i.productId === r.productId).sort((a, b) => a.basePriceCents - b.basePriceCents)[0];
      if (!line) throw new LoyaltyError(`Coloque o produto do prêmio "${r.name}" no carrinho para ganhar de graça.`);
      want = line.basePriceCents;
    }
    rewardDiscountCents = take(want);
    if (rewardDiscountCents <= 0) throw new LoyaltyError('Este pedido já está com o valor todo descontado.');
    pointsSpent = r.pointsCost;
  }

  return {
    clubDiscountCents,
    rewardDiscountCents,
    referralDiscountCents,
    pointsSpent,
    totalCents: clubDiscountCents + rewardDiscountCents + referralDiscountCents,
  };
}

/** Pontos ganhos com o pedido: por real pago nos produtos (sem a taxa de entrega). */
export function pointsFor(paidCents: number, deliveryFeeCents: number, pointsPerReal: number) {
  const products = Math.max(0, paidCents - deliveryFeeCents);
  return Math.floor((products * Math.max(0, pointsPerReal)) / 100);
}

/** Nível do clube pelos pontos ganhos em 12 meses (o maior que o cliente alcança). */
export function levelFor<T extends { minPoints: number }>(levels: T[], earned12m: number): T | null {
  return [...levels].sort((a, b) => b.minPoints - a.minPoints).find((l) => earned12m >= l.minPoints) ?? null;
}

/** Próximo nível e quantos pontos faltam. */
export function nextLevel<T extends { minPoints: number }>(levels: T[], earned12m: number): (T & { missing: number }) | null {
  const next = [...levels].sort((a, b) => a.minPoints - b.minPoints).find((l) => l.minPoints > earned12m);
  return next ? { ...next, missing: next.minPoints - earned12m } : null;
}

/** Código de indicação: começo do primeiro nome + 3 caracteres (sem letras que confundem). */
export function makeReferralCode(name: string, random: () => number = Math.random) {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4) || 'AMIGO';
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 3; i++) tail += chars[Math.floor(random() * chars.length)];
  return base + tail;
}
