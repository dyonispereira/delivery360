import { brDate, checkSlot, releaseAt, scheduleLabel, scheduleSlots, type ScheduleRules } from './schedule';

const rules = (over: Partial<ScheduleRules> = {}): ScheduleRules => ({
  schedulingEnabled: true,
  scheduleOpensAt: '18:00',
  scheduleClosesAt: '23:00',
  scheduleWeekdays: [],
  scheduleLeadMinutes: 60,
  scheduleMaxDays: 2,
  scheduleSlotMinutes: 30,
  ...over,
});
// Sábado, 28/11/2026, 19:10 em Brasília.
const now = new Date('2026-11-28T19:10:00-03:00');
const local = (iso: string) => scheduleLabel(new Date(iso));

describe('pedido agendado', () => {
  it('hoje só a partir da antecedência; depois os dias seguintes inteiros', () => {
    const days = scheduleSlots(rules(), now);
    expect(days.map((d) => d.label)).toEqual(['Hoje', 'Amanhã', 'segunda, 30/11']);
    expect(days[0].slots.map(local)).toEqual(['sáb 28/11 às 20:30', 'sáb 28/11 às 21:00', 'sáb 28/11 às 21:30', 'sáb 28/11 às 22:00', 'sáb 28/11 às 22:30', 'sáb 28/11 às 23:00']);
    expect(days[1].slots).toHaveLength(11);
    expect(local(days[1].slots[0])).toBe('dom 29/11 às 18:00');
  });

  it('desligado ou dia da semana fora: sem horários', () => {
    expect(scheduleSlots(rules({ schedulingEnabled: false }), now)).toEqual([]);
    const onlyMonday = scheduleSlots(rules({ scheduleWeekdays: [1] }), now);
    expect(onlyMonday.map((d) => d.date)).toEqual(['2026-11-30']);
  });

  it('janela que passa da meia-noite', () => {
    const late = new Date('2026-11-29T00:20:00-03:00');
    const days = scheduleSlots(rules({ scheduleOpensAt: '19:00', scheduleClosesAt: '02:00', scheduleLeadMinutes: 30 }), late);
    expect(days[0].slots.map(local)).toEqual(['dom 29/11 às 01:00', 'dom 29/11 às 01:30', 'dom 29/11 às 02:00']);
  });

  it('confere o horário escolhido', () => {
    expect(checkSlot(rules(), '2026-11-28T23:30:00.000Z', now).toISOString()).toBe('2026-11-28T23:30:00.000Z');
    expect(() => checkSlot(rules(), '2026-11-28T22:30:00.000Z', now)).toThrow('pelo menos 60 minutos');
    expect(() => checkSlot(rules(), '2026-11-28T23:40:00.000Z', now)).toThrow('não está disponível');
    expect(() => checkSlot(rules(), '2026-12-05T23:00:00.000Z', now)).toThrow('não está disponível');
    expect(() => checkSlot(rules({ schedulingEnabled: false }), '2026-11-28T23:30:00.000Z', now)).toThrow('não está aceitando');
  });

  it('entra na cozinha no horário menos o tempo da loja', () => {
    expect(releaseAt(new Date('2026-11-28T23:00:00Z'), 40).toISOString()).toBe('2026-11-28T22:20:00.000Z');
    expect(brDate(new Date('2026-11-29T02:00:00Z'))).toBe('2026-11-28');
  });
});
