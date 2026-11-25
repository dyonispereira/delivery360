/**
 * Canais de venda: a loja própria e os apps de delivery (iFood, 99Food, Keeta).
 * O mesmo produto é identificado em todos os canais pelo código PDV; a receita fica separada por canal.
 */
import { costSheet, type CostItem, type CostSheet, type FinanceRates } from './costing';

export type SalesChannel = 'LOJA' | 'IFOOD' | 'FOOD99' | 'KEETA';
export const SALES_CHANNELS: SalesChannel[] = ['LOJA', 'IFOOD', 'FOOD99', 'KEETA'];
export const MARKETPLACES: Exclude<SalesChannel, 'LOJA'>[] = ['IFOOD', 'FOOD99', 'KEETA'];

export const CHANNEL_LABELS: Record<SalesChannel, string> = {
  LOJA: 'Loja própria',
  IFOOD: 'iFood',
  FOOD99: '99Food',
  KEETA: 'Keeta',
};

/** Conta de receita do plano de contas para cada canal. */
export const CHANNEL_REVENUE_ACCOUNT: Record<SalesChannel, string> = {
  LOJA: '1.2',
  IFOOD: '1.3',
  FOOD99: '1.6',
  KEETA: '1.7',
};

/** Configuração financeira de um app de delivery (percentuais em pontos-base, 100 = 1%). */
export interface ChannelConfig {
  channel: SalesChannel;
  active: boolean;
  /** Código da loja no app (merchant id), para a integração. */
  merchantId: string | null;
  /** Comissão do app sobre o pedido. */
  commissionBps: number;
  /** Taxa do app sobre pagamento online feito no app. */
  paymentFeeBps: number;
  /** Em quantos dias o app repassa o dinheiro dos pedidos pagos no app. */
  payoutDays: number;
}

/** Preço do produto em cada app (os apps costumam ter preço maior que a loja própria). */
export type ChannelPrices = Partial<Record<SalesChannel, number>>;

/**
 * Resultado do produto em cada canal: mesmo CMV, mas preço, comissão e taxa do canal.
 * No app a taxa considerada é a do pagamento online no app.
 */
export function channelSheets(
  basePriceCents: number,
  items: CostItem[],
  rates: FinanceRates,
  extraCostBps: number,
  channels: ChannelConfig[],
  prices: ChannelPrices = {},
): { channel: SalesChannel; sheet: CostSheet; commissionCents: number }[] {
  const out: { channel: SalesChannel; sheet: CostSheet; commissionCents: number }[] = [
    { channel: 'LOJA', sheet: costSheet(basePriceCents, items, rates, extraCostBps), commissionCents: 0 },
  ];
  for (const c of channels) {
    if (!c.active || c.channel === 'LOJA') continue;
    const price = prices[c.channel] ?? basePriceCents;
    const r: FinanceRates = { ...rates, pixFeeBps: c.paymentFeeBps, creditFeeBps: c.paymentFeeBps, cardOnDeliveryFeeBps: c.paymentFeeBps };
    const sheet = costSheet(price, items, r, extraCostBps + c.commissionBps);
    out.push({ channel: c.channel, sheet, commissionCents: Math.round((price * c.commissionBps) / 10_000) });
  }
  return out;
}
