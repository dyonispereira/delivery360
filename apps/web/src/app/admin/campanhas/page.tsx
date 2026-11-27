'use client';

import { useEffect, useState } from 'react';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { BannerPreview, splitLabel } from '@/components/campaign-banner';

type CouponType = 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';

interface Campaign {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  tenantIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  position: number;
  couponCode: string | null;
  type: CouponType;
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  firstOrderOnly: boolean;
  combinesWithPromo: boolean;
  platformShareBps: number;
  label: string | null;
  optedOut: { id: string; name: string }[];
  uses: number;
  discountGivenCents: number;
  platformCostCents: number;
  salesCents: number;
}

interface Tenant {
  id: string;
  name: string;
}

type Funding = 'PLATFORM' | 'RESTAURANT' | 'MIXED';

interface Form {
  title: string;
  subtitle: string;
  imageUrl: string;
  allStores: boolean;
  tenantIds: string[];
  starts: string;
  ends: string;
  position: string;
  active: boolean;
  hasCoupon: boolean;
  code: string;
  type: CouponType;
  value: string;
  maxDiscount: string;
  minOrder: string;
  perCustomer: string;
  maxUses: string;
  firstOrderOnly: boolean;
  combinesWithPromo: boolean;
  funding: Funding;
  /** % bancado pela Delivery360 quando misto. */
  share: string;
}

const EMPTY: Form = {
  title: '',
  subtitle: '',
  imageUrl: '',
  allStores: true,
  tenantIds: [],
  starts: '',
  ends: '',
  position: '0',
  active: true,
  hasCoupon: false,
  code: '',
  type: 'PERCENT',
  value: '10',
  maxDiscount: '',
  minOrder: '',
  perCustomer: '1',
  maxUses: '',
  firstOrderOnly: false,
  combinesWithPromo: false,
  funding: 'PLATFORM',
  share: '50',
};

const toMoney = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-zinc-300 text-zinc-700'}`;

const fundingOf = (bps: number): Funding => (bps >= 10_000 ? 'PLATFORM' : bps <= 0 ? 'RESTAURANT' : 'MIXED');

const fromCampaign = (c: Campaign): Form => ({
  title: c.title,
  subtitle: c.subtitle ?? '',
  imageUrl: c.imageUrl,
  allStores: c.tenantIds.length === 0,
  tenantIds: c.tenantIds,
  starts: toLocalInput(c.startsAt),
  ends: toLocalInput(c.endsAt),
  position: String(c.position),
  active: c.active,
  hasCoupon: !!c.couponCode,
  code: c.couponCode ?? '',
  type: c.type,
  value: c.type === 'PERCENT' ? String(c.value / 100).replace('.', ',') : c.type === 'FIXED' ? toMoney(c.value) : '',
  maxDiscount: toMoney(c.maxDiscountCents),
  minOrder: toMoney(c.minOrderCents),
  perCustomer: c.maxUsesPerCustomer ? String(c.maxUsesPerCustomer) : '',
  maxUses: c.maxUses ? String(c.maxUses) : '',
  firstOrderOnly: c.firstOrderOnly,
  combinesWithPromo: c.combinesWithPromo,
  funding: fundingOf(c.platformShareBps),
  share: c.platformShareBps > 0 && c.platformShareBps < 10_000 ? String(c.platformShareBps / 100) : '50',
});

function toBody(f: Form): Record<string, unknown> | string {
  if (!f.title.trim()) return 'Dê um título para a campanha.';
  if (!/^(https?:\/\/|\/)\S+$/.test(f.imageUrl.trim())) return 'Informe o link da imagem do banner (https://...).';
  if (!f.allStores && f.tenantIds.length === 0) return 'Escolha pelo menos uma loja.';
  const int = (v: string) => (v.trim() ? Number.parseInt(v, 10) : null);
  const base = {
    title: f.title.trim(),
    subtitle: f.subtitle.trim() || null,
    imageUrl: f.imageUrl.trim(),
    tenantIds: f.allStores ? [] : f.tenantIds,
    startsAt: fromLocalInput(f.starts),
    endsAt: fromLocalInput(f.ends),
    position: int(f.position) ?? 0,
    active: f.active,
  };
  if (!f.hasCoupon) return { ...base, couponCode: null };
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(f.code.trim())) return 'Código: de 3 a 20 letras ou números, sem espaços.';
  let value = 0;
  if (f.type === 'PERCENT') {
    const p = Number(f.value.replace(',', '.'));
    if (!(p >= 1 && p <= 100)) return 'O percentual precisa ser de 1 a 100.';
    value = Math.round(p * 100);
  } else if (f.type === 'FIXED') {
    const cents = parseBRL(f.value);
    if (!cents) return 'Informe o valor do desconto.';
    value = cents;
  }
  let platformShareBps = f.funding === 'PLATFORM' ? 10_000 : 0;
  if (f.funding === 'MIXED') {
    const s = Number(f.share.replace(',', '.'));
    if (!(s > 0 && s < 100)) return 'No misto, a parte da Delivery360 fica entre 1% e 99%.';
    platformShareBps = Math.round(s * 100);
  }
  const minOrderCents = f.minOrder.trim() ? parseBRL(f.minOrder) : 0;
  if (minOrderCents === null) return 'Pedido mínimo inválido.';
  return {
    ...base,
    couponCode: f.code.trim().toUpperCase(),
    type: f.type,
    value,
    maxDiscountCents: f.type === 'PERCENT' && f.maxDiscount.trim() ? parseBRL(f.maxDiscount) : null,
    minOrderCents,
    maxUses: int(f.maxUses),
    maxUsesPerCustomer: int(f.perCustomer),
    firstOrderOnly: f.firstOrderOnly,
    combinesWithPromo: f.combinesWithPromo,
    platformShareBps,
  };
}

/** Campanhas da rede: banners que a Delivery360 roda nas lojas, com ou sem cupom. */
export default function CampaignsPage() {
  const [data, setData] = useState<{ campaigns: Campaign[]; tenants: Tenant[] } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  const load = () =>
    api<{ campaigns: Campaign[]; tenants: Tenant[] }>('/admin/campaigns')
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
      return false;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const body = toBody(form);
    if (typeof body === 'string') return setError(body);
    setSaving(true);
    const ok = await run(() => (editing ? api(`/admin/campaigns/${editing}`, { method: 'PUT', body }) : api('/admin/campaigns', { method: 'POST', body })));
    setSaving(false);
    if (ok) {
      setForm(null);
      setEditing(null);
    }
  }

  async function remove(c: Campaign) {
    const msg = c.uses ? `A campanha já foi usada em ${c.uses} pedido(s). Ela será desativada e continua no histórico. Continuar?` : `Apagar a campanha "${c.title}"?`;
    if (window.confirm(msg)) await run(() => api(`/admin/campaigns/${c.id}`, { method: 'DELETE' }));
  }

  if (!data) return error ? <ErrorBox message={error} /> : <Spinner />;
  const names = new Map(data.tenants.map((t) => [t.id, t.name]));
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const filtered = data.tenants.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Campanhas</h1>
          <p className="max-w-2xl text-sm text-zinc-500">
            Banners que a Delivery360 roda no topo das lojas. A divulgação vale para todas as lojas e fica sempre. A oferta de uma loja pode ter cupom pago pelo
            restaurante ou misto, e nesse caso o restaurante pode recusar. Na loja, os banners da rede se intercalam com os da própria loja.
          </p>
        </div>
        {!form && (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setForm({ ...EMPTY });
            }}
          >
            Nova campanha
          </button>
        )}
      </div>

      <ErrorBox message={error} />

      {form && (
        <form className="card grid gap-5 lg:grid-cols-[1fr_320px]" onSubmit={save}>
          <div className="space-y-4">
            <h2 className="font-semibold">{editing ? 'Editar campanha' : 'Nova campanha'}</h2>
            <label className="block text-sm">
              Título
              <input className="input mt-1" value={form.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Semana da pizza" />
            </label>
            <label className="block text-sm">
              Subtítulo (opcional)
              <input className="input mt-1" value={form.subtitle} maxLength={120} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Ex.: 20% off em todas as pizzas" />
            </label>
            <label className="block text-sm">
              Imagem do banner (link, formato largo 16:7)
              <input className="input mt-1" value={form.imageUrl} onChange={(e) => set({ imageUrl: e.target.value })} placeholder="https://..." />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Onde aparece</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip(form.allStores)} onClick={() => set({ allStores: true })}>
                  Todas as lojas (divulgação)
                </button>
                <button type="button" className={chip(!form.allStores)} onClick={() => set({ allStores: false })}>
                  Lojas escolhidas
                </button>
              </div>
              {!form.allStores && (
                <div className="rounded-xl border border-zinc-200 p-3">
                  <input className="input mb-2" placeholder="Buscar loja" value={q} onChange={(e) => setQ(e.target.value)} />
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {filtered.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.tenantIds.includes(t.id)}
                          onChange={(e) => set({ tenantIds: e.target.checked ? [...form.tenantIds, t.id] : form.tenantIds.filter((id) => id !== t.id) })}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{form.tenantIds.length} loja(s) escolhida(s)</p>
                </div>
              )}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                Começa
                <input type="datetime-local" className="input mt-1" value={form.starts} onChange={(e) => set({ starts: e.target.value })} />
              </label>
              <label className="block text-sm">
                Termina
                <input type="datetime-local" className="input mt-1" value={form.ends} onChange={(e) => set({ ends: e.target.value })} />
              </label>
              <label className="block text-sm">
                Ordem no carrossel
                <input className="input mt-1" inputMode="numeric" value={form.position} onChange={(e) => set({ position: e.target.value.replace(/\D/g, '') })} />
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 p-3">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Toggle checked={form.hasCoupon} onChange={(v) => set({ hasCoupon: v })} />
                Banner com cupom
              </label>
              {form.hasCoupon && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block text-sm">
                      Código
                      <input className="input mt-1 uppercase" value={form.code} onChange={(e) => set({ code: e.target.value.replace(/\s/g, '') })} placeholder="PIZZA20" />
                    </label>
                    <label className="block text-sm">
                      Tipo
                      <select className="input mt-1" value={form.type} onChange={(e) => set({ type: e.target.value as CouponType })}>
                        <option value="PERCENT">% de desconto</option>
                        <option value="FIXED">R$ de desconto</option>
                        <option value="FREE_DELIVERY">Entrega grátis</option>
                      </select>
                    </label>
                    {form.type !== 'FREE_DELIVERY' && (
                      <label className="block text-sm">
                        {form.type === 'PERCENT' ? 'Percentual (%)' : 'Valor (R$)'}
                        <input className="input mt-1" inputMode="decimal" value={form.value} onChange={(e) => set({ value: e.target.value })} />
                      </label>
                    )}
                    {form.type === 'PERCENT' && (
                      <label className="block text-sm">
                        Teto do desconto (R$)
                        <input className="input mt-1" inputMode="decimal" value={form.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} placeholder="sem teto" />
                      </label>
                    )}
                    <label className="block text-sm">
                      Pedido mínimo (R$)
                      <input className="input mt-1" inputMode="decimal" value={form.minOrder} onChange={(e) => set({ minOrder: e.target.value })} placeholder="sem mínimo" />
                    </label>
                    <label className="block text-sm">
                      Usos por cliente
                      <input className="input mt-1" inputMode="numeric" value={form.perCustomer} onChange={(e) => set({ perCustomer: e.target.value.replace(/\D/g, '') })} placeholder="sem limite" />
                    </label>
                    <label className="block text-sm">
                      Limite total (rede)
                      <input className="input mt-1" inputMode="numeric" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value.replace(/\D/g, '') })} placeholder="sem limite" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.firstOrderOnly} onChange={(e) => set({ firstOrderOnly: e.target.checked })} /> Só no 1º pedido na loja
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.combinesWithPromo} onChange={(e) => set({ combinesWithPromo: e.target.checked })} /> Vale em produto em promoção
                    </label>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Quem paga o desconto</legend>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ['PLATFORM', '100% Delivery360'],
                          ['MIXED', 'Misto'],
                          ['RESTAURANT', '100% restaurante'],
                        ] as const
                      ).map(([id, label]) => (
                        <button key={id} type="button" className={chip(form.funding === id)} onClick={() => set({ funding: id })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {form.funding === 'MIXED' && (
                      <label className="flex items-center gap-2 text-sm">
                        Delivery360 paga
                        <input className="input w-20" inputMode="decimal" value={form.share} onChange={(e) => set({ share: e.target.value })} />% e o restaurante o resto
                      </label>
                    )}
                    <p className="text-xs text-zinc-500">
                      {form.funding === 'PLATFORM'
                        ? 'O restaurante recebe o desconto da Delivery360 e não pode recusar a campanha.'
                        : 'A parte do restaurante entra no financeiro dele em 2.4 Descontos e cupons. Ele pode recusar a campanha no painel.'}
                    </p>
                  </fieldset>
                </>
              )}
            </div>

            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={form.active} onChange={(v) => set({ active: v })} /> Campanha ativa
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={saving}>
                {saving ? 'Salvando...' : editing ? 'Salvar campanha' : 'Criar campanha'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
                Cancelar
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Como fica na loja</p>
            <BannerPreview title={form.title || 'Título da campanha'} subtitle={form.subtitle} imageUrl={form.imageUrl} code={form.hasCoupon ? form.code.toUpperCase() : null} />
          </div>
        </form>
      )}

      {data.campaigns.length === 0 && !form && <p className="text-sm text-zinc-500">Nenhuma campanha ainda.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {data.campaigns.map((c) => (
          <div key={c.id} className={`card space-y-3 ${c.active ? '' : 'opacity-60'}`}>
            <BannerPreview title={c.title} subtitle={c.subtitle ?? ''} imageUrl={c.imageUrl} code={c.couponCode} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.tenantIds.length ? 'amber' : 'green'}>{c.tenantIds.length ? `${c.tenantIds.length} loja(s)` : 'Todas as lojas'}</Badge>
              {c.couponCode && <Badge>{splitLabel(c.platformShareBps)}</Badge>}
              {!c.active && <Badge tone="red">Desativada</Badge>}
              {c.endsAt && <span className="text-xs text-zinc-500">{new Date(c.endsAt) > new Date() ? `Até ${shortDate(c.endsAt)}` : `Terminou em ${shortDate(c.endsAt)}`}</span>}
            </div>
            {c.tenantIds.length > 0 && <p className="text-xs text-zinc-500">{c.tenantIds.map((id) => names.get(id) ?? 'Loja removida').join(', ')}</p>}
            {c.couponCode && (
              <p className="text-sm">
                <span className="font-mono font-semibold">{c.couponCode}</span> · {c.label}
              </p>
            )}
            {c.couponCode && (
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Pedidos" value={String(c.uses)} />
                <Stat label="Vendas" value={formatBRL(c.salesCents)} />
                <Stat label="Custo Delivery360" value={formatBRL(c.platformCostCents)} />
              </div>
            )}
            {c.optedOut.length > 0 && <p className="text-xs text-amber-700">Recusaram: {c.optedOut.map((t) => t.name).join(', ')}</p>}
            <div className="flex gap-3 text-sm">
              <button
                className="text-[var(--brand)]"
                onClick={() => {
                  setEditing(c.id);
                  setForm(fromCampaign(c));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                Editar
              </button>
              <button className="text-red-600" onClick={() => void remove(c)}>
                Apagar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-2">
      <p className="font-semibold">{value}</p>
      <p className="text-zinc-500">{label}</p>
    </div>
  );
}
