'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, TOTEM_PAY_HINT_LABELS, type TotemPendingOrder } from '@delivery360/shared';
import { api } from '@/lib/api';

/**
 * Pedidos do totem esperando o cliente pagar no caixa. Atualiza sozinho a cada 10 s.
 * "Receber" abre o pagamento (o caixa registra o que entrou de fato); "Descartar" quando o cliente desistiu.
 */
export function TotemQueue({ activeId, onReceive }: { activeId: string | null; onReceive: (o: TotemPendingOrder) => void }) {
  const [list, setList] = useState<TotemPendingOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<TotemPendingOrder[]>('/cardapio/pdv/totem/pedidos', { tenant: true }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, activeId]);

  async function discard(o: TotemPendingOrder) {
    if (!window.confirm(`Descartar o pedido da senha ${o.ticket}? Use quando o cliente desistiu sem pagar.`)) return;
    try {
      await api(`/cardapio/pdv/totem/pedidos/${o.id}/descartar`, { method: 'POST', tenant: true });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!list.length && !error) return null;
  return (
    <section className="card space-y-2 border-amber-300 bg-amber-50/60" aria-label="Pedidos do totem aguardando pagamento">
      <h2 className="font-semibold">🖥️ Totem: aguardando pagamento no caixa ({list.length})</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((o) => {
          const mins = Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000));
          return (
            <li key={o.id} className={`rounded-xl border bg-white p-3 ${activeId === o.id ? 'border-[var(--brand)] ring-1 ring-[var(--brand)]' : 'border-zinc-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-2xl font-black leading-none">Senha {o.ticket}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    #{o.number} · {o.consumption === 'EAT_IN' ? 'Comer aqui' : 'Levar'} · há {mins} min{o.totemName ? ` · ${o.totemName}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{formatBRL(o.totalCents)}</p>
                  {o.payHint && <p className="text-xs text-zinc-500">Vai pagar: {TOTEM_PAY_HINT_LABELS[o.payHint]}</p>}
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-700">{o.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}</p>
              <div className="mt-2 flex gap-2">
                <button className="btn-primary flex-1 py-1.5 text-sm" onClick={() => onReceive(o)}>
                  Receber
                </button>
                <button className="btn-ghost py-1.5 text-sm" onClick={() => void discard(o)}>
                  Descartar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
