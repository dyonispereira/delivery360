'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_LABELS, DELIVERY_FAIL_LABELS, formatBRL, PAYMENT_METHOD_LABELS, type DeliveryFailReason, type OrderStatus, type PaymentMethod, type SalesChannel } from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { BrandMark, Icon } from '@/components/icons';

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
  /** Pedido de app (iFood, 99Food, Keeta) com código de entrega do próprio app. */
  channel?: SalesChannel;
  externalCode?: string | null;
  appCode?: boolean;
}
interface CourierView {
  courier: { name: string };
  store: { displayName: string; whatsapp: string | null; city: string | null } | null;
  batches: { id: string; number: number; status: 'OUT' | 'DONE'; createdAt: string; orders: CourierOrder[] }[];
}

/** O que o motoboy precisa receber na porta. */
function toCollect(o: CourierOrder): { text: string; tone: string } {
  if (o.paymentMethod === 'PIX' || o.paymentMethod === 'CREDIT_CARD' || o.paymentMethod === 'APP_ONLINE') return { text: 'Já pago pelo app. Não cobrar.', tone: 'bg-emerald-100 text-emerald-900' };
  if (o.paymentMethod === 'CARD_ON_DELIVERY') return { text: `Cobrar ${formatBRL(o.totalCents)} na maquininha`, tone: 'bg-amber-100 text-amber-900' };
  const change = o.changeForCents ? ` · troco para ${formatBRL(o.changeForCents)} (levar ${formatBRL(o.changeForCents - o.totalCents)})` : '';
  return { text: `Receber ${formatBRL(o.totalCents)} em dinheiro${change}`, tone: 'bg-amber-100 text-amber-900' };
}

interface CourierHistory {
  today: { delivered: number; failed: number; feeCents: number };
  tips: { pendingCents: number; paidOutCents: number };
  items: {
    id: string;
    outcome: 'DELIVERED' | 'FAILED';
    failReason: DeliveryFailReason | null;
    note: string | null;
    receiverName: string | null;
    batchNumber: number | null;
    createdAt: string;
    tip: { amountCents: number; paidOutAt: string | null } | null;
    order: { number: number; customerName: string; address: string | null; zone: string | null; totalCents: number; paymentMethod: PaymentMethod };
  }[];
}

/** Bip + vibração quando chega pedido novo (o navegador só deixa tocar som depois de um toque na tela). */
function notifyNewOrder() {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* sem vibração */
  }
  try {
    const ctx = new AudioContext();
    [0, 0.35].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    /* sem som */
  }
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
  const [failing, setFailing] = useState<CourierOrder | null>(null);
  const [tab, setTab] = useState<'agora' | 'historico'>('agora');
  const [fresh, setFresh] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const hasPending = !!data?.batches.some((b) => b.status === 'OUT' && b.orders.some((o) => o.status === 'OUT_FOR_DELIVERY'));
  const gps = useShareLocation(token, hasPending);

  const load = useCallback(() => {
    api<CourierView>(`/public/courier/${encodeURIComponent(token)}`)
      .then((d) => {
        // Pedido novo atribuído a este motoboy: avisa com som, vibração e um aviso na tela.
        const ids = d.batches.flatMap((b) => b.orders.filter((o) => o.status === 'OUT_FOR_DELIVERY').map((o) => o.id));
        if (known.current) {
          const added = ids.filter((id) => !known.current!.has(id)).length;
          if (added > 0) {
            notifyNewOrder();
            setFresh(added);
            setTab('agora');
          }
        }
        known.current = new Set(ids);
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data)
    return (
      <main className="min-h-screen bg-[#0d0b0a] p-4 text-white">
        <div className="mx-auto max-w-md">{error ? <ErrorBox message={error} /> : <Spinner />}</div>
      </main>
    );

  const open = data.batches.filter((b) => b.status === 'OUT');
  const pending = open.flatMap((b) => b.orders.filter((o) => o.status === 'OUT_FOR_DELIVERY'));

  return (
    <div className="min-h-screen bg-[#f6f1ea]">
    <header className="relative overflow-hidden rounded-b-[32px] bg-[image:var(--grad-night)] px-4 pb-6 pt-5 text-white shadow-[0_20px_40px_-24px_rgba(0,0,0,0.8)]">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-500/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-red-600/25 blur-3xl" />
      <div className="relative mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandMark className="h-11 w-11" />
            <div>
              <p className="text-xs font-medium text-orange-200/80">{data.store?.displayName}</p>
              <h1 className="text-xl font-black tracking-tight">Olá, {data.courier.name.split(' ')[0]}!</h1>
            </div>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${
              pending.length === 0 ? 'bg-white/10 text-zinc-300' : gps === 'on' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${pending.length === 0 ? 'bg-zinc-400' : gps === 'on' ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
            {pending.length === 0 ? 'Aguardando' : gps === 'on' ? 'No mapa' : 'Sem GPS'}
          </span>
        </div>
        <div className="flex items-end justify-between rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Entregas agora</div>
            <div className="text-4xl font-black leading-none">
              <span className="text-fire">{pending.length}</span>
            </div>
          </div>
          <Icon name="bike" className="h-12 w-12 text-orange-400/80" strokeWidth={1.4} />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/5 p-1 text-sm ring-1 ring-white/10">
          {(['agora', 'historico'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 transition ${
                tab === t ? 'bg-[image:var(--grad-ember)] font-bold text-white shadow-[0_8px_20px_-8px_rgba(229,37,42,0.9)]' : 'text-zinc-400'
              }`}
            >
              <Icon name={t === 'agora' ? 'pin' : 'history'} className="h-4 w-4" />
              {t === 'agora' ? `Minhas entregas${pending.length ? ` (${pending.length})` : ''}` : 'Histórico'}
            </button>
          ))}
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-md space-y-4 p-4 pb-16">
      <ErrorBox message={error} />

      {fresh > 0 && (
        <button className="w-full animate-pulse rounded-2xl bg-[image:var(--grad-ember)] px-4 py-3.5 text-left font-bold text-white shadow-lg" onClick={() => setFresh(0)}>
          🔔 {fresh === 1 ? 'Novo pedido para você!' : `${fresh} pedidos novos para você!`} Toque para fechar o aviso.
        </button>
      )}

      {tab === 'historico' ? (
        <History token={token} />
      ) : (
        <>

      {pending.length > 0 && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
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
        <div className="card flex flex-col items-center gap-3 py-10 text-center text-zinc-500">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-orange-500">
            <Icon name="bike" className="h-8 w-8" />
          </span>
          <span className="font-semibold text-zinc-800">Nenhuma entrega com você agora</span>
          <span className="text-xs">Esta tela atualiza sozinha e toca um aviso quando chegar pedido.</span>
        </div>
      ) : (
        <p className="px-1 text-sm font-bold text-zinc-700">{pending.length} entrega{pending.length > 1 ? 's' : ''} para fazer</p>
      )}

      {pending.map((o) => {
        const addr = `${o.addressStreet}, ${o.addressNumber}${o.addressComplement ? ` - ${o.addressComplement}` : ''}`;
        const dest = encodeURIComponent([`${o.addressStreet}, ${o.addressNumber}`, o.deliveryZoneName, data.store?.city].filter(Boolean).join(', '));
        // Rota a partir de onde o motoboy está até o cliente (o app de mapas usa a posição atual como origem).
        const maps = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
        const waze = `https://waze.com/ul?q=${dest}&navigate=yes`;
        const collect = toCollect(o);
        return (
          <article key={o.id} className="card relative space-y-3 overflow-hidden rounded-3xl p-4 pt-5">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-[image:var(--grad-fire)]" />
            <header className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-black text-white">#{o.number}</span>
                <div>
                <div className="text-lg font-black leading-tight">{o.customerName}</div>
                <div className="text-xs text-zinc-500">
                  {o.channel && o.channel !== 'LOJA' ? `${CHANNEL_LABELS[o.channel]}${o.externalCode ? ` ${o.externalCode}` : ''} · ` : ''}Tel.: {o.phoneHint}
                </div>
                </div>
              </div>
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">{o.deliveryZoneName}</span>
            </header>
            <div className="flex gap-2 rounded-2xl bg-zinc-50 p-3 text-sm">
              <Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div>
              <div className="font-semibold">{addr}</div>
              {o.addressReference && <div className="text-zinc-500">Ref.: {o.addressReference}</div>}
              {o.notes && <div className="mt-1 font-medium text-amber-700">Obs.: {o.notes}</div>}
              </div>
            </div>
            <div className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-bold ${collect.tone}`}>
              <Icon name="money" className="h-5 w-5 shrink-0" /> {collect.text}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a href={maps} target="_blank" rel="noreferrer" className="btn-ghost rounded-2xl py-3">
                <Icon name="map" className="h-4 w-4 text-orange-500" /> Google Maps
              </a>
              <a href={waze} target="_blank" rel="noreferrer" className="btn-ghost rounded-2xl py-3">
                <Icon name="map" className="h-4 w-4 text-orange-500" /> Waze
              </a>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button className="btn-primary rounded-2xl py-4 text-base" disabled={o.locked} onClick={() => setConfirming(o)}>
                {o.locked ? 'Código bloqueado' : <><Icon name="check" className="h-5 w-5" strokeWidth={2.6} /> Entreguei</>}
              </button>
              <button className="btn-ghost py-2.5 text-red-700" onClick={() => setFailing(o)}>
                ✕ Não consegui entregar
              </button>
            </div>
            {o.locked && <p className="text-xs text-red-600">Muitas tentativas erradas. Ligue para o restaurante liberar.</p>}
          </article>
        );
      })}

        </>
      )}

      {data.store?.whatsapp && (
        <a className="btn-ghost w-full rounded-2xl py-3" target="_blank" rel="noreferrer" href={`https://wa.me/${data.store.whatsapp.replace(/\D/g, '')}`}>
          Falar com o restaurante
        </a>
      )}

      {failing && (
        <FailDialog
          token={token}
          order={failing}
          onClose={() => setFailing(null)}
          onDone={() => {
            setFailing(null);
            load();
          }}
        />
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
    </div>
  );
}

function ConfirmDialog({ token, order, onClose, onDone }: { token: string; order: CourierOrder; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [receiver, setReceiver] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/public/courier/${encodeURIComponent(token)}/orders/${order.id}/deliver`, { method: 'POST', body: { code, receiverName: receiver.trim() } });
      setOk(true);
      setTimeout(onDone, 1200);
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form role="dialog" aria-label="Confirmar entrega" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-t-[28px] bg-white p-5 sm:rounded-[28px]">
        {ok ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-16 w-16 animate-rise items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
              <Icon name="check" className="h-9 w-9" strokeWidth={3} />
            </span>
            <p className="text-xl font-black text-emerald-700">Entrega confirmada!</p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold">Pedido #{order.number}</h2>
              {order.appCode ? (
                <p className="text-sm text-zinc-600">
                  Peça ao cliente o <b>código de entrega do {CHANNEL_LABELS[order.channel ?? 'LOJA']}</b> (4 números que aparecem no app dele).
                </p>
              ) : (
                <p className="text-sm text-zinc-600">Peça ao cliente os <b>4 últimos números do telefone</b> dele.</p>
              )}
            </div>
            <input
              autoFocus
              aria-label="Código de 4 dígitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4}"
              maxLength={4}
              className="input rounded-2xl py-4 text-center text-4xl font-black tracking-[0.6em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <div>
              <label className="label" htmlFor="receiver">Nome de quem recebeu</label>
              <input
                id="receiver"
                className="input"
                autoComplete="off"
                placeholder="Ex.: Maria (porteiro, vizinho...)"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
              />
              <button type="button" className="mt-1 text-xs text-sky-700 underline" onClick={() => setReceiver(order.customerName)}>
                Foi o próprio cliente ({order.customerName.split(' ')[0]})
              </button>
            </div>
            <p className="text-xs text-zinc-500">Depois de confirmar, a entrega não pode ser alterada por você. Só o restaurante corrige.</p>
            <ErrorBox message={error} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost py-3" onClick={onClose}>Voltar</button>
              <button className="btn-primary py-3" disabled={busy || code.length !== 4 || receiver.trim().length < 2}>{busy ? 'Conferindo...' : 'Confirmar'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

const FAIL_OPTIONS: { reason: DeliveryFailReason; hint: string }[] = [
  { reason: 'ADDRESS_NOT_FOUND', hint: 'Não achei o endereço ou o número.' },
  { reason: 'CUSTOMER_ABSENT', hint: 'Ninguém atende, cliente dormindo ou não está.' },
  { reason: 'CUSTOMER_REFUSED', hint: 'O cliente não quis receber ou não quer mais o pedido.' },
  { reason: 'OTHER', hint: 'Explique abaixo.' },
];

/** O motoboy registra a ocorrência; o pedido volta para o restaurante, que decide reenviar ou cancelar. */
function FailDialog({ token, order, onClose, onDone }: { token: string; order: CourierOrder; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<DeliveryFailReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/public/courier/${encodeURIComponent(token)}/orders/${order.id}/fail`, { method: 'POST', body: { reason, note: note.trim() || undefined } });
      setOk(true);
      setTimeout(onDone, 2000);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form role="dialog" aria-label="Não consegui entregar" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px]">
        {ok ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-xl font-bold text-zinc-800">Ocorrência registrada</p>
            <p className="text-sm text-zinc-600">Volte com o pedido para o restaurante. Eles decidem se reenviam ou cancelam.</p>
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold">Não consegui entregar o #{order.number}</h2>
              <p className="text-sm text-zinc-600">Escolha o que aconteceu. O restaurante é avisado na hora.</p>
            </div>
            <div className="space-y-2">
              {FAIL_OPTIONS.map((opt) => (
                <label
                  key={opt.reason}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${reason === opt.reason ? 'border-red-500 bg-red-50' : 'border-zinc-200'}`}
                >
                  <input type="radio" name="reason" className="mt-1 accent-red-600" checked={reason === opt.reason} onChange={() => setReason(opt.reason)} />
                  <span>
                    <span className="block font-medium">{DELIVERY_FAIL_LABELS[opt.reason]}</span>
                    <span className="block text-xs text-zinc-500">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="fail-note">O que aconteceu? {reason === 'OTHER' ? '' : '(opcional)'}</label>
              <textarea id="fail-note" className="input" rows={2} maxLength={300} placeholder="Ex.: toquei 3 vezes e liguei, ninguém atendeu" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <ErrorBox message={error} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost py-3" onClick={onClose}>Voltar</button>
              <button className="btn-primary bg-red-600 py-3" disabled={busy || !reason || (reason === 'OTHER' && note.trim().length < 3)}>
                {busy ? 'Enviando...' : 'Registrar'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** Histórico do motoboy (só leitura): entregas, ocorrências e gorjetas dos últimos 30 dias. */
function History({ token }: { token: string }) {
  const [data, setData] = useState<CourierHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<CourierHistory>(`/public/courier/${encodeURIComponent(token)}/history`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, [token]);
  if (!data) return error ? <ErrorBox message={error} /> : <Spinner />;

  const groups = new Map<string, CourierHistory['items']>();
  for (const i of data.items) {
    const day = new Date(i.createdAt).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    groups.set(day, [...(groups.get(day) ?? []), i]);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card rounded-2xl p-3">
          <div className="text-2xl font-black text-emerald-600">{data.today.delivered}</div>
          <div className="text-xs text-zinc-500">entregues hoje</div>
        </div>
        <div className="card rounded-2xl p-3">
          <div className="text-2xl font-black text-red-600">{data.today.failed}</div>
          <div className="text-xs text-zinc-500">ocorrências hoje</div>
        </div>
        <div className="card rounded-2xl bg-zinc-900 p-3 text-white">
          <div className="text-fire text-lg font-black">{formatBRL(data.today.feeCents)}</div>
          <div className="text-xs text-zinc-400">a receber hoje</div>
        </div>
      </div>
      {(data.tips.pendingCents > 0 || data.tips.paidOutCents > 0) && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          💚 Gorjetas dos clientes: <b>{formatBRL(data.tips.pendingCents)}</b> a receber do restaurante
          {data.tips.paidOutCents > 0 && <> · {formatBRL(data.tips.paidOutCents)} já recebidas</>}
        </div>
      )}
      <p className="text-xs text-zinc-500">Registros dos últimos 30 dias. Depois de confirmado, só o restaurante pode alterar.</p>
      {data.items.length === 0 && <div className="card py-8 text-center text-sm text-zinc-500">Nenhuma entrega registrada ainda.</div>}
      {[...groups.entries()].map(([day, items]) => (
        <section key={day} className="space-y-2">
          <h3 className="text-sm font-semibold capitalize text-zinc-600">{day}</h3>
          {items.map((i) => (
            <article key={i.id} className={`card space-y-1 p-3 text-sm ${i.outcome === 'FAILED' ? 'border-red-200' : ''}`}>
              <header className="flex items-center justify-between gap-2">
                <b>#{i.order.number} · {i.order.customerName}</b>
                <span className="text-xs text-zinc-500">{new Date(i.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              </header>
              {i.order.address && <div className="text-xs text-zinc-500">{i.order.address} · {i.order.zone}</div>}
              {i.outcome === 'DELIVERED' ? (
                <div className="text-emerald-700">✓ Entregue a <b>{i.receiverName}</b></div>
              ) : (
                <div className="text-red-700">
                  ✕ {i.failReason ? DELIVERY_FAIL_LABELS[i.failReason] : 'Não entregue'}
                  {i.note && <span className="text-zinc-600"> · “{i.note}”</span>}
                </div>
              )}
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{formatBRL(i.order.totalCents)} · {PAYMENT_METHOD_LABELS[i.order.paymentMethod]}</span>
                {i.tip && <span className="font-medium text-emerald-700">💚 gorjeta {formatBRL(i.tip.amountCents)}{i.tip.paidOutAt ? ' (recebida)' : ''}</span>}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
