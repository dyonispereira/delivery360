'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DELIVERY_FAIL_LABELS,
  formatBRL,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  TAB_PAYMENT_METHODS,
  RATING_LABELS,
  type DeliveryAttemptInfo,
  type OrderStatus,
} from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { openReceiptPdf, printReceipt } from '@/components/receipt';
import type { Receipt } from '@delivery360/shared';
import type { BoardOrder } from './board';
import { ChannelTag } from './channel-tag';

interface OrderDetail extends BoardOrder {
  deliveredAt: string | null;
  ratingComment: string | null;
  ratedAt: string | null;
  statusHistory: { status: OrderStatus; createdAt: string; note: string | null }[];
  attempts: DeliveryAttemptInfo[];
  tip: { amountCents: number; paidAt: string; paidOutAt: string | null } | null;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Stars({ value, size = 'text-base' }: { value: number; size?: string }) {
  return (
    <span className={`${size} tracking-tight`} title={`${value} de 5 · ${RATING_LABELS[value]}`} aria-label={`${value} de 5 estrelas`}>
      <span className="text-amber-500">{'★'.repeat(value)}</span>
      <span className="text-zinc-300">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

/** Ficha do pedido: quem entregou, placa, data e hora, código, quem recebeu, ocorrências, avaliação e gorjeta. */
export function OrderDetailModal({ orderId, canEdit, onClose }: { orderId: string; canEdit: boolean; onClose: () => void }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<OrderDetail>(`/cardapio/orders/${orderId}/detail`, { tenant: true })
      .then(setOrder)
      .catch((e: ApiError) => setError(e.message));
  }, [orderId]);
  useEffect(load, [load]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Detalhes do pedido"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!order ? (
          error ? <ErrorBox message={error} /> : <Spinner />
        ) : (
          <Body order={order} canEdit={canEdit} reload={load} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function Body({ order: o, canEdit, reload, onClose }: { order: OrderDetail; canEdit: boolean; reload: () => void; onClose: () => void }) {
  const delivered = [...o.attempts].reverse().find((a) => a.outcome === 'DELIVERED');
  const failures = o.attempts.filter((a) => a.outcome === 'FAILED');

  return (
    <div className="space-y-4 text-sm">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">
            Pedido #{o.number} <ChannelTag channel={o.channel} code={o.externalCode} className="align-middle" />
          </h2>
          <p className="text-zinc-600">{o.type === 'DINE_IN' ? `${o.tableName ?? 'Salão'}${o.waiterName ? ` · garçom ${o.waiterName}` : ''}` : o.type === 'COUNTER' ? `Balcão (PDV) · ${o.customerName}${o.waiterName ? ` · caixa ${o.waiterName}` : ''}` : `${o.customerName} · ${o.customerPhone}`}</p>
          <p className={o.status === 'CANCELLED' ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>
            {(o.type === 'PICKUP' || o.type === 'COUNTER') && o.status === 'COMPLETED' ? 'Retirado' : o.type === 'DINE_IN' && o.status === 'COMPLETED' ? 'Servido' : ORDER_STATUS_LABELS[o.status]}
          </p>
        </div>
        <button className="btn-ghost py-1" onClick={onClose} aria-label="Fechar">✕</button>
      </header>

      {o.type === 'DELIVERY' && (
        <section className="rounded-xl border border-zinc-200 p-3">
          <h3 className="mb-2 font-semibold">Entrega</h3>
          <p className="mb-2 text-zinc-600">
            {o.addressStreet}, {o.addressNumber}
            {o.addressComplement ? ` – ${o.addressComplement}` : ''} · {o.deliveryZoneName}
          </p>
          {delivered ? (
            <DeliveredInfo attempt={delivered} canEdit={canEdit} reload={reload} />
          ) : o.status === 'COMPLETED' ? (
            <p className="text-zinc-500">Finalizado pelo painel em {o.deliveredAt ? dateTime(o.deliveredAt) : '—'}, sem confirmação do motoboy.</p>
          ) : (
            <p className="text-zinc-500">Ainda não entregue.</p>
          )}
          {failures.length > 0 && (
            <div className="mt-3 space-y-2">
              <h4 className="font-medium text-red-700">Ocorrências</h4>
              {failures.map((a) => (
                <div key={a.id} className="rounded-lg bg-red-50 p-2 text-red-900">
                  <b>{a.failReason ? DELIVERY_FAIL_LABELS[a.failReason] : 'Não entregue'}</b>
                  <div className="text-xs">
                    {dateTime(a.createdAt)} · {a.courierName}
                    {a.courierPlate ? ` · placa ${a.courierPlate}` : ''}
                    {a.batchNumber ? ` · lote ${a.batchNumber}` : ''}
                  </div>
                  {a.note && <div className="text-xs">“{a.note}”</div>}
                  <MapLink a={a} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {(o.ratedAt || o.tip) && (
        <section className="rounded-xl border border-zinc-200 p-3">
          <h3 className="mb-2 font-semibold">Avaliação do cliente</h3>
          {o.ratedAt ? (
            <dl className="space-y-1">
              <div className="flex items-center justify-between"><dt>Restaurante</dt><dd><Stars value={o.ratingStore!} /></dd></div>
              {o.ratingDelivery && <div className="flex items-center justify-between"><dt>Entrega</dt><dd><Stars value={o.ratingDelivery} /></dd></div>}
              {o.ratingComment && <p className="mt-1 rounded-lg bg-zinc-50 p-2 italic">“{o.ratingComment}”</p>}
            </dl>
          ) : (
            <p className="text-zinc-500">Ainda não avaliou.</p>
          )}
          {o.tip && (
            <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900">
              💚 Gorjeta de <b>{formatBRL(o.tip.amountCents)}</b> para o motoboy ·{' '}
              {o.tip.paidOutAt ? `repassada em ${dateTime(o.tip.paidOutAt)}` : 'a repassar (tela Entregas)'}
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 p-3">
        <h3 className="mb-2 font-semibold">Itens</h3>
        <ul className="space-y-1">
          {o.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span>
                {i.quantity}x {i.name}
                {i.options.length > 0 && <span className="text-zinc-500"> ({i.options.map((x) => x.name).join(', ')})</span>}
              </span>
              <span>{formatBRL(i.totalCents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t border-zinc-100 pt-2 font-semibold">
          <span>Total · {o.type === 'COUNTER' ? 'pago no balcão' : o.type === 'DINE_IN' ? (o.status === 'COMPLETED' ? (TAB_PAYMENT_METHODS.find((m) => m.method === o.paymentMethod)?.label ?? 'Salão') : 'conta da mesa aberta') : PAYMENT_METHOD_LABELS[o.paymentMethod]}</span>
          <span>{formatBRL(o.totalCents)}</span>
        </div>
      </section>

      {o.type !== 'DINE_IN' && o.status !== 'AWAITING_PAYMENT' && (!o.channel || o.channel === 'LOJA') && <ReceiptActions orderId={o.id} cancelled={o.status === 'CANCELLED'} />}

      <section>
        <h3 className="mb-2 font-semibold">Linha do tempo</h3>
        <ol className="space-y-1 border-l-2 border-zinc-200 pl-3">
          {o.statusHistory.map((h, i) => (
            <li key={i}>
              <span className="text-zinc-500">{dateTime(h.createdAt)}</span> · <b>{ORDER_STATUS_LABELS[h.status]}</b>
              {h.note && <span className="text-zinc-600"> · {h.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function DeliveredInfo({ attempt: a, canEdit, reload }: { attempt: DeliveryAttemptInfo; canEdit: boolean; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.receiverName ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await api(`/entregas/attempts/${a.id}`, { method: 'PATCH', tenant: true, body: { receiverName: name } });
      setEditing(false);
      reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt className="text-zinc-500">Motoboy</dt>
      <dd className="font-medium">{a.courierName}</dd>
      <dt className="text-zinc-500">Placa</dt>
      <dd className="font-mono">{a.courierPlate ?? '—'}</dd>
      <dt className="text-zinc-500">Data e hora</dt>
      <dd>{dateTime(a.createdAt)}</dd>
      <dt className="text-zinc-500">Código conferido</dt>
      <dd className="font-mono">{a.code ?? '—'}</dd>
      <dt className="text-zinc-500">Quem recebeu</dt>
      <dd>
        {editing ? (
          <span className="flex gap-2">
            <input className="input py-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn-primary py-1" onClick={save}>Salvar</button>
          </span>
        ) : (
          <>
            <b>{a.receiverName ?? '—'}</b>
            {canEdit && (
              <button className="ml-2 text-xs text-zinc-500 underline" onClick={() => setEditing(true)}>
                corrigir
              </button>
            )}
          </>
        )}
        {error && <span className="block text-xs text-red-600">{error}</span>}
      </dd>
      {a.batchNumber && (
        <>
          <dt className="text-zinc-500">Lote</dt>
          <dd>{a.batchNumber}</dd>
        </>
      )}
      {new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime() > 2000 && (
        <dd className="col-span-2 text-xs text-zinc-400">Registro corrigido pelo restaurante em {dateTime(a.updatedAt)}.</dd>
      )}
      <dd className="col-span-2"><MapLink a={a} /></dd>
    </dl>
  );
}

function MapLink({ a }: { a: DeliveryAttemptInfo }) {
  if (a.lat === null || a.lng === null) return null;
  return (
    <a className="text-xs text-sky-700 underline" href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">
      Ver no mapa onde o motoboy estava
    </a>
  );
}

/** Cupom do pedido: imprimir na térmica, abrir em PDF e emitir a NFC-e (se a loja usa nota). */
function ReceiptActions({ orderId, cancelled }: { orderId: string; cancelled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const receipt = () => api<Receipt>(`/cardapio/pdv/pedidos/${orderId}/cupom`, { tenant: true });
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3 className="mb-2 font-semibold">Cupom e nota fiscal</h3>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost py-1.5" disabled={busy} onClick={() => run(async () => printReceipt(await receipt()))}>
          🖨️ Imprimir cupom
        </button>
        <button className="btn-ghost py-1.5" disabled={busy} onClick={() => run(() => openReceiptPdf(orderId))}>
          📄 PDF
        </button>
        {!cancelled && (
          <button
            className="btn-ghost py-1.5"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const doc = await api<{ number: number; status: string; message: string | null }>(`/cardapio/pdv/pedidos/${orderId}/nfce`, { method: 'POST', tenant: true, body: {} });
                setMsg(doc.status === 'AUTHORIZED' ? `NFC-e nº ${doc.number} autorizada.` : (doc.message ?? 'Nota enviada; aguardando a SEFAZ.'));
              })
            }
          >
            🧾 Emitir NFC-e
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-emerald-700">{msg}</p>}
      <ErrorBox message={error} />
    </section>
  );
}
