import type { PaymentMethod } from './orders';

/** Formas de pagamento do balcão. O cartão é passado na maquininha (crédito ou débito, para a nota). */
export const PDV_PAYMENT_METHODS: { key: PdvPayKey; method: PaymentMethod; cardKind: 'CREDIT' | 'DEBIT' | null; label: string }[] = [
  { key: 'CASH', method: 'CASH_ON_DELIVERY', cardKind: null, label: 'Dinheiro' },
  { key: 'PIX', method: 'PIX', cardKind: null, label: 'Pix' },
  { key: 'DEBIT', method: 'CARD_ON_DELIVERY', cardKind: 'DEBIT', label: 'Débito' },
  { key: 'CREDIT', method: 'CARD_ON_DELIVERY', cardKind: 'CREDIT', label: 'Crédito' },
];
export type PdvPayKey = 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT';

export function pdvPayLabel(method: PaymentMethod, cardKind?: string | null) {
  return PDV_PAYMENT_METHODS.find((m) => m.method === method && (m.cardKind ?? null) === (cardKind ?? null))?.label ?? (method === 'CARD_ON_DELIVERY' ? 'Cartão' : method);
}

export type ReceiptKind = 'NAO_FISCAL' | 'NFCE';

export interface PdvPaymentInput {
  key: PdvPayKey;
  amountCents: number;
  /** Só dinheiro: quanto o cliente entregou (o troco sai da diferença). */
  receivedCents?: number;
}

export interface SettledPayment {
  key: PdvPayKey;
  method: PaymentMethod;
  cardKind: 'CREDIT' | 'DEBIT' | null;
  amountCents: number;
  receivedCents: number | null;
  changeCents: number;
}

export class PdvPaymentError extends Error {}

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

/**
 * Confere os pagamentos da venda: precisam somar o total. Só o dinheiro pode vir a mais
 * (o cliente entrega R$ 50 numa venda de R$ 42 → troco de R$ 8).
 */
export function settlePayments(totalCents: number, input: PdvPaymentInput[]): SettledPayment[] {
  if (!input.length) throw new PdvPaymentError('Escolha a forma de pagamento.');
  const out = input.map((p) => {
    const m = PDV_PAYMENT_METHODS.find((x) => x.key === p.key);
    if (!m) throw new PdvPaymentError('Forma de pagamento inválida.');
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new PdvPaymentError('Informe o valor de cada pagamento.');
    let receivedCents: number | null = null;
    let changeCents = 0;
    if (p.key === 'CASH' && p.receivedCents != null) {
      if (p.receivedCents < p.amountCents) throw new PdvPaymentError(`O cliente entregou ${brl(p.receivedCents)}, menos que ${brl(p.amountCents)} em dinheiro.`);
      receivedCents = p.receivedCents;
      changeCents = p.receivedCents - p.amountCents;
    }
    return { key: m.key, method: m.method, cardKind: m.cardKind, amountCents: p.amountCents, receivedCents, changeCents };
  });
  const paid = out.reduce((s, p) => s + p.amountCents, 0);
  if (paid < totalCents) throw new PdvPaymentError(`Falta receber ${brl(totalCents - paid)}.`);
  if (paid > totalCents) throw new PdvPaymentError(`Os pagamentos passam do total em ${brl(paid - totalCents)}. No dinheiro, informe o valor entregue para calcular o troco.`);
  return out;
}

/** Resumo do caixa: o que entrou por forma de pagamento e quanto deveria ter na gaveta. */
export interface CashSummary {
  openingCents: number;
  /** Por forma de pagamento (Dinheiro, Pix, Débito, Crédito), somando PDV e salão. */
  byMethod: { label: string; pdvCents: number; salaoCents: number; totalCents: number }[];
  salesCount: number;
  salesCents: number;
  cancelledCount: number;
  cashSalesCents: number;
  changeCents: number;
  suprimentoCents: number;
  sangriaCents: number;
  expectedCashCents: number;
}

export interface CashSessionView {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  countedCents: number | null;
  expectedCents: number | null;
  differenceCents: number | null;
  notes: string | null;
  summary: CashSummary;
  movements: { id: string; kind: 'SANGRIA' | 'SUPRIMENTO'; amountCents: number; reason: string | null; userName: string | null; createdAt: string }[];
}

export interface PdvSaleRow {
  id: string;
  number: number;
  createdAt: string;
  status: string;
  totalCents: number;
  customerName: string;
  payments: string;
  receipt: ReceiptKind;
  fiscalStatus: string | null;
}

/** Cupom pronto para imprimir (térmica) ou virar PDF: o mesmo conteúdo nos dois. */
export interface Receipt {
  kind: ReceiptKind;
  orderId: string;
  number: number;
  /** Em homologação a nota não tem valor fiscal (aviso obrigatório no cupom). */
  test: boolean;
  store: { name: string; legalName: string | null; cnpj: string | null; stateRegistration: string | null; address: string | null; phone: string | null };
  issuedAt: string;
  customer: { name: string | null; document: string | null };
  items: { code: string; name: string; quantity: number; unitCents: number; totalCents: number; options: string[] }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  payments: { label: string; amountCents: number }[];
  changeCents: number;
  fiscal: {
    status: 'PROCESSING' | 'AUTHORIZED' | 'REJECTED' | 'CANCELLED';
    series: number;
    number: number;
    accessKey: string | null;
    protocol: string | null;
    authorizedAt: string | null;
    qrCodeUrl: string | null;
    consultUrl: string | null;
    message: string | null;
  } | null;
  footer: string | null;
  widthMm: number;
  copies: number;
}

/** Chave de acesso em blocos de 4 (como sai no cupom). */
export const formatAccessKey = (k: string) => k.replace(/(\d{4})(?=\d)/g, '$1 ');

export function formatDocument(d: string | null | undefined) {
  const x = (d ?? '').replace(/\D/g, '');
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d ?? '';
}
