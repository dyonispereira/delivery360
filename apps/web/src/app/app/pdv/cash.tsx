'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, parseBRL, type CashSessionView } from '@delivery360/shared';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Caixa aberto: resumo por forma de pagamento, sangria/suprimento e fechamento com a contagem. Embaixo, os caixas anteriores. */
export function CashPanel({ session, onChange }: { session: CashSessionView | null; onChange: () => void }) {
  const [history, setHistory] = useState<CashSessionView[]>([]);
  const loadHistory = useCallback(() => {
    api<CashSessionView[]>('/cardapio/pdv/caixas', { tenant: true })
      .then((h) => setHistory(h.filter((s) => s.status === 'CLOSED')))
      .catch(() => undefined);
  }, []);
  useEffect(loadHistory, [loadHistory, session?.status]);
  const refresh = () => {
    onChange();
    loadHistory();
  };

  return (
    <div className="space-y-4">
      {session ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Summary s={session} />
          <div className="space-y-4">
            <Movement onDone={refresh} />
            <CloseCash expected={session.summary.expectedCashCents} onDone={refresh} />
          </div>
        </div>
      ) : (
        <OpenCash onOpened={refresh} />
      )}
      {history.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-semibold">Caixas fechados</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Período</th>
                  <th className="py-1 pr-3 font-medium">Quem fechou</th>
                  <th className="py-1 pr-3 text-right font-medium">Vendas</th>
                  <th className="py-1 pr-3 text-right font-medium">Esperado em dinheiro</th>
                  <th className="py-1 pr-3 text-right font-medium">Contado</th>
                  <th className="py-1 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 pr-3">
                      {dateTime(h.openedAt)} até {h.closedAt ? time(h.closedAt) : '...'}
                    </td>
                    <td className="py-1.5 pr-3">{h.closedByName ?? '-'}</td>
                    <td className="py-1.5 pr-3 text-right">{formatBRL(h.summary.salesCents)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatBRL(h.expectedCents ?? 0)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatBRL(h.countedCents ?? 0)}</td>
                    <td className="py-1.5 text-right">
                      <Diff cents={h.differenceCents ?? 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Diff({ cents }: { cents: number }) {
  if (cents === 0) return <Badge tone="green">Bateu</Badge>;
  return <Badge tone={cents < 0 ? 'red' : 'amber'}>{cents < 0 ? `Faltou ${formatBRL(-cents)}` : `Sobrou ${formatBRL(cents)}`}</Badge>;
}

function Summary({ s }: { s: CashSessionView }) {
  const m = s.summary;
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Caixa de hoje</h2>
        <p className="text-sm text-zinc-500">
          Aberto às {time(s.openedAt)} por {s.openedByName ?? 'alguém da equipe'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Vendas no balcão" value={formatBRL(m.salesCents)} hint={`${m.salesCount} vendas${m.cancelledCount ? ` · ${m.cancelledCount} cancelada${m.cancelledCount > 1 ? 's' : ''}` : ''}`} />
        <Stat label="Troco dado" value={formatBRL(m.changeCents)} hint="Já descontado do dinheiro" />
        <Stat label="Dinheiro na gaveta (esperado)" value={formatBRL(m.expectedCashCents)} hint="Fundo + dinheiro + suprimentos − sangrias" strong />
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold">Por forma de pagamento</p>
        {m.byMethod.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhuma venda ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Forma</th>
                <th className="py-1 text-right font-medium">Balcão</th>
                <th className="py-1 text-right font-medium">Salão</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {m.byMethod.map((r) => (
                <tr key={r.label}>
                  <td className="py-1.5">{r.label}</td>
                  <td className="py-1.5 text-right">{formatBRL(r.pdvCents)}</td>
                  <td className="py-1.5 text-right">{formatBRL(r.salaoCents)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatBRL(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="rounded-xl bg-zinc-50 p-3 text-sm">
        <p className="mb-1 font-semibold">Conta do dinheiro</p>
        <Line label="Fundo de troco" value={m.openingCents} />
        <Line label="Vendas em dinheiro (balcão e salão)" value={m.cashSalesCents} />
        <Line label="Suprimentos" value={m.suprimentoCents} />
        <Line label="Sangrias" value={-m.sangriaCents} />
        <div className="mt-1 flex justify-between border-t border-zinc-200 pt-1 font-bold">
          <span>Deve ter na gaveta</span>
          <span>{formatBRL(m.expectedCashCents)}</span>
        </div>
      </div>
      {s.movements.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">Sangrias e suprimentos</p>
          <ul className="divide-y divide-zinc-100 text-sm">
            {s.movements.map((mv) => (
              <li key={mv.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {time(mv.createdAt)} · {mv.kind === 'SANGRIA' ? 'Sangria' : 'Suprimento'}
                  {mv.reason ? ` · ${mv.reason}` : ''}
                  {mv.userName ? <span className="text-zinc-500"> ({mv.userName})</span> : null}
                </span>
                <span className={mv.kind === 'SANGRIA' ? 'text-red-700' : 'text-emerald-700'}>
                  {mv.kind === 'SANGRIA' ? '−' : '+'}
                  {formatBRL(mv.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-600">{label}</span>
      <span>{value < 0 ? `−${formatBRL(-value)}` : formatBRL(value)}</span>
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${strong ? 'bg-orange-50' : 'bg-zinc-50'}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Movement({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const cents = parseBRL(value);
    if (!cents) return setError('Informe o valor.');
    setBusy(true);
    setError(null);
    try {
      await api('/cardapio/pdv/caixa/movimento', { method: 'POST', tenant: true, body: { kind, amountCents: cents, reason: reason.trim() || undefined } });
      setValue('');
      setReason('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Sangria ou suprimento</h2>
      <div className="grid grid-cols-2 gap-2">
        {(['SANGRIA', 'SUPRIMENTO'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-xl border px-3 py-2 text-sm transition ${kind === k ? 'border-[var(--brand)] bg-orange-50 font-semibold' : 'border-zinc-200'}`}>
            {k === 'SANGRIA' ? 'Sangria (tirar)' : 'Suprimento (colocar)'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <input className="input" inputMode="decimal" placeholder="R$ 0,00" aria-label="Valor" value={value} onChange={(e) => setValue(e.target.value)} />
        <input className="input" placeholder={kind === 'SANGRIA' ? 'Motivo (ex.: cofre)' : 'Motivo (ex.: moedas)'} aria-label="Motivo" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorBox message={error} />
      <button className="btn-ghost w-full" disabled={busy} onClick={save}>
        {busy ? 'Salvando...' : kind === 'SANGRIA' ? 'Registrar sangria' : 'Registrar suprimento'}
      </button>
    </section>
  );
}

function CloseCash({ expected, onDone }: { expected: number; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counted = parseBRL(value);
  const diff = counted === null ? null : counted - expected;
  async function close() {
    if (counted === null) return setError('Conte o dinheiro da gaveta e informe o valor.');
    setBusy(true);
    setError(null);
    try {
      await api('/cardapio/pdv/caixa/fechar', { method: 'POST', tenant: true, body: { countedCents: counted, notes: notes.trim() || undefined } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Fechar o caixa</h2>
      <p className="text-sm text-zinc-500">Conte o dinheiro da gaveta (com o fundo de troco). Pix e cartão conferem no extrato e na maquininha.</p>
      <label className="block">
        <span className="label">Dinheiro contado (R$)</span>
        <input className="input text-lg font-semibold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
      </label>
      {diff !== null && (
        <p className="text-sm">
          Esperado {formatBRL(expected)} · <Diff cents={diff} />
        </p>
      )}
      <input className="input" placeholder="Observação (opcional)" aria-label="Observação" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <ErrorBox message={error} />
      <button className="btn-primary w-full" disabled={busy} onClick={close}>
        {busy ? 'Fechando...' : 'Fechar caixa'}
      </button>
    </section>
  );
}

/** Abrir o caixa: conta o fundo de troco que está na gaveta. */
export function OpenCash({ onOpened }: { onOpened: () => void }) {
  const [value, setValue] = useState('100,00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    const cents = parseBRL(value);
    if (cents === null) return setError('Informe o fundo de troco (pode ser 0).');
    setBusy(true);
    try {
      await api('/cardapio/pdv/caixa/abrir', { method: 'POST', tenant: true, body: { openingCents: cents } });
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card mx-auto max-w-md space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl" aria-hidden>
        🧾
      </div>
      <div>
        <h2 className="text-lg font-semibold">Abrir o caixa</h2>
        <p className="text-sm text-zinc-500">Conte o dinheiro que fica na gaveta para troco. No fechamento, o sistema compara com o que deveria ter.</p>
      </div>
      <label className="block text-left">
        <span className="label">Fundo de troco (R$)</span>
        <input className="input text-center text-2xl font-semibold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} />
      </label>
      <ErrorBox message={error} />
      <button className="btn-primary w-full py-3 text-base" disabled={busy} onClick={open}>
        {busy ? 'Abrindo...' : 'Abrir caixa'}
      </button>
    </div>
  );
}
