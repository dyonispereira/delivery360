import type { AccountKind } from '@prisma/client';
import { GROUPS } from './chart';

export interface DreInput {
  code: string;
  name: string;
  group: number;
  kind: AccountKind;
  type: 'RECEIVABLE' | 'PAYABLE';
  amountCents: number;
}

export interface DreLine {
  key: string;
  label: string;
  /** Linhas de soma (Receita líquida, Lucro bruto...) */
  total?: boolean;
  valueCents: number;
  /** % sobre a receita bruta */
  pct: number | null;
  accounts?: { code: string; name: string; valueCents: number }[];
}

/**
 * Monta a DRE pelo regime de competência:
 * Receita bruta − Deduções = Receita líquida − CMV = Lucro bruto − Despesas operacionais
 * = Resultado operacional ± Resultado financeiro = Lucro líquido. Grupos 10 e 11 ficam de fora.
 *
 * Sinal: na receita, um título a receber soma e um a pagar (ex.: estorno) subtrai;
 * nos demais grupos, a pagar é custo (soma no grupo) e a receber reduz (ex.: rendimento no grupo 9).
 */
export function buildDre(rows: DreInput[]): DreLine[] {
  const byGroup = new Map<number, Map<string, { code: string; name: string; valueCents: number }>>();
  for (const r of rows) {
    if (r.kind === 'OFF_DRE') continue;
    // Valor "natural" do grupo: receita positiva; custo positivo (será subtraído).
    const natural = r.kind === 'REVENUE' ? (r.type === 'RECEIVABLE' ? 1 : -1) : r.type === 'PAYABLE' ? 1 : -1;
    const g = byGroup.get(r.group) ?? new Map();
    const acc = g.get(r.code) ?? { code: r.code, name: r.name, valueCents: 0 };
    acc.valueCents += natural * r.amountCents;
    g.set(r.code, acc);
    byGroup.set(r.group, g);
  }
  const sumGroup = (n: number) => [...(byGroup.get(n)?.values() ?? [])].reduce((s, a) => s + a.valueCents, 0);
  const accounts = (n: number) => [...(byGroup.get(n)?.values() ?? [])].filter((a) => a.valueCents !== 0).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
  const name = (n: number) => GROUPS.find((g) => g.group === n)!.name;

  const gross = sumGroup(1);
  const pct = (v: number) => (gross ? Math.round((v / gross) * 1000) / 10 : null);
  const lines: DreLine[] = [];
  const group = (n: number, sign: 1 | -1) => {
    const v = sign * sumGroup(n);
    lines.push({ key: `g${n}`, label: name(n), valueCents: v, pct: pct(v), accounts: accounts(n).map((a) => ({ ...a, valueCents: sign * a.valueCents })) });
    return v;
  };
  const total = (key: string, label: string, v: number) => lines.push({ key, label, total: true, valueCents: v, pct: pct(v) });

  let acc = group(1, 1);
  acc += group(2, -1);
  total('net', 'Receita líquida', acc);
  acc += group(3, -1);
  total('grossProfit', 'Lucro bruto', acc);
  for (const n of [4, 5, 6, 7, 8]) acc += group(n, -1);
  total('ebitda', 'Resultado operacional', acc);
  // Grupo 9: custo (a pagar) reduz; rendimento (a receber) aumenta.
  acc += group(9, -1);
  total('netProfit', 'Lucro líquido', acc);
  return lines;
}
