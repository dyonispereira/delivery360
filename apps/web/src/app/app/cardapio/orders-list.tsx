'use client';

import { useEffect, useState } from 'react';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, formatBRL, type OrderStatus, type PaymentMethod } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface OrderRow {
  id: string;
  number: number;
  status: OrderStatus;
  type: 'DELIVERY' | 'PICKUP';
  customerName: string;
  customerPhone: string;
  deliveryZoneName: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  items: { name: string; quantity: number; options: { name: string }[] }[];
}

/** Lista simples. O painel com alerta, impressão e mudança de status chega na Sprint 3. */
export function OrdersList() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api<OrderRow[]>('/cardapio/orders', { tenant: true }).then(setOrders).catch((e) => setError(e.message));
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (!orders) return error ? <ErrorBox message={error} /> : <Spinner />;
  if (orders.length === 0) return <div className="card text-sm text-zinc-500">Nenhum pedido ainda. Os pedidos pagos (ou com pagamento na entrega) aparecem aqui.</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Atualiza a cada 15 segundos. Painel com alerta, impressão e cozinha chega na próxima etapa.</p>
      {orders.map((o) => (
        <div key={o.id} className="card flex flex-wrap items-start gap-4 py-3">
          <div className="text-lg font-bold">#{o.number}</div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">
              {o.customerName} · {o.type === 'DELIVERY' ? `Entrega (${o.deliveryZoneName})` : 'Retirada'}
            </div>
            <div className="text-zinc-600">
              {o.items.map((i) => `${i.quantity}x ${i.name}${i.options.length ? ` (${i.options.map((x) => x.name).join(', ')})` : ''}`).join(' · ')}
            </div>
            <div className="text-xs text-zinc-500">
              {new Date(o.createdAt).toLocaleString('pt-BR')} · {PAYMENT_METHOD_LABELS[o.paymentMethod]}
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold">{formatBRL(o.totalCents)}</div>
            <Badge tone={o.status === 'CANCELLED' ? 'red' : o.status === 'COMPLETED' ? 'green' : 'amber'}>{ORDER_STATUS_LABELS[o.status]}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
