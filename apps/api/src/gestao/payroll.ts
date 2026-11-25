/**
 * Folha gerencial: quanto cada pessoa custa no mês para o restaurante.
 * Não calcula INSS/IRRF descontados do funcionário (isso fica com o contador / eSocial):
 * o valor "a pagar" é o bruto menos faltas e adiantamentos.
 */

export type EmploymentType = 'CLT' | 'PJ' | 'DIARISTA' | 'ESTAGIO';
export type AbsenceKind = 'FOLGA' | 'FERIAS' | 'ATESTADO' | 'FALTA';

export interface PayrollEmployee {
  type: EmploymentType;
  salaryCents: number;
  dailyRateCents: number;
  transportCents: number;
  mealCents: number;
  /** AAAA-MM-DD */
  admissionDate: string;
  terminationDate: string | null;
}

export interface PayrollInputs {
  /** Diárias trabalhadas (só diarista). */
  days?: number;
  extrasCents?: number;
  bonusCents?: number;
  advanceCents?: number;
}

export interface PayrollRates {
  fgtsBps: number;
  employerInssBps: number;
}

export interface PayrollCalc {
  days: number;
  baseCents: number;
  absenceDays: number;
  absenceCents: number;
  extrasCents: number;
  bonusCents: number;
  advanceCents: number;
  benefitsCents: number;
  chargesCents: number;
  provisionCents: number;
  /** Bruto − faltas − adiantamentos (o que falta pagar ao funcionário). */
  netCents: number;
  /** Custo total do mês para o restaurante. */
  costCents: number;
}

const COMMERCIAL_MONTH = 30;

/** Último dia do mês "2026-11" -> 30. */
export const monthDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Dias de salário no mês (mês comercial de 30 dias), proporcional a admissão e desligamento. */
export function salaryDays(month: string, admission: string, termination: string | null): number {
  const last = monthDays(month);
  const first = `${month}-01`;
  const end = `${month}-${String(last).padStart(2, '0')}`;
  if (admission > end || (termination && termination < first)) return 0;
  const from = admission > first ? Number(admission.slice(8)) : 1;
  const to = termination && termination < end ? Number(termination.slice(8)) : last;
  // Mês inteiro conta 30, mesmo em fevereiro ou em mês de 31 dias.
  if (from === 1 && to === last) return COMMERCIAL_MONTH;
  return Math.min(COMMERCIAL_MONTH, to - from + 1);
}

/** Quantos dias de um período caem dentro do mês. */
export function daysInMonth(month: string, start: string, end: string): number {
  const last = monthDays(month);
  const first = `${month}-01`;
  const monthEnd = `${month}-${String(last).padStart(2, '0')}`;
  const a = start > first ? start : first;
  const b = end < monthEnd ? end : monthEnd;
  if (a > b) return 0;
  return Number(b.slice(8)) - Number(a.slice(8)) + 1;
}

const bps = (v: number, b: number) => Math.round((v * b) / 10_000);

export function calcPayroll(
  month: string,
  e: PayrollEmployee,
  absences: { kind: AbsenceKind; startDate: string; endDate: string }[],
  inputs: PayrollInputs,
  rates: PayrollRates,
): PayrollCalc {
  const extrasCents = inputs.extrasCents ?? 0;
  const bonusCents = inputs.bonusCents ?? 0;
  const advanceCents = inputs.advanceCents ?? 0;
  const monthly = e.type !== 'DIARISTA';

  const days = monthly ? salaryDays(month, e.admissionDate, e.terminationDate) : Math.max(0, inputs.days ?? 0);
  const baseCents = monthly ? Math.round((e.salaryCents * days) / COMMERCIAL_MONTH) : e.dailyRateCents * days;

  // Falta sem justificativa desconta 1/30 do salário por dia (CLT e estágio; PJ e diarista não).
  const discountsAbsence = e.type === 'CLT' || e.type === 'ESTAGIO';
  const absenceDays = discountsAbsence
    ? Math.min(days, absences.filter((a) => a.kind === 'FALTA').reduce((t, a) => t + daysInMonth(month, a.startDate, a.endDate), 0))
    : 0;
  const absenceCents = Math.round((e.salaryCents * absenceDays) / COMMERCIAL_MONTH);

  // Vale-transporte e alimentação: proporcionais aos dias de salário, sem os dias de falta.
  const benefitDays = monthly ? Math.max(0, days - absenceDays) : 0;
  const benefitsCents = monthly ? Math.round(((e.transportCents + e.mealCents) * benefitDays) / COMMERCIAL_MONTH) : 0;

  const gross = Math.max(0, baseCents - absenceCents) + extrasCents + bonusCents;
  let chargesCents = 0;
  let provisionCents = 0;
  if (e.type === 'CLT') {
    const chargeBps = rates.fgtsBps + rates.employerInssBps;
    chargesCents = bps(gross, chargeBps);
    // Reserva do mês: férias (1/12) + 1/3 de férias (1/36) + 13º (1/12), com os encargos sobre ela.
    const reserve = Math.round(gross / 12 + gross / 36 + gross / 12);
    provisionCents = reserve + bps(reserve, chargeBps);
  } else if (e.type === 'ESTAGIO') {
    // Recesso remunerado de 30 dias por ano.
    provisionCents = Math.round(gross / 12);
  }

  const netCents = gross - advanceCents;
  return {
    days,
    baseCents,
    absenceDays,
    absenceCents,
    extrasCents,
    bonusCents,
    advanceCents,
    benefitsCents,
    chargesCents,
    provisionCents,
    netCents,
    costCents: gross + benefitsCents + chargesCents + provisionCents,
  };
}
