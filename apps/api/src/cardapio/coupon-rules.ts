/**
 * Regras do cupom da loja própria. Função pura (sem banco) para ser fácil de testar:
 * o serviço busca o cupom e os usos e passa tudo pronto.
 */

export type CouponTypeCode = 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';

export interface CouponRule {
  code: string;
  type: CouponTypeCode;
  /** PERCENT: pontos-base (1000 = 10%). FIXED: centavos. */
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  weekdays: number[];
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  firstOrderOnly: boolean;
  combinesWithPromo: boolean;
  /** Só vale para estes produtos (ou combos). Vazio = pedido inteiro. */
  productIds: string[];
  active: boolean;
}

export interface CouponCartItem {
  productId: string;
  totalCents: number;
  /** Item com preço de/por ativo. */
  promo: boolean;
}

export interface CouponContext {
  now: Date;
  /** Soma dos itens (já com o preço de/por). */
  subtotalCents: number;
  items: CouponCartItem[];
  /** Nomes dos produtos do cupom, para a mensagem quando nenhum está no carrinho. */
  productNames?: string[];
  deliveryFeeCents: number;
  orderType: 'DELIVERY' | 'PICKUP';
  /** Usos do cupom em pedidos não cancelados. */
  usesTotal: number;
  /** Usos por este telefone (null = ainda não sabemos o telefone). */
  usesByCustomer: number | null;
  /** O cliente já tem pedido não cancelado nesta loja (null = ainda não sabemos). */
  customerHasOrders: boolean | null;
}

export class CouponError extends Error {}

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Dia da semana no horário de Brasília (0 = domingo). */
export function weekdayInBrazil(d: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Texto curto do cupom para a loja: "15% off", "R$ 10 off", "Entrega grátis". */
export function couponLabel(c: Pick<CouponRule, 'type' | 'value' | 'maxDiscountCents' | 'minOrderCents'>, productNames: string[] = []): string {
  const base =
    c.type === 'PERCENT' ? `${(c.value / 100).toLocaleString('pt-BR')}% off` : c.type === 'FIXED' ? `${brl(c.value)} off` : 'Entrega grátis';
  const parts = [base];
  if (productNames.length && c.type !== 'FREE_DELIVERY') {
    parts.push(`em ${productNames.length <= 2 ? productNames.join(' e ') : `${productNames.length} produtos`}`);
  }
  if (c.type === 'PERCENT' && c.maxDiscountCents) parts.push(`até ${brl(c.maxDiscountCents)}`);
  if (c.minOrderCents > 0) parts.push(`acima de ${brl(c.minOrderCents)}`);
  return parts.join(' ');
}

/** Desconto do cupom em centavos, ou CouponError com o motivo para o cliente. */
export function couponDiscount(c: CouponRule, ctx: CouponContext): number {
  const fail = (msg: string): never => {
    throw new CouponError(msg);
  };
  if (!c.active) fail('Este cupom não está mais valendo.');
  if (c.startsAt && ctx.now < c.startsAt) fail('Este cupom ainda não começou a valer.');
  if (c.endsAt && ctx.now >= c.endsAt) fail('Este cupom já venceu.');
  if (c.weekdays.length && !c.weekdays.includes(weekdayInBrazil(ctx.now))) {
    fail(`Este cupom vale só ${c.weekdays.map((d) => WEEKDAYS[d]).join(', ')}.`);
  }
  if (c.maxUses != null && ctx.usesTotal >= c.maxUses) fail('Este cupom já foi todo usado.');
  if (c.maxUsesPerCustomer != null && ctx.usesByCustomer != null && ctx.usesByCustomer >= c.maxUsesPerCustomer) {
    fail('Você já usou este cupom.');
  }
  if (c.firstOrderOnly && ctx.customerHasOrders) fail('Este cupom é só para o primeiro pedido.');
  if (ctx.subtotalCents < c.minOrderCents) fail(`Este cupom vale para pedidos acima de ${brl(c.minOrderCents)}.`);

  if (c.type === 'FREE_DELIVERY') {
    if (ctx.orderType !== 'DELIVERY') fail('Este cupom é de entrega grátis e o pedido é para retirar.');
    return ctx.deliveryFeeCents;
  }

  const forProducts = c.productIds.length > 0;
  const inCoupon = forProducts ? ctx.items.filter((i) => c.productIds.includes(i.productId)) : ctx.items;
  if (!inCoupon.length) {
    const names = ctx.productNames?.length ? ctx.productNames.join(', ') : 'alguns produtos';
    fail(`Este cupom vale só para ${names}. Coloque no carrinho para usar.`);
  }
  const base = inCoupon.filter((i) => c.combinesWithPromo || !i.promo).reduce((s, i) => s + i.totalCents, 0);
  if (base <= 0) fail('Este cupom não vale para produtos que já estão em promoção.');
  const raw = c.type === 'PERCENT' ? Math.floor((base * c.value) / 10_000) : c.value;
  const capped = c.type === 'PERCENT' && c.maxDiscountCents != null ? Math.min(raw, c.maxDiscountCents) : raw;
  return Math.max(0, Math.min(capped, base));
}
