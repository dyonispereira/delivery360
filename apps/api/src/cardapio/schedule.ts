/**
 * Pedido agendado (funções puras). Horários no fuso de Brasília (UTC−3, sem horário de verão desde 2019),
 * o mesmo usado no financeiro.
 */

export interface ScheduleRules {
  schedulingEnabled: boolean;
  /** "HH:MM" */
  scheduleOpensAt: string;
  scheduleClosesAt: string;
  /** 0 = domingo. Vazio = todos os dias. */
  scheduleWeekdays: number[];
  scheduleLeadMinutes: number;
  scheduleMaxDays: number;
  scheduleSlotMinutes: number;
}

export class ScheduleError extends Error {}

const OFFSET = '-03:00';
const MIN = 60_000;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Data local (AAAA-MM-DD) em Brasília. */
export function brDate(d: Date): string {
  return new Date(d.getTime() - 3 * 60 * MIN).toISOString().slice(0, 10);
}
/** "2026-11-28" + minutos desde meia-noite (pode passar de 24h) → instante. */
function at(day: string, minutes: number): Date {
  return new Date(new Date(`${day}T00:00:00${OFFSET}`).getTime() + minutes * MIN);
}
function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export interface ScheduleDay {
  /** Dia em que a janela abre (AAAA-MM-DD). */
  date: string;
  /** "Hoje", "Amanhã" ou "sábado, 29/11". */
  label: string;
  /** Horários em ISO (UTC). */
  slots: string[];
}

/** Horários que o cliente pode escolher a partir de agora, agrupados por dia. */
export function scheduleSlots(r: ScheduleRules, now = new Date()): ScheduleDay[] {
  if (!r.schedulingEnabled || !HHMM.test(r.scheduleOpensAt) || !HHMM.test(r.scheduleClosesAt)) return [];
  const step = Math.max(10, r.scheduleSlotMinutes);
  const open = toMinutes(r.scheduleOpensAt);
  let close = toMinutes(r.scheduleClosesAt);
  if (close <= open) close += 24 * 60; // passa da meia-noite
  const earliest = now.getTime() + Math.max(0, r.scheduleLeadMinutes) * MIN;
  const today = brDate(now);
  const days: ScheduleDay[] = [];
  // Começa ontem: uma janela que passa da meia-noite pode ainda estar aberta.
  for (let i = -1; i <= Math.max(0, r.scheduleMaxDays); i++) {
    const day = addDays(today, i);
    if (r.scheduleWeekdays.length && !r.scheduleWeekdays.includes(weekday(day))) continue;
    const slots: string[] = [];
    for (let m = open; m <= close; m += step) {
      const t = at(day, m);
      if (t.getTime() >= earliest && t.getTime() <= now.getTime() + (r.scheduleMaxDays + 1) * 24 * 60 * MIN) slots.push(t.toISOString());
    }
    if (!slots.length) continue;
    const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : i === -1 ? 'Hoje (madrugada)' : `${WEEKDAYS[weekday(day)]}, ${day.slice(8, 10)}/${day.slice(5, 7)}`;
    days.push({ date: day, label, slots });
  }
  return days;
}

/** Confere o horário escolhido: precisa ser um dos horários oferecidos agora. */
export function checkSlot(r: ScheduleRules, iso: string, now = new Date()): Date {
  if (!r.schedulingEnabled) throw new ScheduleError('Esta loja não está aceitando pedidos agendados.');
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new ScheduleError('Horário inválido.');
  const ok = scheduleSlots(r, now).some((d) => d.slots.some((s) => new Date(s).getTime() === t.getTime()));
  if (!ok) {
    if (t.getTime() < now.getTime() + r.scheduleLeadMinutes * MIN) {
      throw new ScheduleError(`Agende com pelo menos ${r.scheduleLeadMinutes} minutos de antecedência.`);
    }
    throw new ScheduleError('Esse horário não está disponível. Escolha outro.');
  }
  return t;
}

/** Quando o pedido agendado entra na cozinha: horário − tempo de preparo/entrega da loja. */
export function releaseAt(scheduledFor: Date, prepMinutes: number): Date {
  return new Date(scheduledFor.getTime() - Math.max(0, prepMinutes) * MIN);
}

/** "sáb 29/11 às 20:00" no horário de Brasília. */
export function scheduleLabel(d: Date): string {
  const local = new Date(d.getTime() - 3 * 60 * MIN);
  const day = local.toISOString().slice(0, 10);
  const hm = local.toISOString().slice(11, 16);
  return `${WEEKDAYS[local.getUTCDay()].slice(0, 3)} ${day.slice(8, 10)}/${day.slice(5, 7)} às ${hm}`;
}
