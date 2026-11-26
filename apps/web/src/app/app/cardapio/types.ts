import type { ChannelPrices, CostItem, PaymentMethod } from '@delivery360/shared';

export interface Option {
  id: string;
  name: string;
  priceCents: number;
  costCents?: number;
  pdvCode?: string | null;
  available: boolean;
  position: number;
  /** No combo: o produto do cardápio que esta opção representa. */
  linkedProductId?: string | null;
}
export interface Group { id: string; name: string; minSelect: number; maxSelect: number; position: number; options: Option[] }
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  active: boolean;
  available: boolean;
  /** Ficha técnica (só dono e gerente recebem). */
  costItems?: CostItem[];
  extraCostBps?: number;
  /** Código PDV: o mesmo no iFood, 99Food, Keeta e na loja própria. */
  pdvCode?: string | null;
  channelPrices?: ChannelPrices;
  /** Preço de/por. */
  promoPriceCents?: number | null;
  promoStartsAt?: string | null;
  promoEndsAt?: string | null;
  /** Combo: as etapas são os grupos de opções. */
  isCombo?: boolean;
  optionGroups: Group[];
}
export interface Category { id: string; name: string; position: number; active: boolean; products: Product[] }
export interface Store {
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  whatsapp: string | null;
  city: string | null;
  isOpen: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minOrderCents: number;
  paymentMethods: PaymentMethod[];
  estimatedMinutes: number;
}
export interface Zone { id: string; name: string; feeCents: number; active: boolean }
