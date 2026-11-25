import type { PaymentMethod } from '@delivery360/shared';

export interface Option { id: string; name: string; priceCents: number; available: boolean; position: number }
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
  optionGroups: Group[];
}
export interface Category { id: string; name: string; position: number; active: boolean; products: Product[] }
export interface Store {
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
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
