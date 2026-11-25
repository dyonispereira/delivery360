'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { formatBRL, type OrderStatus, type PaymentMethod } from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';

interface CourierOrder {
  id: string;
  number: number;
  status: OrderStatus;
  customerName: string;
  phoneHint: string;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressReference: string | null;
  deliveryZoneName: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  notes: string | null;
  deliveredAt: string | null;
  locked: boolean;
}
interface CourierView {
  courier: { name: string };
  store: { displayName: string; whatsapp: string | null } | null;
  batches: { id: string; number: number; status: 'OUT' | 'DONE'; createdAt: string; orders: CourierOrder[] }[];
}

/** O que o motoboy precisa receber na porta. */
function toCollect(o: CourierOrder): { text: string; tone: string } {
  if (o.paymentMethod === 'PIX' || o.paymentMethod === 'CREDIT_CARD') return { text: 'Já pago pelo app. Não cobrar.', tone: 'bg-emerald-100 text-emerald-900' };
  if (o.paymentMethod === 'CARD_ON_DELIVERY') return { text: `Cobrar ${formatBRL(o.totalCents)} na maquininha`, tone: 'bg-amber-100 text-amber-900' };
  const change = o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)} (levar ${formatBRL(o.changeForCents - o.totalCents)})` : '';
  return { text: `Receber ${formatBRL(o.totalCents)} em dinheiro${change}`, tone: 'bg-amber-100 text-amber-900' };
}

export default function EntregadorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<CourierView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CourierOrder | null>(null);

  const load = useCallback(() => {
    api<CourierView>(`/public/courier/${encodeURIComponent(token)}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <main className="mx-auto max-w-md p-4">{error ? <ErrorBox message={error} /> : <Spinner />}</main>;

  const open = data.batches.filter((b) => b.status === 'OUT');
  const pending = open.flatMap((b) => b.orders.filter((o) => o.status === 'OUT_FOR_DELIVERY'));
  const deliveredToday = data.batches.flatMap((b) => b.orders).filter((o) => o.status === 'COMPLETED').length;

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-16">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">{data.store?.displayName}</p>
          <h1 className="text-xl font-bold">Olá, {data.courier.name.split(' ')[0]} 🛵</h1>
        </div>
        <div className="text-right text-xs text-zinc-500">
          {deliveredToday} entregue{deliveredToday === 1 ? '' : 's'}
          <br />
          nas últimas 12h
        </div>
      </header>
      <ErrorBox message={error} />

      {pending.length === 0 ? (
        <div className="card py-10 text-center text-zinc-500">
          Nenhuma entrega com você agora.
          <br />
          <span className="text-xs">Esta tela atualiza sozinha.</span>
        </div>
      ) : (
        <p className="text-sm font-medium">{pending.length} entrega{pending.length > 1 ? 's' : ''} para fazer</p>
      )}

      {pending.map((o) => {
        const addr = `${o.addressStreet}, ${o.addressNumber}${o.addressComplement ? ` - ${o.addressComplement}` : ''}`;
        const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.addressStreet}, ${o.addressNumber}, ${o.deliveryZoneName ?? ''}`)}`;
        const collect = toCollect(o);
        return (
          <article key={o.id} className="card space-y-3 p-4">
            <header className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-bold">#{o.number} · {o.customerName}</div>
                <div className="text-xs text-zinc-500">Tel.: {o.phoneHint}</div>
              </div>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium">{o.deliveryZoneName}</span>
            </header>
            <div className="text-sm">
              <div className="font-medium">{addr}</div>
              {o.addressReference && <div className="text-zinc-500">Ref.: {o.addressReference}</div>}
              {o.notes && <div className="mt-1 font-medium text-amber-700">Obs.: {o.notes}</div>}
            </div>
            <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${collect.tone}`}>{collect.text}</div>
            <div className="grid grid-cols-2 gap-2">
              <a href={maps} target="_blank" rel="noreferrer" className="btn-ghost py-3">📍 Abrir no mapa</a>
              <button className="btn-primary py-3" disabled={o.locked} onClick={() => setConfirming(o)}>
                {o.locked ? 'Código bloqueado' : '✓ Entreguei'}
              </button>
            </div>
            {o.locked && <p className="text-xs text-red-600">Muitas tentativas erradas. Ligue para o restaurante liberar.</p>}
          </article>
        );
      })}

      {data.store?.whatsapp && (
        <a className="btn-ghost w-full" target="_blank" rel="noreferrer" href={`https://wa.me/${data.store.whatsapp.replace(/\D/g, '')}`}>
          Falar com o restaurante
        </a>
      )}

      {confirming && (
        <ConfirmDialog
          token={token}
          order={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            load();
          }}
        />
      )}
    </main>
  );
}

function ConfirmDialog({ token, order, onClose, onDone }: { token: string; order: CourierOrder; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/public/courier/${encodeURIComponent(token)}/orders/${order.id}/deliver`, { method: 'POST', body: { code } });
      setOk(true);
      setTimeout(onDone, 1200);
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <form role="dialog" aria-label="Confirmar entrega" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        {ok ? (
          <p className="py-8 text-center text-xl font-bold text-emerald-700">✓ Entrega confirmada!</p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold">Pedido #{order.number}</h2>
              <p className="text-sm text-zinc-600">Peça ao cliente os <b>4 últimos números do telefone</b> dele.</p>
            </div>
            <input
              autoFocus
              aria-label="Código de 4 dígitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4}"
              maxLength={4}
              className="input text-center text-3xl tracking-[0.6em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <ErrorBox message={error} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost py-3" onClick={onClose}>Voltar</button>
              <button className="btn-primary py-3" disabled={busy || code.length !== 4}>{busy ? 'Conferindo...' : 'Confirmar'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
