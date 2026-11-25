/**
 * Ficha técnica de custo (CMV) do produto. O mesmo cálculo roda na tela do produto,
 * na venda (custo gravado no pedido) e nos relatórios da Gestão.
 */

export type CostItemKind = 'INGREDIENT' | 'PACKAGING' | 'OTHER';

export const COST_KIND_LABELS: Record<CostItemKind, string> = {
  INGREDIENT: 'Ingrediente',
  PACKAGING: 'Embalagem',
  OTHER: 'Outro custo direto',
};

export interface CostItem {
  name: string;
  kind: CostItemKind;
  /** Custo deste item em uma unidade do produto (ex.: pão R$ 3,00). */
  costCents: number;
}

/** Percentuais em pontos-base (100 = 1%). */
export interface FinanceRates {
  /** Imposto sobre a venda (ex.: Simples Nacional). */
  salesTaxBps: number;
  pixFeeBps: number;
  /** Cartão de crédito pago online. */
  creditFeeBps: number;
  /** Maquininha na entrega. */
  cardOnDeliveryFeeBps: number;
  /** Meta de resultado por produto, usada no preço sugerido. */
  targetMarginBps: number;
}

export const DEFAULT_RATES: FinanceRates = { salesTaxBps: 0, pixFeeBps: 0, creditFeeBps: 0, cardOnDeliveryFeeBps: 0, targetMarginBps: 2000 };

/** Taxa da forma de pagamento (dinheiro não tem). */
export function paymentFeeBps(rates: FinanceRates, method: string): number {
  if (method === 'PIX') return rates.pixFeeBps;
  if (method === 'CREDIT_CARD') return rates.creditFeeBps;
  if (method === 'CARD_ON_DELIVERY') return rates.cardOnDeliveryFeeBps;
  return 0;
}

/** Na ficha técnica a taxa considerada é a maior entre as formas de pagamento (estimativa conservadora). */
export const worstFeeBps = (r: FinanceRates) => Math.max(r.pixFeeBps, r.creditFeeBps, r.cardOnDeliveryFeeBps);

export interface CostSheet {
  priceCents: number;
  ingredientsCents: number;
  packagingCents: number;
  otherDirectCents: number;
  /** CMV = ingredientes + embalagem + outros custos diretos */
  cmvCents: number;
  cmvPct: number | null;
  /** Impostos + taxa de pagamento + outras despesas % do produto */
  variablePct: number;
  variableCents: number;
  /** Lucro por unidade vendida */
  profitCents: number;
  resultPct: number | null;
  /** Preço para atingir a meta de resultado (null se a meta for impossível). */
  suggestedPriceCents: number | null;
  /** Situação do CMV pelo padrão de mercado em food service. */
  cmvHealth: 'good' | 'attention' | 'high' | 'none';
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function costSheet(priceCents: number, items: CostItem[], rates: FinanceRates, extraCostBps = 0): CostSheet {
  const sum = (k: CostItemKind) => items.filter((i) => i.kind === k).reduce((s, i) => s + i.costCents, 0);
  const ingredientsCents = sum('INGREDIENT');
  const packagingCents = sum('PACKAGING');
  const otherDirectCents = sum('OTHER');
  const cmvCents = ingredientsCents + packagingCents + otherDirectCents;
  const variableBps = rates.salesTaxBps + worstFeeBps(rates) + extraCostBps;
  const variableCents = Math.round((priceCents * variableBps) / 10_000);
  const profitCents = priceCents - cmvCents - variableCents;
  const free = 10_000 - variableBps - rates.targetMarginBps;
  const suggestedPriceCents = cmvCents > 0 && free > 0 ? Math.ceil((cmvCents * 10_000) / free / 10) * 10 : null;
  const cmvPct = pct(cmvCents, priceCents);
  return {
    priceCents,
    ingredientsCents,
    packagingCents,
    otherDirectCents,
    cmvCents,
    cmvPct,
    variablePct: variableBps / 100,
    variableCents,
    profitCents,
    resultPct: pct(profitCents, priceCents),
    suggestedPriceCents,
    // Referência de mercado: CMV até 30% do preço é saudável; acima de 40% come a margem.
    cmvHealth: cmvCents === 0 || cmvPct === null ? 'none' : cmvPct <= 30 ? 'good' : cmvPct <= 40 ? 'attention' : 'high',
  };
}

/** Custo de uma unidade vendida: ficha do produto + custo dos adicionais escolhidos. */
export function unitCost(items: CostItem[], optionCosts: number[] = []): number {
  return items.reduce((s, i) => s + i.costCents, 0) + optionCosts.reduce((s, c) => s + c, 0);
}
