'use client';

import { useEffect, useState } from 'react';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';

interface Scheduling {
  schedulingEnabled: boolean;
  scheduleOpensAt: string;
  scheduleClosesAt: string;
  scheduleWeekdays: number[];
  scheduleLeadMinutes: number;
  scheduleMaxDays: number;
  scheduleSlotMinutes: number;
  estimatedMinutes: number;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const KEYS: (keyof Scheduling)[] = ['schedulingEnabled', 'scheduleOpensAt', 'scheduleClosesAt', 'scheduleWeekdays', 'scheduleLeadMinutes', 'scheduleMaxDays', 'scheduleSlotMinutes'];

/** Pedido agendado: o cliente escolhe dia e horário. Vale também com a loja fechada. */
export function SchedulingSettings({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = useState<Scheduling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Scheduling>('/cardapio/store', { tenant: true })
      .then(setForm)
      .catch((e) => setError(e.message));
  }, []);
  if (!form) return error ? <ErrorBox message={error} /> : <Spinner />;
  const set = <K extends keyof Scheduling>(k: K, v: Scheduling[K]) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };

  async function save(patch?: Partial<Scheduling>) {
    if (!form) return;
    setError(null);
    try {
      const body = patch ?? Object.fromEntries(KEYS.map((k) => [k, form[k]]));
      const s = await api<Scheduling>('/cardapio/store', { method: 'PUT', tenant: true, body });
      setForm(s);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Pedido agendado</h2>
          <p className="text-sm text-zinc-500">
            O cliente escolhe o dia e o horário no carrinho, mesmo com a loja fechada agora. O pedido fica em &quot;Agendados&quot; no painel e entra na cozinha {form.estimatedMinutes}{' '}
            minutos antes do horário (o tempo estimado da loja).
          </p>
        </div>
        <Toggle checked={form.schedulingEnabled} disabled={!canEdit} onChange={(v) => save({ schedulingEnabled: v })} />
      </div>
      {form.schedulingEnabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <label className="label" htmlFor="sc-open">Horários de</label>
              <input id="sc-open" className="input" type="time" disabled={!canEdit} value={form.scheduleOpensAt} onChange={(e) => set('scheduleOpensAt', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sc-close">até</label>
              <input id="sc-close" className="input" type="time" disabled={!canEdit} value={form.scheduleClosesAt} onChange={(e) => set('scheduleClosesAt', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sc-step">De quanto em quanto</label>
              <select id="sc-step" className="input" disabled={!canEdit} value={form.scheduleSlotMinutes} onChange={(e) => set('scheduleSlotMinutes', Number(e.target.value))}>
                {[15, 20, 30, 60].map((m) => (
                  <option key={m} value={m}>{m} minutos</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sc-lead">Antecedência mínima (min)</label>
              <input id="sc-lead" className="input" type="number" min={0} disabled={!canEdit} value={form.scheduleLeadMinutes} onChange={(e) => set('scheduleLeadMinutes', Number(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="sc-days">Até quantos dias à frente</label>
              <input id="sc-days" className="input" type="number" min={0} max={30} disabled={!canEdit} value={form.scheduleMaxDays} onChange={(e) => set('scheduleMaxDays', Number(e.target.value))} />
            </div>
          </div>
          <div>
            <span className="label">Dias com agendamento</span>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = form.scheduleWeekdays.length === 0 || form.scheduleWeekdays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      const cur = form.scheduleWeekdays.length ? form.scheduleWeekdays : [0, 1, 2, 3, 4, 5, 6];
                      const next = on ? cur.filter((x) => x !== i) : [...cur, i].sort();
                      set('scheduleWeekdays', next.length === 7 ? [] : next);
                    }}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-[var(--brand)] bg-orange-50 font-medium text-[var(--brand)]' : 'border-zinc-200 text-zinc-400'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Se o horário final for antes do inicial (ex.: 19:00 até 01:00), a janela passa da meia-noite.</p>
          </div>
          <ErrorBox message={error} />
          {canEdit && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={() => save()}>Salvar agendamento</button>
              {saved && <span className="text-sm text-emerald-700">Salvo.</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
