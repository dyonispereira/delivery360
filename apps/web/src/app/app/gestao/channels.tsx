'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, type SalesChannel } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { br, monthEnd, monthLabel, monthStart, shiftMonth, todayStr } from './shared';

interface Row {
  channel: SalesChannel;
  label: string;
  active: boolean;
  orders: number;
  revenueCents: number;
  commissionCents: number;
  feeCents: number;
  taxCents: number;
  netCents: number;
  cmvCents: number;
  resultCents: number;
  ticketCents: number;
  toReceive: { count: number; netCents: number; nextPayout: string | null };
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

/** Quanto cada canal (loja própria e apps) vende, quanto fica com o app e quanto sobra para o restaurante. */
export function Channels() {
  const [month, setMonth] = useState(monthStart());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    return api<{ rows: Row[] }>(`/gestao/channels?from=${month}&to=${monthEnd(month)}`, { tenant: true })
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  async function payout(r: Row) {
    const until = window.prompt(`Repasse do ${r.label}: dar baixa nas vendas com repasse previsto até qual dia? (DD/MM/AAAA)`, br(todayStr()));
    if (!until) return;
    const iso = until.split('/').reverse().join('-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return setError('Data inválida. Use DD/MM/AAAA.');
    setError(null);
    try {
      const res = await api<{ count: number; grossCents: number; deductionsCents: number; netCents: number }>(`/gestao/channels/${r.channel}/payout`, {
        method: 'POST',
        tenant: true,
        body: { until: iso, paidAt: todayStr() },
      });
      setNotice(`Repasse do ${r.label} registrado: vendas ${formatBRL(res.grossCents)} − comissão e taxas ${formatBRL(res.deductionsCents)} = ${formatBRL(res.netCents)} recebidos.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  const shown = rows?.filter((r) => r.active || r.orders > 0) ?? [];
  const total = shown.reduce((t, r) => ({ revenue: t.revenue + r.revenueCents, result: t.result + r.resultCents }), { revenue: 0, result: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
        <h2 className="min-w-44 text-center text-lg font-semibold">{monthLabel(month)}</h2>
        <button className="btn-ghost px-3 py-1" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
        <Link href="/app/cardapio" className="ml-auto text-sm text-[var(--brand)] underline">Configurar apps (Cardápio › Canais de venda)</Link>
      </div>
      <ErrorBox message={error} />
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      {!rows ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((r) => (
              <div key={r.channel} className="card space-y-1">
                <div className="text-sm text-zinc-500">{r.label}</div>
                <div className="text-xl font-semibold">{formatBRL(r.revenueCents)}</div>
                <div className="text-xs text-zinc-500">
                  {r.orders} pedido(s) · {pct(r.revenueCents, total.revenue)} das vendas
                </div>
                <div className={`text-sm font-medium ${r.resultCents < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  Sobra {formatBRL(r.resultCents)} ({pct(r.resultCents, r.revenueCents)})
                </div>
                {r.channel !== 'LOJA' && (
                  <div className="border-t border-zinc-100 pt-2 text-xs text-zinc-600">
                    {r.toReceive.count > 0 ? (
                      <>
                        A receber do app: <b>{formatBRL(r.toReceive.netCents)}</b> ({r.toReceive.count} venda(s)), próximo repasse {br(r.toReceive.nextPayout)}.
                        <button className="mt-1 block text-[var(--brand)] underline" onClick={() => payout(r)}>
                          Registrar repasse recebido
                        </button>
                      </>
                    ) : (
                      'Nada a receber do app.'
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Canal</th>
                  <th className="px-3 py-2 text-right font-medium">Vendas</th>
                  <th className="px-3 py-2 text-right font-medium">Ticket médio</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão do app</th>
                  <th className="px-3 py-2 text-right font-medium">Taxas</th>
                  <th className="px-3 py-2 text-right font-medium">Impostos</th>
                  <th className="px-3 py-2 text-right font-medium">CMV</th>
                  <th className="px-3 py-2 text-right font-medium">Sobra</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.channel} className="border-t border-zinc-100">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(r.revenueCents)}</td>
                    <td className="px-3 py-2 text-right">{formatBRL(r.ticketCents)}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">
                      {formatBRL(r.commissionCents)} <span className="text-xs text-zinc-400">{pct(r.commissionCents, r.revenueCents)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-600">{formatBRL(r.feeCents)}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{formatBRL(r.taxCents)}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">
                      {formatBRL(r.cmvCents)} <span className="text-xs text-zinc-400">{pct(r.cmvCents, r.revenueCents)}</span>
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.resultCents < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {formatBRL(r.resultCents)} <span className="text-xs font-normal">{pct(r.resultCents, r.revenueCents)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Sobra = vendas − comissão do app − taxas − impostos − CMV (pela ficha técnica). É a margem de cada canal antes das despesas fixas (aluguel, folha); o
            resultado final está na DRE.
          </p>
        </>
      )}
    </div>
  );
}
