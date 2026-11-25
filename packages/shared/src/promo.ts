/**
 * Preço de/por: o produto tem um preço promocional com início e fim opcionais.
 * Fora do período (ou sem preço promocional) vale o preço normal.
 */
export interface PromoFields {
  priceCents: number;
  promoPriceCents?: number | null;
  promoStartsAt?: string | Date | null;
  promoEndsAt?: string | Date | null;
}

const time = (d: string | Date | null | undefined) => (d == null ? null : new Date(d).getTime());

/** Preço promocional valendo agora, ou null. */
export function activePromoPrice(p: PromoFields, now: Date = new Date()): number | null {
  if (p.promoPriceCents == null || p.promoPriceCents >= p.priceCents) return null;
  const start = time(p.promoStartsAt);
  const end = time(p.promoEndsAt);
  const t = now.getTime();
  if (start != null && t < start) return null;
  if (end != null && t >= end) return null;
  return p.promoPriceCents;
}

/** Preço que o cliente paga hoje. */
export const effectivePrice = (p: PromoFields, now: Date = new Date()) => activePromoPrice(p, now) ?? p.priceCents;

/** Selo de desconto, arredondado para baixo (nunca promete mais do que dá): 118,00 → 69,90 = 40%. */
export function discountPct(listCents: number, promoCents: number): number {
  if (listCents <= 0 || promoCents >= listCents) return 0;
  return Math.floor(((listCents - promoCents) / listCents) * 100);
}
