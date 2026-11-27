/**
 * Salão: mesas, conta da mesa e pedidos lançados pelo garçom.
 * Cada envio do garçom é um pedido (rodada) que vai para a cozinha; a conta soma as rodadas até fechar.
 */
import type { OrderStatus, PaymentMethod } from './orders';

/** Formas de pagamento no fechamento da mesa, com o nome que o salão usa. */
export const TAB_PAYMENT_METHODS: { method: PaymentMethod; label: string }[] = [
  { method: 'PIX', label: 'Pix' },
  { method: 'CARD_ON_DELIVERY', label: 'Cartão (maquininha)' },
  { method: 'CASH_ON_DELIVERY', label: 'Dinheiro' },
];

/** Taxa de serviço sobre o consumo (pontos-base, 1000 = 10%), arredondada para o centavo. */
export function serviceFee(subtotalCents: number, bps: number): number {
  if (bps <= 0 || subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * bps) / 10_000);
}

/** Valor por pessoa ao dividir a conta: a primeira pessoa paga os centavos que sobram. */
export function splitBill(totalCents: number, people: number): number[] {
  const n = Math.max(1, Math.min(50, Math.floor(people) || 1));
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

export interface SalaoTable {
  id: string;
  name: string;
  position: number;
  active: boolean;
  /** Conta aberta agora (null = mesa livre). */
  tab: {
    id: string;
    openedAt: string;
    people: number | null;
    /** Soma dos pedidos não cancelados. */
    subtotalCents: number;
    /** Consumo + taxa de serviço (se esta conta cobra). */
    totalCents: number;
    /** Já recebido (pagamentos parciais). */
    paidCents: number;
    rounds: number;
    /** Rodadas prontas na cozinha esperando o garçom levar. */
    readyCount: number;
    /** Rodadas ainda na cozinha (recebido ou em preparo). */
    kitchenCount: number;
  } | null;
}

/** Rodada pronta na cozinha esperando o garçom levar (painel do salão). */
export interface ReadyRound {
  id: string;
  number: number;
  tableId: string | null;
  tableName: string | null;
  waiterName: string | null;
  readyAt: string;
  items: { id: string; name: string; quantity: number; notes: string | null; options: string[] }[];
}

export interface TabRound {
  id: string;
  number: number;
  status: OrderStatus;
  waiterName: string | null;
  createdAt: string;
  notes: string | null;
  totalCents: number;
  items: { id: string; name: string; quantity: number; totalCents: number; notes: string | null; options: { name: string }[] }[];
}

export interface TabPaymentInfo {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  label: string | null;
  createdAt: string;
}

/**
 * Taxa de serviço de cada pagamento, proporcional ao valor (o último leva o arredondamento),
 * para o caixa de cada forma de pagamento bater com o que entrou.
 */
export function allocateServiceFee(amounts: number[], feeCents: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (!total || feeCents <= 0) return amounts.map(() => 0);
  let left = feeCents;
  return amounts.map((a, i) => {
    if (i === amounts.length - 1) return left;
    const part = Math.min(left, Math.round((a * feeCents) / total));
    left -= part;
    return part;
  });
}

export interface TabDetail {
  id: string;
  tableId: string;
  tableName: string;
  status: 'OPEN' | 'CLOSED';
  people: number | null;
  openedAt: string;
  closedAt: string | null;
  rounds: TabRound[];
  subtotalCents: number;
  /** Taxa de serviço configurada na loja (pontos-base). */
  serviceFeeBps: number;
  /** Esta conta cobra a taxa de serviço. */
  serviceFee: boolean;
  serviceFeeCents: number;
  /** Consumo + taxa de serviço. */
  totalCents: number;
  payments: TabPaymentInfo[];
  paidCents: number;
  /** Quanto falta pagar (negativo = pagaram a mais, por exemplo depois de cancelar um item). */
  remainingCents: number;
  /** Forma de pagamento de maior valor (fechada). */
  paymentMethod: PaymentMethod | null;
}
