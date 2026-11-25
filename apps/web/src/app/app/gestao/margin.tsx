'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { monthEnd, monthLabel, monthStart, shiftMonth } from './shared';

interface Row {
  productId: string | null;
  name: string;
  quantity: number;
  revenueCents: number;
  cmvCents: number;
  variableCents: number;
  profitCents: number;
  cmvPct: number | null;
  resultPct: number | null;
  withoutCost: number;
}
interface Result {
  rows: Row[];
  total: Omit<Row, 'productId' | 'name' | 'withoutCost'>;
  missingCost: string[];
}

const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR')}%`);
const cmvTone = (n: number | null) => (n === null ? '' : n <= 30 ? 'text-emerald-700' : n <= 40 ? 'text-amber-700' : 'text-red-600');

/** Quanto cada produto vendido deixou de lucro no mês, pela ficha técnica gravada em cada venda. */
export function Margin() {
  const [month, setMonth] = useState(monthStart());
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Result>(`/gestao/products-margin?from=${month}&to=${monthEnd(month)}`, { tenant: true })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel(month)}</h2>
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
      </div>
      <ErrorBox message={error} />
      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <div className="card py-10 text-center text-sm text-zinc-500">Nenhum produto vendido (pedido entregue ou retirado) neste mês.</div>
      ) : (
        <>
          {data.missingCost.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Vendidos sem ficha técnica: <b>{data.missingCost.join(', ')}</b>. O lucro deles aparece maior do que é.{' '}
              <Link href="/app/cardapio" className="underline">Cadastrar a ficha no cardápio</Link>
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Vendidos</th>
                  <th className="px-3 py-2 text-right">Receita</th>
                  <th className="px-3 py-2 text-right">CMV</th>
                  <th className="px-3 py-2 text-right">CMV %</th>
                  <th className="px-3 py-2 text-right">Impostos e taxas</th>
                  <th className="px-3 py-2 text-right">Lucro</th>
                  <th className="px-3 py-2 text-right">% resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.map((r) => (
                  <tr key={r.productId ?? r.name}>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {r.withoutCost > 0 && <span className="ml-2 rounded bg-amber-50 px-1.5 text-[11px] text-amber-800">sem ficha</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{r.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(r.revenueCents)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(r.cmvCents)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${cmvTone(r.cmvPct)}`}>{pct(r.cmvPct)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(r.variableCents)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.profitCents < 0 ? 'text-red-600' : ''}`}>{formatBRL(r.profitCents)}</td>
                    <td className={`px-3 py-2 text-right ${r.profitCents < 0 ? 'text-red-600' : ''}`}>{pct(r.resultPct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-200 bg-zinc-50 font-semibold">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{data.total.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(data.total.revenueCents)}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(data.total.cmvCents)}</td>
                  <td className={`px-3 py-2 text-right ${cmvTone(data.total.cmvPct)}`}>{pct(data.total.cmvPct)}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(data.total.variableCents)}</td>
                  <td className="px-3 py-2 text-right">{formatBRL(data.total.profitCents)}</td>
                  <td className="px-3 py-2 text-right">{pct(data.total.resultPct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-zinc-500">
        Usa o custo da ficha técnica gravado no momento de cada venda (mudar a ficha hoje não altera vendas passadas). Lucro aqui é a margem de
        contribuição: antes de aluguel, salários e outras despesas fixas, que aparecem na DRE.
      </p>
    </div>
  );
}
