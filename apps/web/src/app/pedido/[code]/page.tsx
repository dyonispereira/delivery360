'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, type OrderStatus, type OrderTracking } from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { LiveMap } from '@/components/live-map';

const DELIVERY_STEPS: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'COMPLETED'];
const PICKUP_STEPS: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'READY', 'COMPLETED'];
const FINAL: OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export default function TrackingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [order, setOrder] = useState<OrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const load = useCallback(() => {
    api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}`)
      .then((o) => {
        setOrder(o);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.status === 404 ? 'Pedido não encontrado.' : e.message));
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza sozinho enquanto o pedido está em andamento (mais rápido enquanto espera o PIX).
  useEffect(() => {
    if (!order || FINAL.includes(order.status)) return;
    // Mais rápido enquanto espera o PIX e enquanto o motoboy está a caminho (mapa ao vivo).
    const fast = order.status === 'AWAITING_PAYMENT' || order.status === 'OUT_FOR_DELIVERY';
    const t = setInterval(load, fast ? 5000 : 15000);
    return () => clearInterval(t);
  }, [order, load]);

  async function simulate() {
    setSimulating(true);
    try {
      setOrder(await api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}/simulate-payment`, { method: 'POST' }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSimulating(false);
    }
  }

  if (error && !order) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <ErrorBox message={error} />
      </main>
    );
  }
  if (!order) return <Spinner />;

  const steps = order.type === 'DELIVERY' ? DELIVERY_STEPS : PICKUP_STEPS;
  const current = steps.indexOf(order.status);
  const pix = order.paymentMethod === 'PIX' && order.payment;
  const expired = order.payment?.status === 'EXPIRED';

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-10">
      <header className="pt-2">
        {order.store && (
          <Link href={`/loja/${order.store.slug}`} className="text-sm text-[var(--brand)] hover:underline">
            ← {order.store.displayName}
          </Link>
        )}
        <h1 className="mt-1 text-2xl font-bold">Pedido #{order.number}</h1>
        <p className="text-sm text-zinc-500">Olá, {order.customerName.split(' ')[0]}! Acompanhe seu pedido por aqui.</p>
      </header>

      <ErrorBox message={error} />

      <section className="card">
        <p className="text-sm text-zinc-500">Situação</p>
        <p className={`text-lg font-semibold ${order.status === 'CANCELLED' ? 'text-red-600' : ''}`}>
          {expired ? 'Pagamento expirado' : order.type === 'PICKUP' && order.status === 'COMPLETED' ? 'Retirado' : ORDER_STATUS_LABELS[order.status]}
        </p>
        {order.status !== 'AWAITING_PAYMENT' && order.status !== 'CANCELLED' && (
          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i <= current ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500'
                  }`}
                >
                  {i < current || order.status === 'COMPLETED' ? '✓' : i + 1}
                </span>
                <span className={i <= current ? 'font-medium' : 'text-zinc-500'}>
                  {s === 'COMPLETED' && order.type === 'PICKUP' ? 'Retirado' : ORDER_STATUS_LABELS[s]}
                </span>
              </li>
            ))}
          </ol>
        )}
        {order.status === 'OUT_FOR_DELIVERY' && order.courierName && (
          <p className="mt-4 text-sm font-medium">🛵 {order.courierName} está levando seu pedido.</p>
        )}
        {order.store && !FINAL.includes(order.status) && order.status !== 'AWAITING_PAYMENT' && (
          <p className="mt-4 text-sm text-zinc-500">Tempo estimado: cerca de {order.store.estimatedMinutes} minutos.</p>
        )}
      </section>

      {order.status === 'OUT_FOR_DELIVERY' && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Acompanhe no mapa</h2>
          {order.courierLocation ? (
            <>
              <LiveMap courier={order.courierLocation} courierName={order.courierName} />
              <p className="text-xs text-zinc-500">
                Atualizado às {new Date(order.courierLocation.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500">A localização do entregador aparece aqui assim que o celular dele enviar o sinal.</p>
          )}
        </section>
      )}

      {pix && order.status === 'AWAITING_PAYMENT' && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Pague com PIX para confirmar</h2>
          <p className="text-sm text-zinc-600">
            Copie o código abaixo e cole no app do seu banco, em “PIX copia e cola”.
            {order.payment?.expiresAt && (
              <> O código vale até {new Date(order.payment.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</>
            )}
          </p>
          <textarea readOnly className="input font-mono text-xs" rows={3} value={order.payment?.pixCopyPaste ?? ''} />
          <button
            className="btn-primary w-full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(order.payment?.pixCopyPaste ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                /* sem permissão de área de transferência: o cliente copia manualmente */
              }
            }}
          >
            {copied ? 'Copiado!' : 'Copiar código PIX'}
          </button>
          <p className="text-xs text-zinc-500">Esta página atualiza sozinha quando o pagamento for confirmado.</p>
          {order.payment?.canSimulate && (
            <button className="btn-ghost w-full" disabled={simulating} onClick={simulate}>
              {simulating ? 'Confirmando...' : 'Simular pagamento (ambiente de teste)'}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Itens</h2>
        <ul className="divide-y divide-zinc-100 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3 py-2">
              <div>
                <p>
                  {i.quantity}× {i.name}
                </p>
                {i.options.length > 0 && <p className="text-xs text-zinc-500">{i.options.map((o) => o.name).join(', ')}</p>}
                {i.notes && <p className="text-xs text-zinc-500">Obs.: {i.notes}</p>}
              </div>
              <span className="shrink-0">{formatBRL(i.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(order.subtotalCents)}</dd></div>
          {order.type === 'DELIVERY' && <div className="flex justify-between"><dt>Entrega</dt><dd>{formatBRL(order.deliveryFeeCents)}</dd></div>}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatBRL(order.totalCents)}</dd></div>
          <div className="flex justify-between text-zinc-500">
            <dt>Pagamento</dt>
            <dd>
              {PAYMENT_METHOD_LABELS[order.paymentMethod]}
              {order.changeForCents ? ` (troco para ${formatBRL(order.changeForCents)})` : ''}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card text-sm">
        <h2 className="mb-1 font-semibold">{order.type === 'DELIVERY' ? 'Entrega' : 'Retirada na loja'}</h2>
        {order.address ? (
          <p className="text-zinc-600">
            {order.address.street}, {order.address.number}
            {order.address.complement ? ` – ${order.address.complement}` : ''} · {order.address.zone}
          </p>
        ) : (
          <p className="text-zinc-600">Retire seu pedido no balcão informando o número #{order.number}.</p>
        )}
        {order.type === 'DELIVERY' && (
          <p className="mt-2 text-zinc-500">Na entrega, informe ao entregador os <b>4 últimos dígitos do seu telefone</b>: é o código que confirma que o pedido chegou em você.</p>
        )}
      </section>

      {order.store?.whatsapp && (
        <a
          className="btn-ghost w-full"
          href={`https://wa.me/${order.store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Sobre o pedido #${order.number}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Falar com a loja no WhatsApp
        </a>
      )}
    </main>
  );
}
