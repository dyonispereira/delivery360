import { calcPayroll, daysInMonth, salaryDays } from './payroll';

const clt = { type: 'CLT' as const, salaryCents: 300_000, dailyRateCents: 0, transportCents: 30_000, mealCents: 0, admissionDate: '2025-01-10', terminationDate: null };
const rates = { fgtsBps: 800, employerInssBps: 0 };

describe('folha gerencial', () => {
  it('mês inteiro conta 30 dias; admissão e desligamento no mês são proporcionais', () => {
    expect(salaryDays('2026-02', '2025-01-01', null)).toBe(30);
    expect(salaryDays('2026-11', '2026-11-16', null)).toBe(15);
    expect(salaryDays('2026-11', '2025-01-01', '2026-11-10')).toBe(10);
    expect(salaryDays('2026-11', '2026-12-01', null)).toBe(0);
    expect(daysInMonth('2026-11', '2026-10-30', '2026-11-02')).toBe(2);
  });

  it('CLT: falta desconta 1/30, FGTS 8% e reserva de férias e 13º', () => {
    const r = calcPayroll('2026-11', clt, [{ kind: 'FALTA', startDate: '2026-11-03', endDate: '2026-11-04' }, { kind: 'ATESTADO', startDate: '2026-11-10', endDate: '2026-11-10' }], { extrasCents: 20_000, advanceCents: 100_000 }, rates);
    expect(r).toMatchObject({ days: 30, baseCents: 300_000, absenceDays: 2, absenceCents: 20_000, benefitsCents: 28_000 });
    const gross = 300_000 - 20_000 + 20_000;
    expect(r.chargesCents).toBe(24_000);
    const reserve = Math.round(gross / 12 + gross / 36 + gross / 12);
    expect(r.provisionCents).toBe(reserve + Math.round(reserve * 0.08));
    expect(r.netCents).toBe(gross - 100_000);
    expect(r.costCents).toBe(gross + 28_000 + 24_000 + r.provisionCents);
  });

  it('diarista recebe por diária, sem encargos nem reserva; PJ não desconta falta', () => {
    const d = calcPayroll('2026-11', { ...clt, type: 'DIARISTA', dailyRateCents: 12_000 }, [], { days: 8 }, rates);
    expect(d).toMatchObject({ baseCents: 96_000, chargesCents: 0, provisionCents: 0, benefitsCents: 0, netCents: 96_000 });
    const pj = calcPayroll('2026-11', { ...clt, type: 'PJ' }, [{ kind: 'FALTA', startDate: '2026-11-03', endDate: '2026-11-03' }], {}, rates);
    expect(pj).toMatchObject({ absenceCents: 0, chargesCents: 0, provisionCents: 0, netCents: 300_000 });
  });
});
