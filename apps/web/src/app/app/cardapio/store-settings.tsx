'use client';

import { useEffect, useState } from 'react';
import { PAYMENT_METHOD_LABELS, formatBRL, parseBRL, type PaymentMethod } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Store } from './types';

const METHODS: PaymentMethod[] = ['PIX', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'];

export function StoreSettings({ canEdit }: { canEdit: boolean }) {
  const [store, setStore] = useState<Store | null>(null);
  const [form, setForm] = useState<Store & { minOrder: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Store>('/cardapio/store', { tenant: true })
      .then((s) => {
        setStore(s);
        setForm({ ...s, minOrder: (s.minOrderCents / 100).toFixed(2).replace('.', ',') });
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!form || !store) return error ? <ErrorBox message={error} /> : <Spinner />;
  const storeUrl = typeof window !== 'undefined' ? `${window.location.origin}/loja/${store.slug}` : `/loja/${store.slug}`;

  async function save(patch?: Partial<Store>) {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const minOrderCents = parseBRL(form.minOrder);
      if (minOrderCents === null) throw new Error('Pedido mínimo inválido.');
      const body = patch ?? {
        slug: form.slug,
        displayName: form.displayName,
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        coverUrl: form.coverUrl || undefined,
        whatsapp: form.whatsapp?.replace(/\D/g, '') || undefined,
        city: form.city?.trim() || undefined,
        acceptsDelivery: form.acceptsDelivery,
        acceptsPickup: form.acceptsPickup,
        minOrderCents,
        paymentMethods: form.paymentMethods,
        estimatedMinutes: Number(form.estimatedMinutes),
      };
      const s = await api<Store>('/cardapio/store', { method: 'PUT', body, tenant: true });
      setStore(s);
      setForm({ ...s, minOrder: (s.minOrderCents / 100).toFixed(2).replace('.', ',') });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Nome na loja</label>
            <input className="input" disabled={!canEdit} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
          </div>
          <div>
            <label className="label">Link da loja na internet</label>
            <div className="flex items-center gap-1 text-sm text-zinc-500">
              /loja/
              <input
                className="input"
                disabled={!canEdit}
                maxLength={60}
                placeholder="pizzaria-do-ze"
                value={form.slug}
                // Só o que vale num link: minúsculas sem acento, números e hífen.
                onChange={(e) =>
                  set(
                    'slug',
                    e.target.value
                      .normalize('NFD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .toLowerCase()
                      .replace(/[^a-z0-9-]+/g, '-')
                      .replace(/-{2,}/g, '-'),
                  )
                }
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">Não é o endereço da rua: é o nome que aparece no link que você divulga.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Descrição</label>
            <input className="input" disabled={!canEdit} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Pizzas artesanais no forno a lenha" />
          </div>
          <div>
            <label className="label">Cidade (para a rota do motoboy)</label>
            <input className="input" disabled={!canEdit} value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Ex.: Campinas - SP" />
          </div>
          <div>
            <label className="label">WhatsApp da loja</label>
            <input className="input" disabled={!canEdit} value={form.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} placeholder="11987654321" />
          </div>
          <div>
            <label className="label">Logo (link da imagem)</label>
            <input className="input" disabled={!canEdit} value={form.logoUrl ?? ''} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="label">Foto de capa (link da imagem)</label>
            <input className="input" disabled={!canEdit} value={form.coverUrl ?? ''} onChange={(e) => set('coverUrl', e.target.value)} placeholder="https://... (horizontal, 1200 × 400)" />
          </div>
          <div>
            <label className="label">Pedido mínimo (R$)</label>
            <input className="input" inputMode="decimal" disabled={!canEdit} value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} />
          </div>
          <div>
            <label className="label">Tempo estimado (minutos)</label>
            <input className="input" type="number" min={5} max={240} disabled={!canEdit} value={form.estimatedMinutes} onChange={(e) => set('estimatedMinutes', Number(e.target.value))} />
          </div>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={form.acceptsDelivery} onChange={(e) => set('acceptsDelivery', e.target.checked)} /> Faz entrega
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={form.acceptsPickup} onChange={(e) => set('acceptsPickup', e.target.checked)} /> Retirada no balcão
          </label>
        </div>
        <div>
          <div className="label">Formas de pagamento</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={form.paymentMethods.includes(m)}
                  onChange={(e) => set('paymentMethods', e.target.checked ? [...form.paymentMethods, m] : form.paymentMethods.filter((x) => x !== m))}
                />
                {PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">Cartão online entra junto com a contratação do gateway de pagamento.</p>
        </div>
        <ErrorBox message={error} />
        {saved && <p className="text-sm text-emerald-700">Salvo.</p>}
        {canEdit && <button className="btn-primary" disabled={busy} onClick={() => save()}>Salvar</button>}
      </section>

      <aside className="card h-fit space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-semibold">{store.isOpen ? 'Loja aberta' : 'Loja fechada'}</div>
            <div className="text-xs text-zinc-500">{store.isOpen ? 'Recebendo pedidos agora.' : 'O cardápio aparece, mas ninguém consegue pedir.'}</div>
          </div>
          <Toggle checked={store.isOpen} disabled={!canEdit || busy} onChange={(v) => save({ isOpen: v })} />
        </div>
        <div className="space-y-1 text-sm">
          <div className="label">Link da loja</div>
          <a href={`/loja/${store.slug}`} target="_blank" className="break-all text-[var(--brand)] underline">{storeUrl}</a>
          <p className="text-xs text-zinc-500">Use no Instagram, no WhatsApp e no QR Code das mesas. Pedido mínimo: {formatBRL(store.minOrderCents)}.</p>
        </div>
      </aside>
    </div>
  );
}
