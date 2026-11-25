'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DELIVERY_FAIL_LABELS, formatBRL, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, type OrderStatus } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { useCurrentTenant } from '../tenant-context';
import {
  autoPrint,
  minutesSince,
  playAlert,
  primaryAction,
  printOrder,
  readPref,
  soundUnlocked,
  unlockSound,
  useBoard,
  writePref,
  type BoardOrder,
} from './board';
import { OrderDetailModal, Stars } from './order-detail';

const COLUMNS: { title: string; statuses: OrderStatus[]; tone: string }[] = [
  { title: 'Novos', statuses: ['PAID'], tone: 'border-t-red-500' },
  { title: 'Em preparo', statuses: ['IN_PREPARATION'], tone: 'border-t-amber-500' },
  { title: 'Prontos e em entrega', statuses: ['READY', 'OUT_FOR_DELIVERY'], tone: 'border-t-sky-500' },
];

export default function PainelPedidosPage() {
  const tenant = useCurrentTenant();
  const [sound, setSound] = useState(false);
  const [auto, setAuto] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setSound(readPref('sound', true));
    setAuto(readPref('autoprint', false));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { orders, error, move } = useBoard(5000, (fresh) => {
    if (sound) playAlert();
    if (auto) fresh.forEach((o) => void autoPrint(o, tenant.name));
    setFlash((cur) => new Set([...cur, ...fresh.map((o) => o.id)]));
    if (typeof document !== 'undefined') document.title = `(${fresh.length}) Novo pedido!`;
  });

  // Título da aba volta ao normal quando a pessoa olha a tela.
  useEffect(() => {
    const reset = () => (document.title = 'Delivery360');
    window.addEventListener('focus', reset);
    return () => window.removeEventListener('focus', reset);
  }, []);

  if (!tenant.activeModules.includes('cardapio')) {
    return <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />;
  }
  if (!orders) return error ? <ErrorBox message={error} /> : <Spinner />;

  const withCouriers = tenant.activeModules.includes('entregas');
  const canCancel = tenant.role === null || tenant.role === 'OWNER' || tenant.role === 'MANAGER';
  const done = orders.filter((o) => o.status === 'COMPLETED' || o.status === 'CANCELLED').reverse();
  const needsUnlock = sound && !soundUnlocked();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Painel de pedidos</h1>
        <Link href="/app/cozinha" className="btn-ghost py-1.5">Tela da cozinha</Link>
        <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Toggle
              checked={sound}
              onChange={(v) => {
                setSound(v);
                writePref('sound', v);
                if (v) void unlockSound().then(playAlert);
              }}
            />
            Alerta sonoro
          </label>
          <label className="flex items-center gap-2">
            <Toggle checked={auto} onChange={(v) => { setAuto(v); writePref('autoprint', v); }} />
            Imprimir automaticamente
          </label>
        </div>
      </div>

      {needsUnlock && (
        <button className="w-full rounded-lg bg-amber-100 px-3 py-2 text-left text-sm text-amber-900" onClick={() => void unlockSound().then(playAlert)}>
          🔔 Toque aqui para ativar o som dos pedidos novos (o navegador exige um clique).
        </button>
      )}
      <ErrorBox message={error} />

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <section key={col.title} className={`rounded-xl border-t-4 bg-zinc-100/70 p-3 ${col.tone}`}>
              <h2 className="mb-3 flex items-center justify-between font-semibold">
                {col.title}
                <span className="rounded-full bg-white px-2 text-sm">{list.length}</span>
              </h2>
              <div className="space-y-3">
                {list.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">Nenhum pedido</p>}
                {list.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    now={now}
                    highlight={flash.has(o.id)}
                    canCancel={canCancel}
                    withCouriers={withCouriers}
                    onSeen={() => setFlash((cur) => { const n = new Set(cur); n.delete(o.id); return n; })}
                    onMove={(to, note) => void move(o.id, to, note)}
                    onPrint={() => printOrder(o, tenant.name)}
                    onDetails={() => setDetailId(o.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section>
        <button className="text-sm text-zinc-600 underline" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Esconder' : 'Ver'} finalizados e cancelados das últimas 12 horas ({done.length})
        </button>
        {showDone && (
          <ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white text-sm">
            {done.map((o) => (
              <li
                key={o.id}
                className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2 hover:bg-zinc-50"
                onClick={() => setDetailId(o.id)}
                title="Ver detalhes da entrega"
              >
                <b>#{o.number}</b>
                <span className="flex-1">{o.customerName}</span>
                {o.ratingStore && <Stars value={o.ratingStore} size="text-sm" />}
                <span>{formatBRL(o.totalCents)}</span>
                <span className={o.status === 'CANCELLED' ? 'text-red-600' : 'text-emerald-700'}>
                  {o.type === 'PICKUP' && o.status === 'COMPLETED' ? 'Retirado' : ORDER_STATUS_LABELS[o.status]}
                </span>
                <span className="text-sky-700 underline">Detalhes</span>
                <button
                  className="text-zinc-500 underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    printOrder(o, tenant.name);
                  }}
                >
                  Imprimir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {detailId && <OrderDetailModal orderId={detailId} canEdit={canCancel} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function OrderCard({
  order: o,
  now,
  highlight,
  canCancel,
  withCouriers,
  onSeen,
  onMove,
  onPrint,
  onDetails,
}: {
  order: BoardOrder;
  now: number;
  highlight: boolean;
  canCancel: boolean;
  withCouriers: boolean;
  onSeen: () => void;
  onMove: (to: OrderStatus, note?: string) => void;
  onPrint: () => void;
  onDetails: () => void;
}) {
  const action = primaryAction(o, withCouriers);
  const awaitingCourier = withCouriers && o.type === 'DELIVERY' && o.status === 'READY';
  const mins = minutesSince(o, now);
  const late = mins >= 30;

  return (
    <article
      onMouseEnter={highlight ? onSeen : undefined}
      onClick={highlight ? onSeen : undefined}
      className={`rounded-lg border bg-white p-3 shadow-sm ${highlight ? 'animate-pulse border-red-400 ring-2 ring-red-300' : 'border-zinc-200'}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold">#{o.number}</div>
          <div className="text-sm font-medium">{o.customerName}</div>
        </div>
        <div className="text-right text-xs">
          <div className={late ? 'font-semibold text-red-600' : 'text-zinc-500'}>{mins} min</div>
          <div className="mt-1 rounded bg-zinc-100 px-1.5 py-0.5 font-medium">{o.type === 'DELIVERY' ? `Entrega · ${o.deliveryZoneName}` : 'Retirada'}</div>
          {o.status !== 'PAID' && o.status !== 'IN_PREPARATION' && <div className="mt-1 text-sky-700">{ORDER_STATUS_LABELS[o.status]}</div>}
        </div>
      </header>

      {o.deliveryIssue && o.status === 'READY' && (
        <div className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">
          <b>⚠ Não entregue: {DELIVERY_FAIL_LABELS[o.deliveryIssue]}.</b> O motoboy volta com o pedido. Reenvie em Entregas ou cancele.
        </div>
      )}

      <ul className="my-2 space-y-0.5 text-sm">
        {o.items.map((i) => (
          <li key={i.id}>
            <b>{i.quantity}x</b> {i.name}
            {i.options.length > 0 && <span className="text-zinc-500"> ({i.options.map((x) => x.name).join(', ')})</span>}
            {i.notes && <div className="text-xs font-medium text-amber-700">Obs.: {i.notes}</div>}
          </li>
        ))}
      </ul>
      {o.notes && <p className="mb-2 text-xs font-medium text-amber-700">Obs. do pedido: {o.notes}</p>}

      <div className="flex items-center justify-between border-t border-zinc-100 pt-2 text-xs text-zinc-600">
        <span>
          {PAYMENT_METHOD_LABELS[o.paymentMethod]}
          {o.changeForCents ? ` · troco p/ ${formatBRL(o.changeForCents)}` : ''}
        </span>
        <b className="text-sm text-zinc-900">{formatBRL(o.totalCents)}</b>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {action && (
          <button className="btn-primary flex-1 py-1.5" onClick={() => onMove(action.to)}>
            {action.label}
          </button>
        )}
        {awaitingCourier && (
          <Link href="/app/entregas" className="btn-primary flex-1 py-1.5">{o.deliveryIssue ? 'Reenviar com motoboy' : 'Despachar com motoboy'}</Link>
        )}
        {o.status === 'IN_PREPARATION' && o.type === 'DELIVERY' && !withCouriers && (
          <button className="btn-ghost py-1.5" onClick={() => onMove('READY')} title="Pronto, aguardando o motoboy">
            Pronto
          </button>
        )}
        <button className="btn-ghost py-1.5" onClick={onDetails}>Detalhes</button>
        <button className="btn-ghost py-1.5" onClick={onPrint} title={o.printedAt ? 'Já impresso; imprimir de novo' : 'Imprimir comanda'}>
          {o.printedAt ? 'Reimprimir' : 'Imprimir'}
        </button>
        {canCancel && (
          <button
            className="btn-ghost py-1.5 text-red-600"
            onClick={() => {
              const refund = o.paymentMethod === 'PIX' ? ' O PIX já foi pago: a devolução ao cliente ainda é feita por fora.' : '';
              const note = window.prompt(`Cancelar o pedido #${o.number}?${refund} Informe o motivo:`);
              if (note !== null) onMove('CANCELLED', note || undefined);
            }}
          >
            Cancelar
          </button>
        )}
      </div>
    </article>
  );
}
