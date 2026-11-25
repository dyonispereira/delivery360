'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
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
  store: { displayName: string; whatsapp: string | null; city: string | null } | null;
  batches: { id: string; number: number; status: 'OUT' | 'DONE'; createdAt: string; orders: CourierOrder[] }[];
}

/** O que o motoboy precisa receber na porta. */
function toCollect(o: CourierOrder): { text: string; tone: string } {
  if (o.paymentMethod === 'PIX' || o.paymentMethod === 'CREDIT_CARD') return { text: 'Já pago pelo app. Não cobrar.', tone: 'bg-emerald-100 text-emerald-900' };
  if (o.paymentMethod === 'CARD_ON_DELIVERY') return { text: `Cobrar ${formatBRL(o.totalCents)} na maquininha`, tone: 'bg-amber-100 text-amber-900' };
  const change = o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)} (levar ${formatBRL(o.changeForCents - o.totalCents)})` : '';
  return { text: `Receber ${formatBRL(o.totalCents)} em dinheiro${change}`, tone: 'bg-amber-100 text-amber-900' };
}

type GpsState = 'off' | 'asking' | 'on' | 'denied' | 'unsupported';

/**
 * Envia a posição do celular a cada ~10 s enquanto houver entrega em andamento.
 * Funciona com a tela aberta; o app nativo vai mandar também em segundo plano.
 */
function useShareLocation(token: string, active: boolean): GpsState {
  const [state, setState] = useState<GpsState>('off');
  const latest = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!active) {
      setState('off');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState('unsupported');
      return;
    }
    setState('asking');
    const send = () => {
      const pos = latest.current;
      if (!pos) return;
      void api(`/public/courier/${encodeURIComponent(token)}/location`, {
        method: 'POST',
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) },
      }).catch(() => undefined);
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const first = !latest.current;
        latest.current = pos;
        setState('on');
        if (first) send();
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'asking'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    // Envia a última posição a cada 10 s, mesmo parado (sinal de vida para o mapa do cliente).
    const timer = setInterval(send, 10_000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
  }, [active, token]);

  return state;
}

export default function EntregadorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<CourierView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CourierOrder | null>(null);
  const hasPending = !!data?.batches.some((b) => b.status === 'OUT' && b.orders.some((o) => o.status === 'OUT_FOR_DELIVERY'));
  const gps = useShareLocation(token, hasPending);

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

      {pending.length > 0 && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            gps === 'on' ? 'bg-emerald-50 text-emerald-800' : gps === 'denied' || gps === 'unsupported' ? 'bg-red-50 text-red-700' : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          {gps === 'on' && '📡 Localização ativa: o cliente acompanha você no mapa. Deixe esta tela aberta.'}
          {gps === 'asking' && '📡 Ativando a localização... Toque em "Permitir" se o celular perguntar.'}
          {gps === 'denied' && '📡 Localização bloqueada. Libere nas configurações do navegador para o cliente acompanhar a entrega.'}
          {gps === 'unsupported' && '📡 Este celular não informa a localização.'}
        </div>
      )}

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
        const dest = encodeURIComponent([`${o.addressStreet}, ${o.addressNumber}`, o.deliveryZoneName, data.store?.city].filter(Boolean).join(', '));
        // Rota a partir de onde o motoboy está até o cliente (o app de mapas usa a posição atual como origem).
        const maps = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
        const waze = `https://waze.com/ul?q=${dest}&navigate=yes`;
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
              <a href={maps} target="_blank" rel="noreferrer" className="btn-ghost py-3">🧭 Rota (Google Maps)</a>
              <a href={waze} target="_blank" rel="noreferrer" className="btn-ghost py-3">🚗 Rota (Waze)</a>
            </div>
            <div className="grid grid-cols-1">
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
