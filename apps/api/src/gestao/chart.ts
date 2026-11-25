import type { AccountKind } from '@prisma/client';

/** Grupos do plano de contas de restaurante (o mesmo do plano de desenvolvimento). */
export const GROUPS: { group: number; name: string; kind: AccountKind }[] = [
  { group: 1, name: 'Receita bruta', kind: 'REVENUE' },
  { group: 2, name: 'Deduções da receita', kind: 'DEDUCTION' },
  { group: 3, name: 'CMV (custo da mercadoria vendida)', kind: 'EXPENSE' },
  { group: 4, name: 'Despesas com pessoal', kind: 'EXPENSE' },
  { group: 5, name: 'Despesas de ocupação', kind: 'EXPENSE' },
  { group: 6, name: 'Despesas de entrega', kind: 'EXPENSE' },
  { group: 7, name: 'Marketing', kind: 'EXPENSE' },
  { group: 8, name: 'Despesas administrativas', kind: 'EXPENSE' },
  { group: 9, name: 'Resultado financeiro', kind: 'FINANCIAL' },
  { group: 10, name: 'Investimentos e não operacional', kind: 'OFF_DRE' },
  { group: 11, name: 'Valores de terceiros', kind: 'OFF_DRE' },
];

export const groupOf = (group: number) => GROUPS.find((g) => g.group === group);

/** Contas que já vêm prontas para todo restaurante. */
export const DEFAULT_ACCOUNTS: [code: string, name: string][] = [
  ['1.1', 'Salão'],
  ['1.2', 'Delivery próprio (loja online)'],
  ['1.3', 'iFood'],
  ['1.4', 'Outros apps'],
  ['1.5', 'Eventos'],
  ['2.1', 'Impostos sobre venda (Simples, ISS, ICMS)'],
  ['2.2', 'Comissão de apps'],
  ['2.3', 'Taxas de cartão e PIX'],
  ['2.4', 'Descontos e cupons'],
  ['2.5', 'Cancelamentos e devoluções'],
  ['3.1', 'Alimentos'],
  ['3.2', 'Bebidas'],
  ['3.3', 'Embalagens'],
  ['3.4', 'Perdas e desperdício'],
  ['4.1', 'Salários'],
  ['4.2', 'Extras e adicionais'],
  ['4.3', 'Diaristas e freelancers'],
  ['4.4', 'Encargos (INSS, FGTS)'],
  ['4.5', 'Benefícios (VT, VA)'],
  ['4.6', 'Férias e 13º'],
  ['4.7', 'Pró-labore'],
  ['5.1', 'Aluguel e condomínio'],
  ['5.2', 'Energia'],
  ['5.3', 'Água'],
  ['5.4', 'Gás'],
  ['5.5', 'IPTU'],
  ['6.1', 'Motoboys'],
  ['6.2', 'Taxa de entrega de apps'],
  ['6.3', 'Combustível'],
  ['7.1', 'Anúncios Meta (Instagram/Facebook)'],
  ['7.2', 'Anúncios Google'],
  ['7.3', 'Promoções pagas nos apps'],
  ['7.4', 'Gráfica e fotos'],
  ['7.5', 'Agência e gestão de tráfego'],
  ['8.1', 'Contador'],
  ['8.2', 'Sistemas e softwares'],
  ['8.3', 'Internet e telefone'],
  ['8.4', 'Material de limpeza'],
  ['8.5', 'Manutenção'],
  ['9.1', 'Juros e tarifas bancárias'],
  ['9.2', 'Rendimentos'],
  ['9.3', 'Juros de empréstimos'],
  ['10.1', 'Equipamentos'],
  ['10.2', 'Reformas'],
  ['10.3', 'Retirada de sócios'],
  ['10.4', 'Amortização de empréstimos'],
  ['11.1', 'Gorjetas recebidas dos clientes'],
  ['11.2', 'Gorjetas repassadas aos motoboys'],
];

/** Data (AAAA-MM-DD) no fuso do restaurante. Por enquanto todos em Brasília. */
export function localDate(d: Date, timeZone = 'America/Sao_Paulo'): string {
  return d.toLocaleDateString('en-CA', { timeZone });
}

/** "2026-11-25" -> Date no formato que o Postgres guarda como DATE. */
export const toDbDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
