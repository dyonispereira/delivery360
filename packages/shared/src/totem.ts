/**
 * Totem de autoatendimento: regras puras do carrinho (sem servidor).
 *
 * Nesta primeira etapa o totem roda em modo demonstração: lê o cardápio público da loja,
 * calcula tudo aqui e não cria pedido, não mexe no caixa e não cobra ninguém.
 */
import type { PublicOptionGroup, PublicProduct } from './orders';

/** Como aparece no cupom e nos relatórios quando o totem for para a operação real. */
export const TOTEM_ORIGIN_LABEL = 'Totem (autoatendimento)';

/** Tipo de consumo escolhido no início (separado da origem e da forma de pagamento). */
export type TotemConsumption = 'EAT_IN' | 'TAKEAWAY';
export const TOTEM_CONSUMPTION_LABELS: Record<TotemConsumption, string> = {
  EAT_IN: 'Comer aqui',
  TAKEAWAY: 'Levar',
};

export type TotemPayMethod = 'PIX' | 'CARD';
export const TOTEM_PAY_LABELS: Record<TotemPayMethod, string> = { PIX: 'Pix', CARD: 'Cartão' };

/** Inatividade: aviso depois de 60 s sem toque; mais 20 s sem resposta e a sessão recomeça. */
export const TOTEM_IDLE_WARN_MS = 60_000;
export const TOTEM_IDLE_GRACE_S = 20;
/** Tela de confirmação: volta sozinha ao início depois disto. */
export const TOTEM_DONE_RETURN_S = 20;

export interface TotemLine {
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  optionIds: string[];
  optionNames: string[];
  notes: string;
  quantity: number;
  /** Preço de uma unidade com os adicionais escolhidos. */
  unitPriceCents: number;
}

/**
 * Quais modos de consumo a loja oferece. No demo vem do endereço (?consumo=aqui, levar ou ambos);
 * na etapa real vem da configuração do totem.
 */
export function consumptionModes(param: string | null | undefined): TotemConsumption[] {
  const p = (param ?? '').trim().toLowerCase();
  if (p === 'aqui') return ['EAT_IN'];
  if (p === 'levar') return ['TAKEAWAY'];
  return ['EAT_IN', 'TAKEAWAY'];
}

/** Toque numa opção: grupo de escolha única troca a opção; nos outros liga/desliga até o máximo. */
export function toggleOption(group: PublicOptionGroup, picked: string[], optionId: string): string[] {
  const option = group.options.find((o) => o.id === optionId);
  if (!option || !option.available) return picked;
  const ids = new Set(group.options.map((o) => o.id));
  const inGroup = picked.filter((id) => ids.has(id));
  const others = picked.filter((id) => !ids.has(id));
  if (inGroup.includes(optionId)) return [...others, ...inGroup.filter((id) => id !== optionId)];
  if (group.maxSelect === 1) return [...others, optionId];
  if (group.maxSelect > 0 && inGroup.length >= group.maxSelect) return picked;
  return [...others, ...inGroup, optionId];
}

/** O que falta escolher no produto (vazio = pode adicionar). Mesmas mensagens da loja online. */
export function selectionErrors(product: PublicProduct, picked: string[]): string[] {
  const errors: string[] = [];
  for (const g of product.optionGroups) {
    const n = g.options.filter((o) => picked.includes(o.id)).length;
    if (n < g.minSelect) errors.push(g.minSelect === 1 ? `Escolha uma opção em "${g.name}".` : `Escolha pelo menos ${g.minSelect} opções em "${g.name}".`);
    if (g.maxSelect > 0 && n > g.maxSelect) errors.push(`Escolha no máximo ${g.maxSelect} em "${g.name}".`);
  }
  return errors;
}

/** Preço de uma unidade: produto (já com a promoção do dia) + adicionais escolhidos. */
export function unitPrice(product: PublicProduct, picked: string[]): number {
  const extras = product.optionGroups.flatMap((g) => g.options).filter((o) => picked.includes(o.id));
  return product.priceCents + extras.reduce((s, o) => s + o.priceCents, 0);
}

/** Nomes das opções na ordem dos grupos (para o carrinho e o cupom). */
export function optionNames(product: PublicProduct, picked: string[]): string[] {
  return product.optionGroups.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).map((o) => o.name);
}

export function lineTotal(line: Pick<TotemLine, 'unitPriceCents' | 'quantity'>): number {
  return line.unitPriceCents * line.quantity;
}

export function cartTotals(lines: TotemLine[]) {
  return {
    items: lines.reduce((s, l) => s + l.quantity, 0),
    totalCents: lines.reduce((s, l) => s + lineTotal(l), 0),
  };
}

/** Muda a quantidade (1 a 20). Zero ou menos tira o item. */
export function setQuantity(lines: TotemLine[], key: string, quantity: number): TotemLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, Math.floor(quantity)) } : l));
}

/** Coloca o item no carrinho, ou troca o item que estava sendo editado (mantém a posição). */
export function upsertLine(lines: TotemLine[], line: TotemLine): TotemLine[] {
  return lines.some((l) => l.key === line.key) ? lines.map((l) => (l.key === line.key ? line : l)) : [...lines, line];
}

/** Senha de demonstração para chamar o cliente no balcão (3 dígitos, nunca começa com zero). */
export function demoTicket(random: () => number = Math.random): string {
  return String(100 + Math.floor(random() * 900));
}
