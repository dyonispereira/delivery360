'use client';

import { useEffect, useState } from 'react';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';

type CouponType = 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[];
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  firstOrderOnly: boolean;
  combinesWithPromo: boolean;
  productIds: string[];
  fundedBy: 'RESTAURANT' | 'PLATFORM';
  public: boolean;
  active: boolean;
  label: string;
  uses: number;
  discountGivenCents: number;
  salesCents: number;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TYPES: { id: CouponType; label: string }[] = [
  { id: 'PERCENT', label: '% de desconto' },
  { id: 'FIXED', label: 'R$ de desconto' },
  { id: 'FREE_DELIVERY', label: 'Entrega grátis' },
];

const toMoney = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

interface Form {
  code: string;
  description: string;
  type: CouponType;
  value: string;
  maxDiscount: string;
  minOrder: string;
  starts: string;
  ends: string;
  weekdays: number[];
  maxUses: string;
  perCustomer: string;
  firstOrderOnly: boolean;
  combinesWithPromo: boolean;
  productIds: string[];
  public: boolean;
}

const EMPTY: Form = {
  code: '',
  description: '',
  type: 'PERCENT',
  value: '10',
  maxDiscount: '',
  minOrder: '',
  starts: '',
  ends: '',
  weekdays: [],
  maxUses: '',
  perCustomer: '1',
  firstOrderOnly: false,
  combinesWithPromo: false,
  productIds: [],
  public: true,
};

const fromCoupon = (c: Coupon): Form => ({
  code: c.code,
  description: c.description ?? '',
  type: c.type,
  value: c.type === 'PERCENT' ? String(c.value / 100).replace('.', ',') : c.type === 'FIXED' ? toMoney(c.value) : '',
  maxDiscount: toMoney(c.maxDiscountCents),
  minOrder: toMoney(c.minOrderCents),
  starts: toLocalInput(c.startsAt),
  ends: toLocalInput(c.endsAt),
  weekdays: c.weekdays,
  maxUses: c.maxUses ? String(c.maxUses) : '',
  perCustomer: c.maxUsesPerCustomer ? String(c.maxUsesPerCustomer) : '',
  firstOrderOnly: c.firstOrderOnly,
  combinesWithPromo: c.combinesWithPromo,
  productIds: c.productIds,
  public: c.public,
});

/** Converte o formulário no corpo da API, ou devolve o erro para mostrar. */
function toBody(f: Form): Record<string, unknown> | string {
  const int = (v: string) => (v.trim() ? Number.parseInt(v, 10) : null);
  let value = 0;
  if (f.type === 'PERCENT') {
    const pct = Number(f.value.replace(',', '.'));
    if (!(pct >= 1 && pct <= 100)) return 'O percentual precisa ser de 1 a 100.';
    value = Math.round(pct * 100);
  } else if (f.type === 'FIXED') {
    const cents = parseBRL(f.value);
    if (!cents) return 'Informe o valor do desconto.';
    value = cents;
  }
  const maxDiscountCents = f.type === 'PERCENT' && f.maxDiscount.trim() ? parseBRL(f.maxDiscount) : null;
  if (f.type === 'PERCENT' && f.maxDiscount.trim() && !maxDiscountCents) return 'Teto do desconto inválido.';
  const minOrderCents = f.minOrder.trim() ? parseBRL(f.minOrder) : 0;
  if (minOrderCents === null) return 'Pedido mínimo inválido.';
  return {
    code: f.code.trim().toUpperCase(),
    description: f.description.trim(),
    type: f.type,
    value,
    maxDiscountCents,
    minOrderCents,
    startsAt: fromLocalInput(f.starts),
    endsAt: fromLocalInput(f.ends),
    weekdays: f.weekdays,
    maxUses: int(f.maxUses),
    maxUsesPerCustomer: int(f.perCustomer),
    firstOrderOnly: f.firstOrderOnly,
    combinesWithPromo: f.combinesWithPromo,
    productIds: f.type === 'FREE_DELIVERY' ? [] : f.productIds,
    public: f.public,
  };
}

/** Resumo das regras em uma linha: "Até 31/12 · sex e sáb · 1 por cliente · só 1º pedido". */
function rulesLine(c: Coupon) {
  const parts: string[] = [];
  if (c.startsAt && new Date(c.startsAt) > new Date()) parts.push(`A partir de ${shortDate(c.startsAt)}`);
  if (c.endsAt) parts.push(new Date(c.endsAt) > new Date() ? `Até ${shortDate(c.endsAt)}` : `Venceu em ${shortDate(c.endsAt)}`);
  if (c.weekdays.length) parts.push(c.weekdays.map((d) => DAYS[d].toLowerCase()).join(', '));
  if (c.maxUses) parts.push(`${c.uses} de ${c.maxUses} usos`);
  parts.push(c.maxUsesPerCustomer ? `${c.maxUsesPerCustomer} por cliente` : 'sem limite por cliente');
  if (c.firstOrderOnly) parts.push('só 1º pedido');
  if (c.type !== 'FREE_DELIVERY' && !c.combinesWithPromo) parts.push('não vale em promoção');
  return parts.join(' · ');
}

type MenuCategory = { id: string; name: string; products: { id: string; name: string }[] };

/**
 * Cupons do restaurante. No painel do restaurante usa o restaurante atual;
 * no admin da Delivery360 recebe o tenantId do cadastro aberto.
 */
export function CouponsEditor({ canEdit, tenantId, platform = false }: { canEdit: boolean; tenantId?: string; platform?: boolean }) {
  const tenant = tenantId ?? true;
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api<Coupon[]>('/cardapio/coupons', { tenant }).then(setCoupons).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    api<MenuCategory[]>('/cardapio/menu', { tenant })
      .then(setMenu)
      .catch(() => setMenu([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

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
    const ok = await run(() =>
      editing ? api(`/cardapio/coupons/${editing}`, { method: 'PATCH', body, tenant }) : api('/cardapio/coupons', { method: 'POST', body, tenant }),
    );
    setSaving(false);
    if (ok) {
      setForm(null);
      setEditing(null);
    }
  }

  async function remove(c: Coupon) {
    const msg = c.uses ? `${c.code} já foi usado em ${c.uses} pedido(s). Ele será desativado e continua no histórico. Continuar?` : `Apagar o cupom ${c.code}?`;
    if (window.confirm(msg)) await run(() => api(`/cardapio/coupons/${c.id}`, { method: 'DELETE', tenant }));
  }

  if (!coupons) return error ? <ErrorBox message={error} /> : <Spinner />;

  const active = coupons.filter((c) => c.active);
  const totals = coupons.reduce((s, c) => ({ uses: s.uses + c.uses, discount: s.discount + c.discountGivenCents, sales: s.sales + c.salesCents }), { uses: 0, discount: 0, sales: 0 });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <h2 className="font-semibold">Cupons da loja</h2>
            <p className="text-sm text-zinc-500">
              O cliente digita o código no carrinho. Os marcados como &quot;Na loja&quot; aparecem para todos no topo do cardápio. O desconto dos cupons
              do restaurante entra no financeiro em 2.4 Descontos e cupons. Os bancados pela Delivery360 viram valor a receber da Delivery360.
            </p>
          </div>
          {canEdit && !form && (
            <button
              className="btn-primary"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
            >
              Novo cupom
            </button>
          )}
        </div>
        {coupons.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Pedidos com cupom" value={String(totals.uses)} />
            <Stat label="Desconto dado" value={formatBRL(totals.discount)} />
            <Stat label="Vendas com cupom" value={formatBRL(totals.sales)} />
          </div>
        )}
      </div>

      {form && (
        <form onSubmit={save} className="card space-y-4">
          <h3 className="font-semibold">{editing ? `Editar ${form.code}` : 'Novo cupom'}</h3>
          {platform && !editing && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Você está na equipe Delivery360: este cupom é bancado pela Delivery360. O restaurante recebe o valor do desconto de nós e não paga nada.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-code">Código</label>
              <input
                id="c-code"
                className="input font-mono uppercase"
                required
                maxLength={20}
                placeholder="VOLTEI15"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\s/g, '').toUpperCase() })}
              />
            </div>
            <div>
              <label className="label" htmlFor="c-desc">Descrição para o cliente (opcional)</label>
              <input id="c-desc" className="input" maxLength={120} placeholder="Na sua primeira compra" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <div>
            <span className="label">Tipo</span>
            <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setForm({ ...form, type: t.id, value: t.id === 'PERCENT' ? '10' : t.id === 'FIXED' ? '10,00' : '' })}
                  className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${form.type === t.id ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {form.type !== 'FREE_DELIVERY' && <ProductPicker menu={menu} value={form.productIds} onChange={(productIds) => setForm({ ...form, productIds })} />}

          <div className="grid gap-3 sm:grid-cols-3">
            {form.type !== 'FREE_DELIVERY' && (
              <div>
                <label className="label" htmlFor="c-value">{form.type === 'PERCENT' ? 'Desconto (%)' : 'Desconto (R$)'}</label>
                <input id="c-value" className="input" inputMode="decimal" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
            )}
            {form.type === 'PERCENT' && (
              <div>
                <label className="label" htmlFor="c-max">Desconto máximo (R$)</label>
                <input id="c-max" className="input" inputMode="decimal" placeholder="Sem teto" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="c-min">Pedido mínimo (R$)</label>
              <input id="c-min" className="input" inputMode="decimal" placeholder="Sem mínimo" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-start">Começa em</label>
              <input id="c-start" type="datetime-local" className="input" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="c-end">Termina em</label>
              <input id="c-end" type="datetime-local" className="input" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} />
            </div>
          </div>

          <div>
            <span className="label">Dias da semana (nenhum marcado = todos)</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = form.weekdays.includes(i);
                return (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setForm({ ...form, weekdays: on ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i] })}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-zinc-300 text-zinc-600'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-uses">Quantidade de usos no total</label>
              <input id="c-uses" className="input" inputMode="numeric" placeholder="Sem limite" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label className="label" htmlFor="c-per">Usos por cliente (telefone)</label>
              <input id="c-per" className="input" inputMode="numeric" placeholder="Sem limite" value={form.perCustomer} onChange={(e) => setForm({ ...form, perCustomer: e.target.value.replace(/\D/g, '') })} />
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <Check checked={form.public} onChange={(v) => setForm({ ...form, public: v })} label="Mostrar na loja" hint="Aparece na faixa de cupons do cardápio. Desmarcado, só funciona para quem tem o código." />
            <Check checked={form.firstOrderOnly} onChange={(v) => setForm({ ...form, firstOrderOnly: v })} label="Só no primeiro pedido" hint="Para trazer cliente novo. Conferido pelo telefone." />
            {form.type !== 'FREE_DELIVERY' && (
              <Check
                checked={form.combinesWithPromo}
                onChange={(v) => setForm({ ...form, combinesWithPromo: v })}
                label="Vale também em produtos em promoção"
                hint="Desmarcado, o desconto é calculado só sobre os itens com preço normal."
              />
            )}
          </div>

          <ErrorBox message={error} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar cupom'}</button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setForm(null);
                setEditing(null);
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!form && <ErrorBox message={error} />}

      {coupons.length === 0 && !form ? (
        <div className="card text-sm text-zinc-500">
          Nenhum cupom ainda. Ideias que funcionam bem: <strong>BEMVINDO</strong> (10% no primeiro pedido), <strong>FRETEGRATIS</strong> acima de R$ 60, e um
          cupom de dia fraco, como segunda e terça.
        </div>
      ) : (
        <ul className="space-y-2">
          {coupons.map((c) => (
            <li key={c.id} className={`card flex flex-wrap items-center gap-3 ${c.active ? '' : 'opacity-60'}`}>
              <div className="rounded-lg border-2 border-dashed border-[var(--brand)] px-3 py-1.5 font-mono text-sm font-bold text-[var(--brand)]">{c.code}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.label}</span>
                  {c.public ? <Badge tone="green">Na loja</Badge> : <Badge>Só com código</Badge>}
                  {c.fundedBy === 'PLATFORM' && <Badge tone="amber">Bancado pela Delivery360</Badge>}
                </div>
                <p className="text-xs text-zinc-500">{rulesLine(c)}</p>
              </div>
              <div className="text-right text-xs text-zinc-500">
                <div>
                  <strong className="text-zinc-800">{c.uses}</strong> {c.uses === 1 ? 'pedido' : 'pedidos'}
                </div>
                <div>{formatBRL(c.discountGivenCents)} de desconto</div>
              </div>
              <Toggle checked={c.active} disabled={!canEdit || (c.fundedBy === 'PLATFORM' && !platform)} onChange={(v) => run(() => api(`/cardapio/coupons/${c.id}`, { method: 'PATCH', body: { active: v }, tenant }))} />
              {canEdit && (c.fundedBy !== 'PLATFORM' || platform) && (
                <div className="flex gap-3 text-xs">
                  <button
                    className="text-[var(--brand)] hover:underline"
                    onClick={() => {
                      setEditing(c.id);
                      setForm(fromCoupon(c));
                      setError(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Editar
                  </button>
                  <button className="text-red-600 hover:underline" onClick={() => remove(c)}>
                    Apagar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 && coupons.length > 0 && <p className="text-sm text-zinc-500">Nenhum cupom ligado no momento.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

/** "Vale para": pedido inteiro ou só alguns produtos/combos do cardápio. */
function ProductPicker({ menu, value, onChange }: { menu: MenuCategory[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [some, setSome] = useState(value.length > 0);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div>
      <span className="label">Vale para</span>
      <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
        {[
          { on: false, label: 'O pedido inteiro' },
          { on: true, label: 'Só alguns produtos ou combos' },
        ].map((o) => (
          <button
            type="button"
            key={o.label}
            onClick={() => {
              setSome(o.on);
              if (!o.on) onChange([]);
            }}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${some === o.on ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {some && (
        <div className="mt-2 rounded-lg border border-zinc-200 p-3">
          <input className="input mb-2" type="search" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-56 space-y-3 overflow-y-auto">
            {menu.map((c) => {
              const products = c.products.filter((p) => !term || p.name.toLowerCase().includes(term));
              if (!products.length) return null;
              return (
                <div key={c.id}>
                  <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">{c.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {products.map((p) => {
                      const on = value.includes(p.id);
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => toggle(p.id)}
                          className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-zinc-300 text-zinc-700'}`}
                        >
                          {on ? '✓ ' : ''}
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {value.length ? `${value.length} selecionado(s). O desconto é calculado só sobre esses itens.` : 'Escolha pelo menos um produto.'}
          </p>
        </div>
      )}
    </div>
  );
}
