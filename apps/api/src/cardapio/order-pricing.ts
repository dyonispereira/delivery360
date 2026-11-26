/**
 * Cálculo do pedido feito SEMPRE no servidor, a partir do cardápio do banco.
 * O navegador do cliente só manda ids e quantidades; preços vindos dele são ignorados.
 * Função pura (sem banco) para ser fácil de testar.
 */

export type PaymentMethodCode = 'PIX' | 'CREDIT_CARD' | 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY' | 'APP_ONLINE';
export type OrderTypeCode = 'DELIVERY' | 'PICKUP';

export interface MenuOption {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
}
export interface MenuGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}
export interface MenuProduct {
  id: string;
  name: string;
  /** Preço que vale agora (já com a promoção, se houver). */
  priceCents: number;
  /** Preço normal, sem promoção (padrão: igual ao priceCents). */
  listPriceCents?: number;
  active: boolean;
  available: boolean;
  categoryActive: boolean;
  optionGroups: MenuGroup[];
}
export interface StoreRules {
  isOpen: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minOrderCents: number;
  paymentMethods: PaymentMethodCode[];
}
export interface Zone {
  id: string;
  name: string;
  feeCents: number;
  active: boolean;
}

export interface OrderRequestItem {
  productId: string;
  quantity: number;
  optionIds?: string[];
  notes?: string;
}
export interface OrderRequest {
  type: OrderTypeCode;
  zoneId?: string;
  paymentMethod: PaymentMethodCode;
  changeForCents?: number;
  items: OrderRequestItem[];
}

export interface PricedOption {
  optionId: string;
  groupName: string;
  name: string;
  priceCents: number;
}
export interface PricedItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  /** Preço unitário sem a promoção. */
  listUnitPriceCents: number;
  totalCents: number;
  notes: string | null;
  options: PricedOption[];
}
export interface PricedOrder {
  items: PricedItem[];
  subtotalCents: number;
  /** Economia do cliente com preço de/por (já descontada do subtotal). */
  promoDiscountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  zone: Zone | null;
}

export class OrderValidationError extends Error {}

const MAX_QTY = 50;
const MAX_ITEMS = 100;
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

export function priceOrder(
  req: OrderRequest,
  store: StoreRules,
  products: Map<string, MenuProduct>,
  zones: Zone[],
): PricedOrder {
  const fail = (msg: string): never => {
    throw new OrderValidationError(msg);
  };

  if (!store.isOpen) fail('A loja está fechada no momento.');
  if (req.type === 'DELIVERY' && !store.acceptsDelivery) fail('Esta loja não está fazendo entregas.');
  if (req.type === 'PICKUP' && !store.acceptsPickup) fail('Esta loja não aceita retirada no balcão.');
  if (!store.paymentMethods.includes(req.paymentMethod)) fail('Forma de pagamento não aceita por esta loja.');
  if (!req.items.length) fail('O carrinho está vazio.');
  if (req.items.length > MAX_ITEMS) fail('Pedido com itens demais.');

  const items: PricedItem[] = req.items.map((it) => {
    const product = products.get(it.productId);
    if (!product || !product.active || !product.categoryActive) fail('Um dos produtos não está mais no cardápio.');
    const p = product!;
    if (!p.available) fail(`${p.name} está esgotado.`);
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QTY) {
      fail(`Quantidade inválida para ${p.name}.`);
    }

    const chosen = it.optionIds ?? [];
    if (new Set(chosen).size !== chosen.length) fail(`Adicional repetido em ${p.name}.`);

    const options: PricedOption[] = [];
    const usedIds = new Set<string>();
    for (const g of p.optionGroups) {
      const picked = g.options.filter((o) => chosen.includes(o.id));
      if (picked.length < g.minSelect) {
        fail(g.minSelect === 1 ? `Escolha uma opção em "${g.name}" (${p.name}).` : `Escolha pelo menos ${g.minSelect} opções em "${g.name}" (${p.name}).`);
      }
      if (picked.length > g.maxSelect) fail(`Escolha no máximo ${g.maxSelect} em "${g.name}" (${p.name}).`);
      for (const o of picked) {
        if (!o.available) fail(`${o.name} está esgotado.`);
        usedIds.add(o.id);
        options.push({ optionId: o.id, groupName: g.name, name: o.name, priceCents: o.priceCents });
      }
    }
    if (usedIds.size !== chosen.length) fail(`Adicional inválido em ${p.name}.`);

    const optionsCents = options.reduce((s, o) => s + o.priceCents, 0);
    const unitPriceCents = p.priceCents + optionsCents;
    const listUnitPriceCents = Math.max(p.listPriceCents ?? p.priceCents, p.priceCents) + optionsCents;
    const notes = it.notes?.trim().slice(0, 300) || null;
    return {
      productId: p.id,
      name: p.name,
      quantity: it.quantity,
      unitPriceCents,
      listUnitPriceCents,
      totalCents: unitPriceCents * it.quantity,
      notes,
      options,
    };
  });

  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  const promoDiscountCents = items.reduce((s, i) => s + (i.listUnitPriceCents - i.unitPriceCents) * i.quantity, 0);
  if (subtotalCents < store.minOrderCents) fail(`O pedido mínimo é de ${brl(store.minOrderCents)}.`);

  let zone: Zone | null = null;
  if (req.type === 'DELIVERY') {
    zone = zones.find((z) => z.id === req.zoneId && z.active) ?? null;
    if (!zone) fail('Escolha um bairro de entrega atendido.');
  }
  const deliveryFeeCents = zone?.feeCents ?? 0;
  const totalCents = subtotalCents + deliveryFeeCents;

  if (req.paymentMethod === 'CASH_ON_DELIVERY' && req.changeForCents != null && req.changeForCents < totalCents) {
    fail(`O troco precisa ser para um valor maior que o total (${brl(totalCents)}).`);
  }

  return { items, subtotalCents, promoDiscountCents, deliveryFeeCents, totalCents, zone };
}

/** Telefone brasileiro só com dígitos, com DDD (10 ou 11 dígitos). Remove +55 se vier. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
