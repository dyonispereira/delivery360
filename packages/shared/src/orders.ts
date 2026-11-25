/** Tipos e rótulos do módulo Cardápio e pedidos, usados pela web e pelos apps. */

export type OrderType = 'DELIVERY' | 'PICKUP';
export type OrderStatus = 'AWAITING_PAYMENT' | 'PAID' | 'IN_PREPARATION' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED';
export type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pedido recebido',
  IN_PREPARATION: 'Em preparo',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  COMPLETED: 'Entregue',
  CANCELLED: 'Cancelado',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito (online)',
  CASH_ON_DELIVERY: 'Dinheiro na entrega',
  CARD_ON_DELIVERY: 'Cartão na entrega (maquininha)',
};

/** Centavos -> "R$ 12,50". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "12,50" ou "12.50" ou "12" -> 1250. Retorna null se inválido. */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, '').trim();
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export interface PublicOption {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
}
export interface PublicOptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PublicOption[];
}
export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  available: boolean;
  optionGroups: PublicOptionGroup[];
}
export interface PublicStore {
  store: {
    slug: string;
    displayName: string;
    description: string | null;
    logoUrl: string | null;
    whatsapp: string | null;
    isOpen: boolean;
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    minOrderCents: number;
    paymentMethods: PaymentMethod[];
    estimatedMinutes: number;
  };
  categories: { id: string; name: string; products: PublicProduct[] }[];
  zones: { id: string; name: string; feeCents: number }[];
}

export interface OrderTracking {
  trackingCode: string;
  number: number;
  status: OrderStatus;
  type: OrderType;
  createdAt: string;
  customerName: string;
  address: { street: string; number: string; complement: string | null; zone: string } | null;
  items: {
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    notes: string | null;
    options: { groupName: string; name: string; priceCents: number }[];
  }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  payment: { status: PaymentStatus; pixCopyPaste: string | null; expiresAt: string | null; canSimulate: boolean } | null;
  history: { status: OrderStatus; createdAt: string }[];
  store: { slug: string; displayName: string; whatsapp: string | null; estimatedMinutes: number } | null;
  courierName: string | null;
  /** Posição ao vivo do motoboy (null fora da entrega ou sem sinal recente). */
  courierLocation: { lat: number; lng: number; at: string } | null;
  /** O motoboy não conseguiu entregar e o restaurante ainda vai decidir (reenviar ou cancelar). */
  deliveryIssue: boolean;
  /** Avaliação já feita (null = ainda pode avaliar, se o pedido foi concluído). */
  rating: OrderRating | null;
  canRate: boolean;
  /** Primeiro nome do motoboy que entregou (para a gorjeta). */
  tipCourierName: string | null;
  canTip: boolean;
  tip: { status: PaymentStatus; amountCents: number; pixCopyPaste: string | null; expiresAt: string | null; canSimulate: boolean } | null;
}

// ---------- Entregas: ocorrências e avaliação ----------

export type DeliveryFailReason = 'ADDRESS_NOT_FOUND' | 'CUSTOMER_ABSENT' | 'CUSTOMER_REFUSED' | 'OTHER';

export const DELIVERY_FAIL_LABELS: Record<DeliveryFailReason, string> = {
  ADDRESS_NOT_FOUND: 'Endereço não localizado',
  CUSTOMER_ABSENT: 'Cliente não atende / ninguém no local',
  CUSTOMER_REFUSED: 'Cliente recusou / não quer mais o pedido',
  OTHER: 'Outro motivo',
};

/** Uma tentativa de entrega registrada pelo motoboy (não pode ser alterada por ele depois). */
export interface DeliveryAttemptInfo {
  id: string;
  outcome: 'DELIVERED' | 'FAILED';
  failReason: DeliveryFailReason | null;
  note: string | null;
  receiverName: string | null;
  code: string | null;
  courierName: string;
  courierPlate: string | null;
  batchNumber: number | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRating {
  store: number;
  delivery: number | null;
  comment: string | null;
  at: string;
}

export const RATING_LABELS = ['', 'Péssimo', 'Ruim', 'Regular', 'Bom', 'Excelente'] as const;
