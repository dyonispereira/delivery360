/**
 * Totem de autoatendimento: regras puras do carrinho e do pedido.
 *
 * Dois modos:
 * - demonstração (/totem/<slug>): calcula tudo aqui, não cria pedido e não cobra ninguém;
 * - real (/totem/<slug>?t=<id do totem>): cria o pedido "aguardando pagamento" e mostra a senha.
 *   O cliente paga no caixa (maquininha comum, Pix ou dinheiro); o caixa confirma no PDV e só então
 *   o pedido vai para o painel e a cozinha. Sem integração com maquininha por enquanto.
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

/** Modo real: como o cliente diz que vai pagar no caixa (só um aviso; o caixa registra o que entrou de fato). */
export type TotemPayHint = 'CARD' | 'PIX' | 'CASH';
export const TOTEM_PAY_HINT_LABELS: Record<TotemPayHint, string> = { CARD: 'Cartão', PIX: 'Pix', CASH: 'Dinheiro' };

/** Configuração pública de um totem (o que a tela precisa para funcionar). */
export interface PublicTotem {
  id: string;
  name: string;
  active: boolean;
  modes: TotemConsumption[];
}

/** Cadastro do totem no painel. */
export interface TotemView {
  id: string;
  name: string;
  active: boolean;
  eatIn: boolean;
  takeaway: boolean;
  createdAt: string;
}

/** Pedido do totem esperando o pagamento no caixa. */
export interface TotemPendingOrder {
  id: string;
  number: number;
  ticket: string;
  consumption: TotemConsumption | null;
  payHint: TotemPayHint | null;
  totemName: string | null;
  totalCents: number;
  createdAt: string;
  items: { name: string; quantity: number; options: string[]; notes: string | null }[];
}

/** Resposta do totem depois de criar o pedido. */
export interface TotemOrderResult {
  number: number;
  ticket: string;
  totalCents: number;
  consumption: TotemConsumption;
}

/** Modos de consumo ligados no cadastro do totem (nenhum ligado = os dois). */
export function totemModes(cfg: { eatIn: boolean; takeaway: boolean }): TotemConsumption[] {
  const modes: TotemConsumption[] = [];
  if (cfg.eatIn) modes.push('EAT_IN');
  if (cfg.takeaway) modes.push('TAKEAWAY');
  return modes.length ? modes : ['EAT_IN', 'TAKEAWAY'];
}

/**
 * Senha de chamada do pedido real: 3 dígitos a partir do número do pedido (100 a 999, depois recomeça).
 * Curta para falar em voz alta e única dentro de 900 pedidos seguidos.
 */
export function totemTicket(orderNumber: number): string {
  const n = Math.max(1, Math.floor(orderNumber));
  return String(((n - 1) % 900) + 100);
}

/** O pedido do totem que não foi pago some da lista do caixa depois disto (não entra em nada). */
export const TOTEM_UNPAID_HOURS = 3;

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
 * Quais modos de consumo a loja oferece no demo (?consumo=aqui, levar ou ambos).
 * No modo real vem do cadastro do totem (`totemModes`).
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
