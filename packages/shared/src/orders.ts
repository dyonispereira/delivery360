/** Tipos e rótulos do módulo Cardápio e pedidos, usados pela web e pelos apps. */

export type OrderType = 'DELIVERY' | 'PICKUP';
export type OrderStatus = 'AWAITING_PAYMENT' | 'PAID' | 'IN_PREPARATION' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED';
/** APP_ONLINE = pago dentro do app de delivery (iFood, 99Food, Keeta); o app repassa depois. */
export type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY' | 'APP_ONLINE';
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
  APP_ONLINE: 'Pago no app',
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
  /** Preço de hoje (já com a promoção). */
  priceCents: number;
  /** Na promoção: o preço normal, para mostrar riscado. */
  listPriceCents: number | null;
  /** Na promoção: quando ela acaba (null = sem data). */
  promoEndsAt: string | null;
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
    coverUrl: string | null;
    whatsapp: string | null;
    isOpen: boolean;
    acceptsDelivery: boolean;
    acceptsPickup: boolean;
    minOrderCents: number;
    paymentMethods: PaymentMethod[];
    estimatedMinutes: number;
    /** Nota média das avaliações (null com menos de 3 avaliações). */
    rating: { average: number; count: number } | null;
  };
  categories: { id: string; name: string; products: PublicProduct[] }[];
  /** Produtos mais pedidos nos últimos 30 dias, do mais para o menos pedido. */
  topProductIds: string[];
  zones: { id: string; name: string; feeCents: number }[];
  /** Cupons que a loja mostra para todos (os outros só com o código). */
  coupons: PublicCoupon[];
}

export interface PublicCoupon {
  code: string;
  /** "15% off até R$ 20,00 acima de R$ 50,00". */
  label: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  /** Só vale para estes produtos ou combos (vazio = pedido inteiro). */
  productIds: string[];
  minOrderCents: number;
  firstOrderOnly: boolean;
  /** Dias em que vale (0 = domingo). Vazio = todos. */
  weekdays: number[];
  endsAt: string | null;
}

/** Conta do carrinho calculada pelo servidor (com cupom). */
export interface OrderQuote {
  subtotalCents: number;
  promoDiscountCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** promoExcluded: o cupom não vale nos itens em promoção do carrinho. */
  coupon: { code: string; label: string; discountCents: number; promoExcluded: boolean } | null;
  totalCents: number;
  /** Entrega sem bairro escolhido: a taxa ainda não entrou. */
  zonePending: boolean;
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
    /** Para o "Pedir de novo" (null se o produto foi apagado). */
    productId: string | null;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    notes: string | null;
    options: { optionId: string | null; groupName: string; name: string; priceCents: number }[];
  }[];
  subtotalCents: number;
  /** Economia com preço de/por. */
  promoDiscountCents: number;
  /** Desconto do cupom. */
  discountCents: number;
  couponCode: string | null;
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
