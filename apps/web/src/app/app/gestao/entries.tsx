'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatBRL, parseBRL, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { br, monthEnd, monthLabel, monthStart, shiftMonth, SOURCE_LABEL, todayStr, type AccountGroup, type Entry, type EntryType } from './shared';

type Filter = 'OPEN' | 'OVERDUE' | 'PAID' | 'ALL';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'OPEN', label: 'Em aberto' },
  { key: 'OVERDUE', label: 'Vencidas' },
  { key: 'PAID', label: 'Pagas' },
  { key: 'ALL', label: 'Todas' },
];

export function Entries({ type }: { type: EntryType }) {
  const payable = type === 'PAYABLE';
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [month, setMonth] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ items: Entry[]; totals: { openCents: number; overdueCents: number; paidCents: number } } | null>(null);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const today = todayStr();

  const load = useCallback(async () => {
    const q = new URLSearchParams({ type });
    if (filter !== 'ALL') q.set('status', filter);
    if (month) {
      q.set('from', month);
      q.set('to', monthEnd(month));
    }
    if (search.trim()) q.set('search', search.trim());
    try {
      setData(await api(`/gestao/entries?${q}`, { tenant: true }));
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [type, filter, month, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => {
    api<AccountGroup[]>('/gestao/accounts', { tenant: true }).then(setGroups).catch(() => undefined);
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selectedOpen = useMemo(() => data?.items.filter((e) => selected.has(e.id) && e.status === 'OPEN') ?? [], [data, selected]);
  const verb = payable ? 'Pagar' : 'Receber';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-md px-3 py-1.5 text-sm ${filter === f.key ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          {month ? (
            <>
              <button className="btn-ghost px-2 py-1" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
              <span className="min-w-36 text-center">Vencimento: {monthLabel(month)}</span>
              <button className="btn-ghost px-2 py-1" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
              <button className="text-xs text-zinc-500 underline" onClick={() => setMonth(null)}>todos os meses</button>
            </>
          ) : (
            <button className="btn-ghost py-1" onClick={() => setMonth(monthStart())}>Filtrar por mês</button>
          )}
        </div>
        <input className="input max-w-56 py-1.5" placeholder="Buscar descrição ou fornecedor" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        <button className="btn-primary ml-auto" onClick={() => setForm(true)}>
          + {payable ? 'Nova conta a pagar' : 'Nova conta a receber'}
        </button>
      </div>

      <ErrorBox message={error} />
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Em aberto: <b>{formatBRL(data.totals.openCents)}</b></span>
            {data.totals.overdueCents > 0 && <span className="text-red-600">Vencido: <b>{formatBRL(data.totals.overdueCents)}</b></span>}
            {data.totals.paidCents > 0 && <span className="text-emerald-700">{payable ? 'Pago' : 'Recebido'}: <b>{formatBRL(data.totals.paidCents)}</b></span>}
            {selectedOpen.length > 0 && (
              <button
                className="btn-primary ml-auto py-1"
                onClick={() => act(() => api('/gestao/entries/pay-many', { method: 'POST', tenant: true, body: { ids: selectedOpen.map((e) => e.id) } }))}
              >
                {verb} {selectedOpen.length} selecionada{selectedOpen.length > 1 ? 's' : ''} ({formatBRL(selectedOpen.reduce((s, e) => s + e.amountCents, 0))})
              </button>
            )}
          </div>

          {data.items.length === 0 ? (
            <div className="card py-10 text-center text-sm text-zinc-500">Nenhuma conta {filter === 'OPEN' ? 'em aberto' : 'neste filtro'}.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Conta</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2">Situação</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.items.map((e) => {
                    const overdue = e.status === 'OPEN' && e.dueDate < today;
                    return (
                      <tr key={e.id} className={e.status === 'CANCELLED' ? 'text-zinc-400 line-through' : ''}>
                        <td className="px-3 py-2">
                          {e.status === 'OPEN' && (
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ${e.description}`}
                              className="h-4 w-4 accent-[var(--brand)]"
                              checked={selected.has(e.id)}
                              onChange={(ev) => {
                                const n = new Set(selected);
                                if (ev.target.checked) n.add(e.id);
                                else n.delete(e.id);
                                setSelected(n);
                              }}
                            />
                          )}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 ${overdue ? 'font-semibold text-red-600' : ''}`}>{br(e.dueDate)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{e.description}</div>
                          <div className="text-xs text-zinc-500">
                            {e.counterparty && <>{e.counterparty} · </>}
                            {SOURCE_LABEL[e.source] ?? e.source}
                            {e.paymentMethod && <> · {PAYMENT_METHOD_LABELS[e.paymentMethod as PaymentMethod] ?? e.paymentMethod}</>}
                            {e.notes && <> · {e.notes}</>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {e.account.code} {e.account.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{formatBRL(e.amountCents)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {e.status === 'PAID' ? (
                            <Badge tone="green">{payable ? 'Pago' : 'Recebido'} {br(e.paidAt)}</Badge>
                          ) : e.status === 'CANCELLED' ? (
                            <Badge>Cancelado</Badge>
                          ) : overdue ? (
                            <Badge tone="red">Vencido</Badge>
                          ) : (
                            <Badge tone="amber">Em aberto</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {e.status === 'OPEN' && (
                            <button className="btn-ghost py-1" onClick={() => act(() => api(`/gestao/entries/${e.id}/pay`, { method: 'POST', tenant: true, body: {} }))}>
                              {verb}
                            </button>
                          )}
                          {e.status === 'PAID' && (
                            <button className="text-xs text-zinc-500 underline" onClick={() => act(() => api(`/gestao/entries/${e.id}/reopen`, { method: 'POST', tenant: true }))}>
                              desfazer baixa
                            </button>
                          )}
                          {e.status !== 'CANCELLED' && (
                            <button
                              className="ml-2 text-xs text-red-600 underline"
                              onClick={() => {
                                if (window.confirm(`Cancelar "${e.description}"? Ela sai da DRE e das contas.`)) void act(() => api(`/gestao/entries/${e.id}`, { method: 'DELETE', tenant: true }));
                              }}
                            >
                              cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {form && (
        <EntryForm
          type={type}
          groups={groups}
          onClose={() => setForm(false)}
          onSaved={() => {
            setForm(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function EntryForm({ type, groups, onClose, onSaved }: { type: EntryType; groups: AccountGroup[]; onClose: () => void; onSaved: () => void }) {
  const payable = type === 'PAYABLE';
  const today = todayStr();
  const [f, setF] = useState({ description: '', counterparty: '', amount: '', accountId: '', competenceDate: today, dueDate: today, notes: '', paidNow: false, repeat: '1' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Contas que fazem sentido para o tipo: receitas e rendimentos para "a receber"; o resto para "a pagar".
  const options = groups
    .filter((g) => (payable ? g.kind !== 'REVENUE' : ['REVENUE', 'FINANCIAL', 'OFF_DRE'].includes(g.kind)))
    .map((g) => ({ ...g, accounts: g.accounts.filter((a) => a.active) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseBRL(f.amount);
    if (!amountCents) return setError('Informe o valor.');
    if (!f.accountId) return setError('Escolha a conta.');
    setBusy(true);
    setError(null);
    try {
      await api('/gestao/entries', {
        method: 'POST',
        tenant: true,
        body: {
          type,
          accountId: f.accountId,
          description: f.description,
          counterparty: f.counterparty || undefined,
          amountCents,
          competenceDate: f.competenceDate,
          dueDate: f.dueDate,
          notes: f.notes || undefined,
          paidAt: f.paidNow ? today : undefined,
          repeatMonths: Number(f.repeat) > 1 ? Number(f.repeat) : undefined,
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-label={payable ? 'Nova conta a pagar' : 'Nova conta a receber'}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
      >
        <h2 className="text-lg font-bold">{payable ? 'Nova conta a pagar' : 'Nova conta a receber'}</h2>
        <div>
          <label className="label" htmlFor="e-desc">Descrição</label>
          <input id="e-desc" className="input" required minLength={2} placeholder={payable ? 'Ex.: Conta de luz' : 'Ex.: Evento de aniversário'} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-amount">Valor</label>
            <input id="e-amount" className="input" required inputMode="decimal" placeholder="R$ 0,00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="e-party">{payable ? 'Fornecedor / para quem' : 'Cliente / de quem'}</label>
            <input id="e-party" className="input" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="e-account">Conta (plano de contas)</label>
          <select id="e-account" className="input" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            <option value="">Escolha...</option>
            {options.map((g) => (
              <optgroup key={g.group} label={`${g.group}. ${g.name}`}>
                {g.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-due">Vencimento</label>
            <input id="e-due" type="date" className="input" required value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="e-comp" title="O mês a que a despesa ou receita pertence. É o que conta na DRE.">Competência (mês da DRE)</label>
            <input id="e-comp" type="date" className="input" required value={f.competenceDate} onChange={(e) => setF({ ...f, competenceDate: e.target.value })} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-repeat">Repetir todo mês</label>
            <select id="e-repeat" className="input" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}>
              <option value="1">Não repetir</option>
              {[2, 3, 6, 12, 24].map((n) => (
                <option key={n} value={n}>{n} meses</option>
              ))}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={f.paidNow} onChange={(e) => setF({ ...f, paidNow: e.target.checked })} />
            Já {payable ? 'paguei' : 'recebi'} hoje
          </label>
        </div>
        <div>
          <label className="label" htmlFor="e-notes">Observações</label>
          <input id="e-notes" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        <ErrorBox message={error} />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Voltar</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </div>
  );
}
