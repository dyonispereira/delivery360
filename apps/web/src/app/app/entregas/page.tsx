'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, parseBRL, PAYMENT_METHOD_LABELS, type OrderStatus, type PaymentMethod } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';

interface DeliveryOrder {
  id: string;
  number: number;
  status: OrderStatus;
  customerName: string;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  deliveryZoneName: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  deliveredAt: string | null;
  deliveryCodeFails: number;
  createdAt: string;
}
interface Batch {
  id: string;
  number: number;
  status: 'OUT' | 'DONE' | 'CANCELLED';
  createdAt: string;
  finishedAt: string | null;
  courier: { id: string; name: string };
  orders: DeliveryOrder[];
}
interface Courier {
  id: string;
  name: string;
  phone: string;
  feeCents: number;
  active: boolean;
  accessToken: string;
}

const courierLink = (token: string) => `${window.location.origin}/entregador/${token}`;
const address = (o: DeliveryOrder) => `${o.addressStreet}, ${o.addressNumber}${o.addressComplement ? ` - ${o.addressComplement}` : ''} · ${o.deliveryZoneName}`;
const formatPhone = (p: string) => {
  const d = p.replace(/^55/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p;
};

export default function EntregasPage() {
  const tenant = useCurrentTenant();
  const [tab, setTab] = useState<'lotes' | 'motoboys'>('lotes');
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = tenant.role === null || tenant.role === 'OWNER' || tenant.role === 'MANAGER';

  const loadCouriers = useCallback(() => api<Courier[]>('/entregas/couriers', { tenant: true }).then(setCouriers).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void loadCouriers();
  }, [loadCouriers]);

  if (!tenant.activeModules.includes('entregas')) {
    return (
      <div className="card max-w-lg space-y-2">
        <ErrorBox message={`O módulo Entregas não está contratado para ${tenant.name}.`} />
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Entregas</h1>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {(['lotes', 'motoboys'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}>
              {t === 'lotes' ? 'Lotes de entrega' : 'Motoboys'}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox message={error} />
      {!couriers ? <Spinner /> : tab === 'lotes' ? <Batches couriers={couriers} canManage={canManage} /> : <Couriers couriers={couriers} canManage={canManage} reload={loadCouriers} />}
    </div>
  );
}

function Batches({ couriers, canManage }: { couriers: Courier[]; canManage: boolean }) {
  const [data, setData] = useState<{ queue: DeliveryOrder[]; batches: Batch[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courierId, setCourierId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = couriers.filter((c) => c.active);

  const load = useCallback(async () => {
    try {
      const d = await api<{ queue: DeliveryOrder[]; batches: Batch[] }>('/entregas/overview', { tenant: true });
      setData(d);
      setSelected((cur) => new Set([...cur].filter((id) => d.queue.some((o) => o.id === id))));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  if (!data) return <Spinner />;
  const out = data.batches.filter((b) => b.status === 'OUT');
  const done = data.batches.filter((b) => b.status === 'DONE');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="card space-y-3">
        <h2 className="font-semibold">Prontos para sair ({data.queue.length})</h2>
        <p className="text-xs text-zinc-500">Pedidos de entrega em preparo ou prontos. Marque os que vão juntos e escolha o motoboy.</p>
        {data.queue.length === 0 && <p className="py-6 text-center text-sm text-zinc-400">Nenhum pedido esperando motoboy.</p>}
        <ul className="divide-y divide-zinc-100">
          {data.queue.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-start gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--brand)]"
                  checked={selected.has(o.id)}
                  onChange={(e) => {
                    const n = new Set(selected);
                    if (e.target.checked) n.add(o.id);
                    else n.delete(o.id);
                    setSelected(n);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <b>#{o.number}</b> {o.customerName}
                  <span className="block truncate text-zinc-500">{address(o)}</span>
                </span>
                <span className="text-right">
                  <Badge tone={o.status === 'READY' ? 'green' : 'amber'}>{o.status === 'READY' ? 'Pronto' : 'Em preparo'}</Badge>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {data.queue.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
            <select className="input flex-1" value={courierId} onChange={(e) => setCourierId(e.target.value)} aria-label="Motoboy">
              <option value="">{active.length ? 'Escolha o motoboy' : 'Cadastre um motoboy primeiro'}</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              className="btn-primary"
              disabled={busy || !courierId || selected.size === 0}
              onClick={() =>
                act(async () => {
                  await api('/entregas/batches', { method: 'POST', tenant: true, body: { courierId, orderIds: [...selected] } });
                  setSelected(new Set());
                })
              }
            >
              Despachar {selected.size > 0 ? `${selected.size} pedido${selected.size > 1 ? 's' : ''}` : ''}
            </button>
          </div>
        )}
        <ErrorBox message={error} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Na rua ({out.length})</h2>
        {out.length === 0 && <div className="card text-center text-sm text-zinc-400">Nenhum lote em entrega.</div>}
        {out.map((b) => {
          const delivered = b.orders.filter((o) => o.status === 'COMPLETED').length;
          return (
            <article key={b.id} className="card space-y-2 py-4">
              <header className="flex items-center justify-between gap-2">
                <div>
                  <b>Lote {b.number}</b> · 🛵 {b.courier.name}
                  <div className="text-xs text-zinc-500">Saiu às {new Date(b.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <Badge tone={delivered === b.orders.length ? 'green' : 'amber'}>{delivered} de {b.orders.length} entregues</Badge>
              </header>
              <ul className="divide-y divide-zinc-100 text-sm">
                {b.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className={o.status === 'COMPLETED' ? 'text-emerald-700' : ''}>{o.status === 'COMPLETED' ? '✓' : '•'}</span>
                    <span className="min-w-0 flex-1">
                      <b>#{o.number}</b> {o.customerName}
                      <span className="block truncate text-xs text-zinc-500">{address(o)}</span>
                    </span>
                    {o.status === 'OUT_FOR_DELIVERY' && o.deliveryCodeFails >= 5 && (
                      canManage ? (
                        <button className="text-xs font-medium text-red-600 underline" onClick={() => act(() => api(`/entregas/orders/${o.id}/unlock-code`, { method: 'POST', tenant: true }))}>
                          Código bloqueado: liberar
                        </button>
                      ) : (
                        <span className="text-xs text-red-600">Código bloqueado (chame o gerente)</span>
                      )
                    )}
                    {o.status === 'OUT_FOR_DELIVERY' && (
                      <button className="text-xs text-zinc-500 underline" onClick={() => act(() => api(`/entregas/orders/${o.id}/remove-from-batch`, { method: 'POST', tenant: true }))}>
                        Tirar do lote
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}

        {done.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-600">Lotes concluídos nas últimas 12 horas ({done.length})</summary>
            <ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
              {done.map((b) => (
                <li key={b.id} className="flex justify-between px-4 py-2">
                  <span>
                    Lote {b.number} · {b.courier.name} · {b.orders.length} pedido{b.orders.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-zinc-500">
                    {new Date(b.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} →{' '}
                    {b.finishedAt && new Date(b.finishedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

function Couriers({ couriers, canManage, reload }: { couriers: Courier[]; canManage: boolean; reload: () => Promise<unknown> }) {
  const [form, setForm] = useState({ name: '', phone: '', fee: '' });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <form
          className="card grid gap-3 sm:grid-cols-[1fr_12rem_9rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const feeCents = form.fee.trim() ? parseBRL(form.fee) : 0;
            if (feeCents === null) return setError('Valor por entrega inválido.');
            void act(async () => {
              await api('/entregas/couriers', { method: 'POST', tenant: true, body: { name: form.name, phone: form.phone, feeCents } });
              setForm({ name: '', phone: '', fee: '' });
            });
          }}
        >
          <div>
            <label className="label" htmlFor="m-name">Nome do motoboy</label>
            <input id="m-name" className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="m-phone">Celular (WhatsApp)</label>
            <input id="m-phone" className="input" required type="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="m-fee">Paga por entrega</label>
            <input id="m-fee" className="input" inputMode="decimal" placeholder="R$ 0,00" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          </div>
          <button className="btn-primary">Cadastrar</button>
        </form>
      )}
      <ErrorBox message={error} />

      {couriers.length === 0 && <div className="card text-sm text-zinc-500">Nenhum motoboy cadastrado ainda.</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {couriers.map((c) => {
          const link = courierLink(c.accessToken);
          const msg = `Olá ${c.name.split(' ')[0]}! Este é o seu link de entregas. Guarde nos favoritos do celular: ${link}`;
          return (
            <article key={c.id} className={`card space-y-3 ${c.active ? '' : 'opacity-60'}`}>
              <header className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm text-zinc-500">
                    {formatPhone(c.phone)} · {c.feeCents ? `${formatBRL(c.feeCents)} por entrega` : 'valor por entrega não informado'}
                  </div>
                </div>
                {canManage && (
                  <label className="flex items-center gap-2 text-xs text-zinc-500">
                    {c.active ? 'Ativo' : 'Inativo'}
                    <Toggle checked={c.active} onChange={(v) => void act(() => api(`/entregas/couriers/${c.id}`, { method: 'PATCH', tenant: true, body: { active: v } }))} />
                  </label>
                )}
              </header>
              {c.active && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <a className="btn-ghost py-1.5" target="_blank" rel="noreferrer" href={`https://wa.me/${c.phone}?text=${encodeURIComponent(msg)}`}>
                    Enviar link no WhatsApp
                  </a>
                  <button
                    className="btn-ghost py-1.5"
                    onClick={() =>
                      void navigator.clipboard.writeText(link).then(
                        () => setCopied(c.id),
                        () => window.prompt('Copie o link do motoboy:', link),
                      )
                    }
                  >
                    {copied === c.id ? 'Link copiado!' : 'Copiar link'}
                  </button>
                  {canManage && (
                    <button
                      className="btn-ghost py-1.5 text-zinc-500"
                      title="Use se o celular foi perdido ou o motoboy saiu"
                      onClick={() => {
                        if (window.confirm(`Gerar um link novo para ${c.name}? O link antigo para de funcionar.`)) {
                          void act(() => api(`/entregas/couriers/${c.id}/new-link`, { method: 'POST', tenant: true }));
                        }
                      }}
                    >
                      Gerar novo link
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
