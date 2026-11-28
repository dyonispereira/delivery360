'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, type PdvSaleRow, type Receipt } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { openReceiptPdf, printReceipt } from '@/components/receipt';
import { api } from '@/lib/api';

const FISCAL_LABEL: Record<string, string> = { AUTHORIZED: 'NFC-e autorizada', CANCELLED: 'NFC-e cancelada', REJECTED: 'NFC-e recusada', PROCESSING: 'NFC-e em processamento' };

/** Vendas do caixa aberto: reimprimir, ver o PDF, emitir a NFC-e depois e cancelar (dono/gerente). */
export function SalesList({ canManage, nfceAvailable }: { canManage: boolean; nfceAvailable: boolean }) {
  const [rows, setRows] = useState<PdvSaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<PdvSaleRow | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<PdvSaleRow[]>('/cardapio/pdv/vendas', { tenant: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const print = (id: string) => run(id, async () => printReceipt(await api<Receipt>(`/cardapio/pdv/pedidos/${id}/cupom`, { tenant: true })));
  const emit = (id: string) =>
    run(id, async () => {
      await api(`/cardapio/pdv/pedidos/${id}/nfce`, { method: 'POST', tenant: true, body: {} });
      await load();
      await printReceipt(await api<Receipt>(`/cardapio/pdv/pedidos/${id}/cupom`, { tenant: true }));
    });

  if (!rows) return error ? <ErrorBox message={error} /> : <Spinner />;
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Vendas do balcão</h2>
        <p className="text-xs text-zinc-500">Do caixa aberto (ou das últimas 16 horas)</p>
      </div>
      <ErrorBox message={error} />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Nenhuma venda ainda.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const cancelled = r.status === 'CANCELLED';
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${cancelled ? 'text-zinc-400 line-through' : ''}`}>
                    #{r.number} · {formatBRL(r.totalCents)}
                    {r.customerName !== 'Balcão' && <span className="font-normal text-zinc-500"> · {r.customerName}</span>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {new Date(r.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {r.payments}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cancelled && <Badge tone="red">Cancelada</Badge>}
                  {r.fiscalStatus ? <Badge tone={r.fiscalStatus === 'AUTHORIZED' ? 'green' : r.fiscalStatus === 'CANCELLED' ? 'zinc' : 'amber'}>{FISCAL_LABEL[r.fiscalStatus]}</Badge> : <Badge>Não fiscal</Badge>}
                  <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === r.id} onClick={() => print(r.id)}>
                    Imprimir
                  </button>
                  <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void openReceiptPdf(r.id).catch((e) => setError((e as Error).message))}>
                    PDF
                  </button>
                  {!cancelled && nfceAvailable && (!r.fiscalStatus || r.fiscalStatus === 'REJECTED') && (
                    <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === r.id} onClick={() => emit(r.id)}>
                      {busy === r.id ? 'Emitindo...' : 'Emitir NFC-e'}
                    </button>
                  )}
                  {!cancelled && canManage && (
                    <button className="px-2.5 py-1 text-xs text-red-700 underline" onClick={() => setCancelling(r)}>
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {cancelling && (
        <CancelSale
          sale={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function CancelSale({ sale, onClose, onDone }: { sale: PdvSaleRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`/cardapio/pdv/vendas/${sale.id}/cancelar`, { method: 'POST', tenant: true, body: { reason } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={`Cancelar venda #${sale.number}`}>
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold">
          Cancelar venda #{sale.number} ({formatBRL(sale.totalCents)})
        </h3>
        <p className="text-sm text-zinc-600">
          Devolva o dinheiro ao cliente. A venda sai do caixa e do financeiro.
          {sale.fiscalStatus === 'AUTHORIZED' ? ' A NFC-e também é cancelada (a SEFAZ aceita até 30 minutos depois da emissão).' : ''}
        </p>
        <textarea className="input min-h-20" placeholder="Motivo (pelo menos 15 letras), ex.: cliente desistiu da compra" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />
        <ErrorBox message={error} />
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Voltar
          </button>
          <button className="btn-primary bg-none bg-red-600" disabled={busy || reason.trim().length < 15} onClick={go}>
            {busy ? 'Cancelando...' : 'Cancelar venda'}
          </button>
        </div>
      </div>
    </div>
  );
}
