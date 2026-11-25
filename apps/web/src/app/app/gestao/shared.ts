'use client';

export type EntryType = 'RECEIVABLE' | 'PAYABLE';
export type EntryStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export interface Account {
  id: string;
  code: string;
  name: string;
  group: number;
  kind: 'REVENUE' | 'DEDUCTION' | 'EXPENSE' | 'FINANCIAL' | 'OFF_DRE';
  system: boolean;
  active: boolean;
}
export interface AccountGroup {
  group: number;
  name: string;
  kind: Account['kind'];
  accounts: Account[];
}
export interface Entry {
  id: string;
  paymentMethod: string | null;
  type: EntryType;
  description: string;
  counterparty: string | null;
  amountCents: number;
  competenceDate: string;
  dueDate: string;
  status: EntryStatus;
  paidAt: string | null;
  notes: string | null;
  source: string;
  account: { id: string; code: string; name: string; group: number };
}

/** Hoje (AAAA-MM-DD) no horário de Brasília. */
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const monthStart = (d = todayStr()) => `${d.slice(0, 8)}01`;
export const monthEnd = (d = todayStr()) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const shiftMonth = (d: string, n: number) => {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
/** "2026-11-25" -> "25/11/2026" */
export const br = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
export const monthLabel = (d: string) => {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', cardapio: 'Pedidos', entregas: 'Entregas', pessoas: 'Folha' };
