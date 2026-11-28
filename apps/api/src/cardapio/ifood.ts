import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelOrderDto } from './cardapio.dto';

/**
 * Regras puras do Hub iFood: lê o evento do webhook e converte o pedido do iFood para o formato único do sistema.
 * O formato segue o do iFood (valores em reais), simplificado. Sem acesso oficial, o pedido vem junto do evento
 * PLACED (no iFood real ele é buscado pela API depois do evento) e os valores financeiros vêm em `financial`.
 */

export interface IfoodMoneyOption {
  externalCode?: string;
  name: string;
  groupName?: string;
  quantity?: number;
  unitPrice: number;
}

export interface IfoodOrder {
  id: string;
  displayId?: string;
  orderType?: 'DELIVERY' | 'TAKEOUT' | 'INDOOR';
  customer?: { name?: string; phone?: { number?: string; localizer?: string } };
  delivery?: {
    pickupCode?: string;
    deliveryAddress?: { streetName?: string; streetNumber?: string; complement?: string; reference?: string; neighborhood?: string };
  };
  items?: { externalCode?: string; name: string; quantity: number; unitPrice: number; observations?: string; options?: IfoodMoneyOption[] }[];
  total?: { subTotal?: number; deliveryFee?: number; benefits?: number; additionalFees?: number; orderAmount?: number };
  /** Descontos, com quem bancou cada parte (IFOOD ou MERCHANT). */
  benefits?: { value: number; sponsorshipValues?: { name: string; value: number }[] }[];
  payments?: { methods?: { method?: string; type?: 'ONLINE' | 'OFFLINE'; value?: number; cash?: { changeFor?: number } }[] };
  /** Simulação: o que o iFood desconta e repassa (no real vem da API financeira). */
  financial?: { commission?: number; paymentFee?: number; payout?: number };
  extraInfo?: string;
}

export interface IfoodEvent {
  id: string;
  /** PLACED, CONFIRMED, DISPATCHED, READY_TO_PICKUP, CONCLUDED, CANCELLED... */
  fullCode: string;
  orderId?: string;
  merchantId?: string;
  createdAt?: string;
  order?: IfoodOrder;
}

/** Valores que o iFood informou, em centavos (guardados no vínculo do pedido). */
export interface IfoodAmounts {
  subtotalCents: number;
  deliveryFeeCents: number;
  /** Desconto bancado pelo iFood: o iFood paga ao restaurante no repasse. */
  ifoodDiscountCents: number;
  /** Desconto bancado pela loja. */
  merchantDiscountCents: number;
  additionalFeesCents: number;
  /** O que o cliente pagou. */
  orderAmountCents: number;
  commissionCents?: number;
  paymentFeeCents?: number;
  payoutCents?: number;
}

export class IfoodPayloadError extends Error {}

/** Reais (número do iFood) para centavos. */
export const cents = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Situações que não mudam mais: um evento atrasado não volta o pedido para trás. */
export const FINAL_STATUSES = ['CANCELLED', 'CONCLUDED'];

/** Lê o corpo do webhook. Rejeita o que não tem id e código do evento. */
export function parseIfoodEvent(body: unknown): IfoodEvent {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = text(b.id, 80);
  const fullCode = text(b.fullCode ?? b.code, 40).toUpperCase();
  if (!id || !fullCode) throw new IfoodPayloadError('Evento sem id ou sem código.');
  const order = b.order && typeof b.order === 'object' ? (b.order as IfoodOrder) : undefined;
  return {
    id,
    fullCode: CODE_ALIASES[fullCode] ?? fullCode,
    orderId: text(b.orderId, 80) || text(order?.id, 80) || undefined,
    merchantId: text(b.merchantId, 80) || undefined,
    createdAt: text(b.createdAt, 40) || undefined,
    order,
  };
}

/** O iFood manda também o código curto (PLC, CFM, CAN...). */
const CODE_ALIASES: Record<string, string> = {
  PLC: 'PLACED',
  CFM: 'CONFIRMED',
  RTP: 'READY_TO_PICKUP',
  DSP: 'DISPATCHED',
  CON: 'CONCLUDED',
  CAN: 'CANCELLED',
};

/** Assinatura do webhook: HMAC-SHA256 do corpo com o segredo, em hexadecimal. */
export function signIfood(secret: string, rawBody: string) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function validIfoodSignature(secret: string, rawBody: string, signature: string | undefined) {
  if (!signature) return false;
  const expected = Buffer.from(signIfood(secret, rawBody));
  const got = Buffer.from(signature.trim().toLowerCase());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Converte o pedido do iFood para o formato único e separa os valores informados pelo iFood. */
export function ifoodOrderToDto(o: IfoodOrder): { dto: ChannelOrderDto; amounts: IfoodAmounts } {
  if (!o?.id) throw new IfoodPayloadError('Pedido sem id.');
  const items = o.items ?? [];
  if (items.length === 0) throw new IfoodPayloadError('O pedido não tem itens.');
  const type = o.orderType === 'DELIVERY' || !o.orderType ? 'DELIVERY' : 'PICKUP';
  const addr = o.delivery?.deliveryAddress;
  if (type === 'DELIVERY' && (!text(addr?.streetName, 160) || !text(addr?.streetNumber, 20))) {
    throw new IfoodPayloadError('Pedido de entrega sem endereço.');
  }

  let ifoodDiscountCents = 0;
  let merchantDiscountCents = 0;
  for (const b of o.benefits ?? []) {
    const parts = b.sponsorshipValues ?? [];
    if (parts.length === 0) merchantDiscountCents += cents(b.value);
    for (const s of parts) {
      if (String(s.name).toUpperCase() === 'IFOOD') ifoodDiscountCents += cents(s.value);
      else merchantDiscountCents += cents(s.value);
    }
  }
  const subtotalCents = cents(o.total?.subTotal);
  const deliveryFeeCents = type === 'DELIVERY' ? cents(o.total?.deliveryFee) : 0;
  const benefitsCents = Math.max(cents(o.total?.benefits), ifoodDiscountCents + merchantDiscountCents);
  const additionalFeesCents = cents(o.total?.additionalFees);
  const orderAmountCents = cents(o.total?.orderAmount) || Math.max(0, subtotalCents + deliveryFeeCents + additionalFeesCents - benefitsCents);

  const methods = o.payments?.methods ?? [];
  const online = methods.length === 0 || methods.some((m) => m.type !== 'OFFLINE');
  const cash = methods.find((m) => m.type === 'OFFLINE' && String(m.method).toUpperCase() === 'CASH');
  const paymentMethod = online ? 'APP_ONLINE' : cash ? 'CASH_ON_DELIVERY' : 'CARD_ON_DELIVERY';

  const pickup = text(o.delivery?.pickupCode, 10);
  const phone = text(o.customer?.phone?.number, 30);
  const localizer = text(o.customer?.phone?.localizer, 20);
  const f = o.financial;
  const optionalCents = (v: unknown) => (v === undefined || v === null ? undefined : cents(v));

  const dto: ChannelOrderDto = {
    channel: 'IFOOD',
    externalId: text(o.id, 80),
    externalCode: text(o.displayId, 20) || undefined,
    type,
    customer: { name: text(o.customer?.name, 120) || 'Cliente iFood', phone: phone || '0800 000 0000' },
    address:
      type === 'DELIVERY'
        ? {
            street: text(addr!.streetName, 160),
            number: text(addr!.streetNumber, 20),
            complement: text(addr!.complement, 80) || undefined,
            reference: text(addr!.reference, 120) || undefined,
            neighborhood: text(addr!.neighborhood, 80) || undefined,
          }
        : undefined,
    items: items.map((i) => ({
      pdvCode: text(i.externalCode, 40) || undefined,
      name: text(i.name, 160) || 'Item',
      quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
      unitPriceCents: cents(i.unitPrice),
      notes: text(i.observations, 300) || undefined,
      options: (i.options ?? []).map((op) => ({
        pdvCode: text(op.externalCode, 40) || undefined,
        name: text(op.name, 120) || 'Adicional',
        groupName: text(op.groupName, 80) || undefined,
        priceCents: cents(op.unitPrice),
        quantity: Math.max(1, Math.round(Number(op.quantity) || 1)),
      })),
    })),
    deliveryFeeCents,
    // O total do pedido é o que o cliente pagou; a parte do iFood volta ao restaurante no repasse.
    discountCents: benefitsCents,
    paymentMethod,
    changeForCents: cash?.cash?.changeFor ? cents(cash.cash.changeFor) : undefined,
    deliveryCode: /^\d{4}$/.test(pickup) ? pickup : undefined,
    notes: [text(o.extraInfo, 300), localizer ? `Localizador do telefone: ${localizer}` : ''].filter(Boolean).join(' · ') || undefined,
  };
  const amounts: IfoodAmounts = {
    subtotalCents,
    deliveryFeeCents,
    ifoodDiscountCents,
    merchantDiscountCents: Math.max(merchantDiscountCents, benefitsCents - ifoodDiscountCents),
    additionalFeesCents,
    orderAmountCents,
    commissionCents: optionalCents(f?.commission),
    paymentFeeCents: optionalCents(f?.paymentFee),
    payoutCents: optionalCents(f?.payout),
  };
  return { dto, amounts };
}
