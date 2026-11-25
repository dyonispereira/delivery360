import { buildDre, type DreInput } from './dre';

const row = (code: string, group: number, kind: DreInput['kind'], type: DreInput['type'], amountCents: number): DreInput => ({
  code,
  name: code,
  group,
  kind,
  type,
  amountCents,
});

describe('DRE', () => {
  const lines = buildDre([
    row('1.2', 1, 'REVENUE', 'RECEIVABLE', 100_000),
    row('2.3', 2, 'DEDUCTION', 'PAYABLE', 3_000),
    row('3.1', 3, 'EXPENSE', 'PAYABLE', 30_000),
    row('4.1', 4, 'EXPENSE', 'PAYABLE', 20_000),
    row('6.1', 6, 'EXPENSE', 'PAYABLE', 7_000),
    row('9.1', 9, 'FINANCIAL', 'PAYABLE', 500),
    row('9.2', 9, 'FINANCIAL', 'RECEIVABLE', 200),
    row('10.3', 10, 'OFF_DRE', 'PAYABLE', 50_000),
    row('11.1', 11, 'OFF_DRE', 'RECEIVABLE', 1_000),
  ]);
  const v = (key: string) => lines.find((l) => l.key === key)!.valueCents;

  it('segue a cascata: receita líquida, lucro bruto, operacional e líquido', () => {
    expect(v('g1')).toBe(100_000);
    expect(v('g2')).toBe(-3_000);
    expect(v('net')).toBe(97_000);
    expect(v('grossProfit')).toBe(67_000);
    expect(v('ebitda')).toBe(40_000);
    expect(v('g9')).toBe(-300);
    expect(v('netProfit')).toBe(39_700);
  });

  it('retirada de sócio e gorjetas não entram no resultado', () => {
    expect(lines.some((l) => l.key === 'g10' || l.key === 'g11')).toBe(false);
  });

  it('calcula % sobre a receita bruta', () => {
    expect(lines.find((l) => l.key === 'netProfit')!.pct).toBe(39.7);
  });

  it('sem receita, percentuais ficam vazios', () => {
    expect(buildDre([row('5.1', 5, 'EXPENSE', 'PAYABLE', 1000)]).find((l) => l.key === 'netProfit')).toMatchObject({ valueCents: -1000, pct: null });
  });
});
