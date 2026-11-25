'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { br, monthLabel, shiftMonth, todayStr } from './shared';

type EmploymentType = 'CLT' | 'PJ' | 'DIARISTA' | 'ESTAGIO';
type AbsenceKind = 'FOLGA' | 'FERIAS' | 'ATESTADO' | 'FALTA';

interface Employee {
  id: string;
  name: string;
  role: string;
  type: EmploymentType;
  phone: string | null;
  document: string | null;
  pixKey: string | null;
  salaryCents: number;
  dailyRateCents: number;
  transportCents: number;
  mealCents: number;
  weeklyDayOff: number | null;
  admissionDate: string;
  terminationDate: string | null;
  active: boolean;
  notes: string | null;
}
interface Absence {
  id: string;
  employeeId: string;
  kind: AbsenceKind;
  startDate: string;
  endDate: string;
  notes: string | null;
  employee: { name: string };
}
interface PayrollItem {
  id: string;
  employeeId: string;
  employee: { name: string; role: string; type: EmploymentType };
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
  netCents: number;
  grossCents: number;
  costCents: number;
}
interface Payroll {
  month: string;
  status: 'DRAFT' | 'CLOSED';
  items: PayrollItem[];
  totals: Record<'grossCents' | 'advanceCents' | 'netCents' | 'benefitsCents' | 'chargesCents' | 'provisionCents' | 'costCents', number>;
}

const TYPE_LABEL: Record<EmploymentType, string> = { CLT: 'CLT', PJ: 'PJ', DIARISTA: 'Diarista', ESTAGIO: 'Estágio' };
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const KIND: Record<AbsenceKind, { label: string; short: string; tone: string }> = {
  FOLGA: { label: 'Folga extra', short: 'FO', tone: 'bg-sky-100 text-sky-800' },
  FERIAS: { label: 'Férias', short: 'FÉ', tone: 'bg-emerald-100 text-emerald-800' },
  ATESTADO: { label: 'Atestado', short: 'AT', tone: 'bg-amber-100 text-amber-900' },
  FALTA: { label: 'Falta (desconta)', short: 'X', tone: 'bg-red-100 text-red-700' },
};
const money = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const thisMonth = () => todayStr().slice(0, 7);

/** Pessoas e folha: funcionários, escala com folgas e a folha gerencial do mês. */
export function Pessoas() {
  const [view, setView] = useState<'equipe' | 'escala' | 'folha'>('equipe');
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(
          [
            ['equipe', 'Funcionários'],
            ['escala', 'Escala e folgas'],
            ['folha', 'Folha do mês'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className={`rounded-full px-3 py-1 text-sm ${view === k ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'equipe' && <Team />}
      {view === 'escala' && <Schedule />}
      {view === 'folha' && <PayrollView />}
    </div>
  );
}

// ---------- Funcionários ----------

function Team() {
  const [list, setList] = useState<Employee[] | null>(null);
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Employee[]>('/gestao/employees', { tenant: true }).then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!list) return error ? <ErrorBox message={error} /> : <Spinner />;
  const monthly = list.filter((e) => e.active).reduce((t, e) => t + (e.type === 'DIARISTA' ? 0 : e.salaryCents), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="card space-y-3 p-0">
        <div className="flex items-center gap-3 px-4 pt-4">
          <div className="flex-1">
            <h2 className="font-semibold">Funcionários</h2>
            <p className="text-xs text-zinc-500">
              {list.filter((e) => e.active).length} ativo(s) · salários fixos somam {formatBRL(monthly)} por mês
            </p>
          </div>
          <button className="btn-primary" onClick={() => setEditing({ type: 'CLT', admissionDate: todayStr() })}>+ Funcionário</button>
        </div>
        {list.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-zinc-500">Cadastre a equipe para montar a escala e a folha do mês.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {list.map((e) => (
              <li key={e.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50" onClick={() => setEditing(e)}>
                  <div className="flex-1">
                    <div className={`font-medium ${e.active ? '' : 'text-zinc-400 line-through'}`}>{e.name}</div>
                    <div className="text-xs text-zinc-500">
                      {e.role} · {TYPE_LABEL[e.type]}
                      {e.weeklyDayOff !== null && ` · folga ${WEEKDAYS[e.weeklyDayOff].toLowerCase()}`}
                      {e.terminationDate && ` · desligado em ${br(e.terminationDate)}`}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {e.type === 'DIARISTA' ? `${formatBRL(e.dailyRateCents)}/dia` : formatBRL(e.salaryCents)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <EmployeeForm
          key={editing.id ?? 'new'}
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function EmployeeForm({ employee, onClose, onSaved }: { employee: Partial<Employee>; onClose: () => void; onSaved: () => Promise<void> }) {
  const isNew = !employee.id;
  const [f, setF] = useState({
    name: employee.name ?? '',
    role: employee.role ?? '',
    type: (employee.type ?? 'CLT') as EmploymentType,
    salary: money(employee.salaryCents ?? 0),
    daily: money(employee.dailyRateCents ?? 0),
    transport: money(employee.transportCents ?? 0),
    meal: money(employee.mealCents ?? 0),
    dayOff: employee.weeklyDayOff === null || employee.weeklyDayOff === undefined ? '' : String(employee.weeklyDayOff),
    admissionDate: employee.admissionDate ?? todayStr(),
    phone: employee.phone ?? '',
    document: employee.document ?? '',
    pixKey: employee.pixKey ?? '',
    notes: employee.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const daily = f.type === 'DIARISTA';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = (v: string) => parseBRL(v || '0');
    const vals = { salaryCents: cents(f.salary), dailyRateCents: cents(f.daily), transportCents: cents(f.transport), mealCents: cents(f.meal) };
    if (Object.values(vals).some((v) => v === null)) return setError('Confira os valores em R$.');
    const body = {
      name: f.name,
      role: f.role,
      type: f.type,
      ...vals,
      weeklyDayOff: f.dayOff === '' ? null : Number(f.dayOff),
      admissionDate: f.admissionDate,
      phone: f.phone || undefined,
      document: f.document || undefined,
      pixKey: f.pixKey || undefined,
      notes: f.notes || undefined,
    };
    try {
      if (isNew) await api('/gestao/employees', { method: 'POST', tenant: true, body });
      else await api(`/gestao/employees/${employee.id}`, { method: 'PATCH', tenant: true, body });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  }

  async function terminate(undo = false) {
    const date = undo ? '' : window.prompt('Data do desligamento (DD/MM/AAAA):', br(todayStr()));
    if (date === null) return;
    const iso = date ? date.split('/').reverse().join('-') : '';
    if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return setError('Data inválida.');
    try {
      await api(`/gestao/employees/${employee.id}`, { method: 'PATCH', tenant: true, body: { terminationDate: iso } });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro.');
    }
  }

  return (
    <form onSubmit={save} className="card h-fit space-y-3 lg:sticky lg:top-4" aria-label="Funcionário">
      <div className="flex items-center">
        <h2 className="font-semibold">{isNew ? 'Novo funcionário' : 'Editar funcionário'}</h2>
        <button type="button" className="ml-auto text-sm text-zinc-500" onClick={onClose}>Fechar</button>
      </div>
      <Field label="Nome" id="emp-name"><input id="emp-name" className="input" required value={f.name} onChange={set('name')} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cargo" id="emp-role"><input id="emp-role" className="input" required placeholder="Ex.: Cozinheiro" value={f.role} onChange={set('role')} /></Field>
        <Field label="Contratação" id="emp-type">
          <select id="emp-type" className="input" value={f.type} onChange={set('type')}>
            {(Object.keys(TYPE_LABEL) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {daily ? (
          <Field label="Diária (R$)" id="emp-daily"><input id="emp-daily" className="input" inputMode="decimal" value={f.daily} onChange={set('daily')} /></Field>
        ) : (
          <Field label="Salário (R$)" id="emp-salary"><input id="emp-salary" className="input" inputMode="decimal" value={f.salary} onChange={set('salary')} /></Field>
        )}
        <Field label="Admissão" id="emp-adm"><input id="emp-adm" type="date" className="input" required value={f.admissionDate} onChange={set('admissionDate')} /></Field>
      </div>
      {!daily && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Vale-transporte/mês (R$)" id="emp-vt"><input id="emp-vt" className="input" inputMode="decimal" value={f.transport} onChange={set('transport')} /></Field>
          <Field label="Vale-alimentação/mês (R$)" id="emp-va"><input id="emp-va" className="input" inputMode="decimal" value={f.meal} onChange={set('meal')} /></Field>
        </div>
      )}
      <Field label="Folga fixa" id="emp-off">
        <select id="emp-off" className="input" value={f.dayOff} onChange={set('dayOff')}>
          <option value="">Sem folga fixa</option>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>{d}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Telefone" id="emp-phone"><input id="emp-phone" className="input" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="CPF / CNPJ" id="emp-doc"><input id="emp-doc" className="input" value={f.document} onChange={set('document')} /></Field>
      </div>
      <Field label="Chave PIX" id="emp-pix"><input id="emp-pix" className="input" value={f.pixKey} onChange={set('pixKey')} /></Field>
      <Field label="Observações" id="emp-notes"><textarea id="emp-notes" className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      <ErrorBox message={error} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary">Salvar</button>
        {!isNew && !employee.terminationDate && (
          <button type="button" className="btn-ghost text-red-600" onClick={() => terminate()}>Desligar</button>
        )}
        {!isNew && employee.terminationDate && (
          <button type="button" className="btn-ghost" onClick={() => terminate(true)}>Desfazer desligamento</button>
        )}
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-500" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

// ---------- Escala e folgas ----------

function Schedule() {
  const [month, setMonth] = useState(thisMonth());
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [form, setForm] = useState({ employeeId: '', kind: 'FOLGA' as AbsenceKind, startDate: todayStr(), endDate: todayStr(), notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, '0')}`;

  const load = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([
        api<Employee[]>('/gestao/employees', { tenant: true }),
        api<Absence[]>(`/gestao/absences?from=${from}&to=${to}`, { tenant: true }),
      ]);
      setEmployees(e);
      setAbsences(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro.');
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/gestao/absences', { method: 'POST', tenant: true, body: { ...form, notes: form.notes || undefined } });
      setForm({ ...form, notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro.');
    }
  }

  async function remove(a: Absence) {
    if (!window.confirm(`Apagar ${KIND[a.kind].label.toLowerCase()} de ${a.employee.name} (${br(a.startDate)} a ${br(a.endDate)})?`)) return;
    try {
      await api(`/gestao/absences/${a.id}`, { method: 'DELETE', tenant: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro.');
    }
  }

  if (!employees) return error ? <ErrorBox message={error} /> : <Spinner />;
  const team = employees.filter((e) => e.admissionDate <= to && (!e.terminationDate || e.terminationDate >= from));
  const dates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const cell = (e: Employee, d: string) => {
    if (d < e.admissionDate || (e.terminationDate && d > e.terminationDate)) return { text: '', tone: 'bg-zinc-50', absence: null };
    const a = absences.find((x) => x.employeeId === e.id && x.startDate <= d && x.endDate >= d);
    if (a) return { text: KIND[a.kind].short, tone: KIND[a.kind].tone, absence: a };
    if (e.weeklyDayOff === weekday(d)) return { text: 'F', tone: 'bg-zinc-200 text-zinc-600', absence: null };
    return { text: '', tone: '', absence: null };
  };
  const today = todayStr();
  const offToday = team.filter((e) => today >= from && today <= to && cell(e, today).text);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(`${month}-01`, -1).slice(0, 7))} aria-label="Mês anterior">‹</button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel(`${month}-01`)}</h2>
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(`${month}-01`, 1).slice(0, 7))} aria-label="Próximo mês">›</button>
        {offToday.length > 0 && <span className="ml-auto text-sm text-zinc-600">Fora hoje: {offToday.map((e) => e.name.split(' ')[0]).join(', ')}</span>}
      </div>

      <form onSubmit={add} className="card grid gap-2 sm:grid-cols-[1.4fr_1fr_8.5rem_8.5rem_1fr_auto] sm:items-end" aria-label="Lançar folga">
        <Field label="Funcionário" id="ab-emp">
          <select id="ab-emp" className="input" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Escolha</option>
            {team.filter((e) => e.active).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Tipo" id="ab-kind">
          <select id="ab-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AbsenceKind })}>
            {(Object.keys(KIND) as AbsenceKind[]).map((k) => (
              <option key={k} value={k}>{KIND[k].label}</option>
            ))}
          </select>
        </Field>
        <Field label="De" id="ab-start">
          <input id="ab-start" type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} />
        </Field>
        <Field label="Até" id="ab-end"><input id="ab-end" type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
        <Field label="Observação" id="ab-notes"><input id="ab-notes" className="input" placeholder="Opcional" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn-primary">Lançar</button>
      </form>
      <ErrorBox message={error} />

      {team.length === 0 ? (
        <div className="card py-10 text-center text-sm text-zinc-500">Nenhum funcionário neste mês.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-3 py-2 text-left font-medium">Funcionário</th>
                {dates.map((d) => (
                  <th key={d} className={`w-7 px-0.5 py-1 text-center font-normal ${weekday(d) === 0 ? 'text-red-600' : 'text-zinc-500'} ${d === today ? 'bg-amber-50' : ''}`}>
                    <div>{'DSTQQSS'[weekday(d)]}</div>
                    <div className="font-medium text-zinc-800">{Number(d.slice(8))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-[11px] text-zinc-500">{e.role}</div>
                  </td>
                  {dates.map((d) => {
                    const c = cell(e, d);
                    return (
                      <td key={d} className="p-0.5 text-center">
                        {c.absence ? (
                          <button
                            className={`h-7 w-6 rounded font-semibold ${c.tone}`}
                            title={`${KIND[c.absence.kind].label}${c.absence.notes ? `: ${c.absence.notes}` : ''} (clique para apagar)`}
                            onClick={() => remove(c.absence!)}
                          >
                            {c.text}
                          </button>
                        ) : (
                          <div className={`flex h-7 w-6 items-center justify-center rounded ${c.tone}`}>{c.text}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-zinc-600">
        <span><b className="rounded bg-zinc-200 px-1">F</b> folga fixa</span>
        {(Object.keys(KIND) as AbsenceKind[]).map((k) => (
          <span key={k}><b className={`rounded px-1 ${KIND[k].tone}`}>{KIND[k].short}</b> {KIND[k].label.toLowerCase()}</span>
        ))}
      </div>
    </div>
  );
}

// ---------- Folha do mês ----------

function PayrollView() {
  const [month, setMonth] = useState(thisMonth());
  const [p, setP] = useState<Payroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setP(null);
    return api<Payroll>(`/gestao/payroll/${month}`, { tenant: true }).then(setP).catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => {
    setNotice(null);
    void load();
  }, [load]);

  async function patch(item: PayrollItem, field: 'extrasCents' | 'bonusCents' | 'advanceCents' | 'days', text: string) {
    const value = field === 'days' ? Number(text || '0') : parseBRL(text || '0');
    if (value === null || Number.isNaN(value)) return setError('Valor inválido.');
    if (value === item[field]) return;
    setError(null);
    try {
      setP(await api<Payroll>(`/gestao/payroll/items/${item.id}`, { method: 'PATCH', tenant: true, body: { [field]: value } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  async function action(kind: 'close' | 'reopen') {
    const ask =
      kind === 'close'
        ? `Fechar a folha de ${monthLabel(`${month}-01`)}? Os salários, encargos e benefícios vão para Contas a pagar e entram na DRE.`
        : 'Reabrir a folha? Os lançamentos gerados serão apagados (só dá se nada foi pago).';
    if (!window.confirm(ask)) return;
    setError(null);
    try {
      setP(await api<Payroll>(`/gestao/payroll/${month}/${kind}`, { method: 'POST', tenant: true }));
      setNotice(kind === 'close' ? 'Folha fechada. As contas estão em Contas a pagar.' : 'Folha reaberta.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  const open = p?.status === 'DRAFT';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(`${month}-01`, -1).slice(0, 7))} aria-label="Mês anterior">‹</button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel(`${month}-01`)}</h2>
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(`${month}-01`, 1).slice(0, 7))} aria-label="Próximo mês">›</button>
        {p && <Badge tone={open ? 'amber' : 'green'}>{open ? 'Rascunho' : 'Fechada'}</Badge>}
        {p && (
          <div className="ml-auto">
            {open ? (
              <button className="btn-primary" onClick={() => action('close')} disabled={p.items.length === 0}>Fechar folha</button>
            ) : (
              <button className="btn-ghost" onClick={() => action('reopen')}>Reabrir</button>
            )}
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      {!p ? (
        <Spinner />
      ) : p.items.length === 0 ? (
        <div className="card py-10 text-center text-sm text-zinc-500">Nenhum funcionário neste mês. Cadastre em Funcionários.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="A pagar aos funcionários" value={p.totals.netCents} hint={p.totals.advanceCents ? `já adiantado ${formatBRL(p.totals.advanceCents)}` : undefined} />
            <Stat label="Encargos (FGTS/INSS)" value={p.totals.chargesCents} />
            <Stat label="Benefícios e reserva férias/13º" value={p.totals.benefitsCents + p.totals.provisionCents} />
            <Stat label="Custo total da equipe" value={p.totals.costCents} strong />
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Funcionário</th>
                  <th className="px-2 py-2 text-right font-medium">Dias</th>
                  <th className="px-2 py-2 text-right font-medium">Salário / diárias</th>
                  <th className="px-2 py-2 text-right font-medium">Faltas</th>
                  <th className="px-2 py-2 text-right font-medium">Extras</th>
                  <th className="px-2 py-2 text-right font-medium">Prêmio</th>
                  <th className="px-2 py-2 text-right font-medium">Adiantamento</th>
                  <th className="px-2 py-2 text-right font-medium">A pagar</th>
                  <th className="px-2 py-2 text-right font-medium">Benefícios</th>
                  <th className="px-2 py-2 text-right font-medium">Encargos</th>
                  <th className="px-2 py-2 text-right font-medium">Reserva</th>
                  <th className="px-3 py-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.id} className="border-t border-zinc-100">
                    <td className="min-w-44 px-3 py-2">
                      <div className="whitespace-nowrap font-medium">{i.employee.name}</div>
                      <div className="text-xs text-zinc-500">{i.employee.role} · {TYPE_LABEL[i.employee.type]}</div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {i.employee.type === 'DIARISTA' && open ? (
                        <CellInput label={`Diárias de ${i.employee.name}`} value={String(i.days || '')} onSave={(v) => patch(i, 'days', v)} narrow />
                      ) : (
                        i.days
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{formatBRL(i.baseCents)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-red-600">{i.absenceCents ? `− ${formatBRL(i.absenceCents)} (${i.absenceDays}d)` : '—'}</td>
                    {(['extrasCents', 'bonusCents', 'advanceCents'] as const).map((k) => (
                      <td key={k} className="px-2 py-2 text-right">
                        {open ? (
                          <CellInput label={`${k === 'extrasCents' ? 'Extras' : k === 'bonusCents' ? 'Prêmio' : 'Adiantamento'} de ${i.employee.name}`} value={money(i[k])} onSave={(v) => patch(i, k, v)} />
                        ) : i[k] ? (
                          formatBRL(i[k])
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{formatBRL(i.netCents)}</td>
                    <td className="px-2 py-2 text-right text-zinc-600">{formatBRL(i.benefitsCents)}</td>
                    <td className="px-2 py-2 text-right text-zinc-600">{formatBRL(i.chargesCents)}</td>
                    <td className="px-2 py-2 text-right text-zinc-600">{formatBRL(i.provisionCents)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{formatBRL(i.costCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Folha gerencial: mostra quanto a equipe custa no mês. Falta desconta 1/30 do salário. Reserva = férias + 1/3 e 13º guardados todo mês. Os descontos de
            INSS e IR do funcionário e o eSocial continuam com o contador. Ao fechar, tudo vai para Contas a pagar (grupo 4 do plano de contas) e entra na DRE.
          </p>
        </>
      )}
    </div>
  );
}

function CellInput({ label, value, onSave, narrow }: { label: string; value: string; onSave: (v: string) => void; narrow?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      aria-label={label}
      className={`input px-2 py-1 text-right text-sm ${narrow ? 'w-14' : 'w-24'}`}
      inputMode="decimal"
      placeholder={narrow ? '0' : '0,00'}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl ${strong ? 'font-bold' : 'font-semibold'}`}>{formatBRL(value)}</div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}
