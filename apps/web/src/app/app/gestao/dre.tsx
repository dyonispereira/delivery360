'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { formatBRL } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { monthEnd, monthLabel, monthStart, shiftMonth, todayStr } from './shared';

interface DreLine {
  key: string;
  label: string;
  total?: boolean;
  valueCents: number;
  pct: number | null;
  accounts?: { code: string; name: string; valueCents: number }[];
}
interface DreResult {
  from: string;
  to: string;
  lines: DreLine[];
  orders: { count: number; ticketCents: number };
}

export function Dre() {
  const [month, setMonth] = useState(monthStart());
  const [data, setData] = useState<DreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setData(null);
    api<DreResult>(`/gestao/dre?from=${month}&to=${monthEnd(month)}`, { tenant: true })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month]);
  useEffect(load, [load]);

  const current = month === monthStart(todayStr());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel(month)}</h2>
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
        {current && <span className="text-xs text-zinc-500">mês em andamento</span>}
        {data && <span className="ml-auto text-sm text-zinc-600">{data.orders.count} pedidos entregues · ticket médio {formatBRL(data.orders.ticketCents)}</span>}
      </div>
      <ErrorBox message={error} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Demonstração do resultado (competência)</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="w-20 px-4 py-2 text-right">% receita</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const expandable = !!l.accounts?.length;
                const isOpen = open.has(l.key);
                const tone = l.total ? (l.valueCents < 0 ? 'text-red-600' : 'text-emerald-700') : '';
                return (
                  <Fragment key={l.key}>
                    <tr
                      className={`${l.total ? 'border-y border-zinc-200 bg-zinc-50 font-semibold' : 'border-b border-zinc-100'} ${l.key === 'netProfit' ? 'text-base' : ''} ${expandable ? 'cursor-pointer hover:bg-zinc-50' : ''}`}
                      onClick={() => {
                        if (!expandable) return;
                        const n = new Set(open);
                        if (isOpen) n.delete(l.key);
                        else n.add(l.key);
                        setOpen(n);
                      }}
                    >
                      <td className="px-4 py-2">
                        {l.total ? '= ' : expandable ? (isOpen ? '▾ ' : '▸ ') : '   '}
                        {l.label}
                      </td>
                      <td className={`px-4 py-2 text-right ${tone} ${!l.total && l.valueCents < 0 ? 'text-zinc-700' : ''}`}>{formatBRL(l.valueCents)}</td>
                      <td className="px-4 py-2 text-right text-zinc-500">{l.pct === null ? '—' : `${l.pct.toLocaleString('pt-BR')}%`}</td>
                    </tr>
                    {isOpen &&
                      l.accounts!.map((a) => (
                        <tr key={a.code} className="border-b border-zinc-100 text-xs text-zinc-600">
                          <td className="py-1.5 pl-10 pr-4">{a.code} {a.name}</td>
                          <td className="px-4 py-1.5 text-right">{formatBRL(a.valueCents)}</td>
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        A DRE conta pela competência (o mês a que a receita ou despesa pertence), mesmo que ainda não tenha sido paga. Investimentos, retiradas de sócios e
        gorjetas dos motoboys ficam fora do resultado. Clique em um grupo para ver as contas.
      </p>
    </div>
  );
}
