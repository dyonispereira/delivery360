'use client';

import { useCallback, useEffect, useState } from 'react';
import { activePromoPrice, CHANNEL_LABELS, costSheet, DEFAULT_RATES, discountPct, formatBRL, parseBRL, type ChannelPrices, type FinanceRates } from '@delivery360/shared';
import { CostSheetEditor, type RatesInfo } from './cost-sheet';
import { ComboEditor } from './combo-editor';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Category, Group, Product } from './types';
import { ImageField } from '@/components/image-field';

const toMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
/** ISO → valor do campo datetime-local (hora local). */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function MenuEditor({ canEdit }: { canEdit: boolean }) {
  const [menu, setMenu] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState<{ product: Partial<Product> & { categoryId: string } } | null>(null);
  const [rates, setRates] = useState<RatesInfo | null>(null);
  /** Combo aberto no editor de combos (null = criando um novo). */
  const [combo, setCombo] = useState<{ product: Product | null } | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    api<RatesInfo>('/cardapio/cost-rates', { tenant: true }).then(setRates).catch(() => undefined);
  }, [canEdit]);

  const load = useCallback(async () => {
    try {
      setMenu(await api<Category[]>('/cardapio/menu', { tenant: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  if (!menu) return error ? <ErrorBox message={error} /> : <Spinner />;

  // Mantém o editor aberto com os dados mais novos depois de cada alteração.
  const editingProduct = editing?.product.id
    ? menu.flatMap((c) => c.products).find((p) => p.id === editing.product.id) ?? editing.product
    : editing?.product;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        <ErrorBox message={error} />
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api('/cardapio/categories', { method: 'POST', body: { name: newCategory }, tenant: true })).then(() => setNewCategory(''));
            }}
          >
            <input className="input" placeholder="Nova categoria (ex.: Pizzas, Bebidas)" required value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
            <button className="btn-ghost whitespace-nowrap">Criar categoria</button>
            <button
              type="button"
              className="btn-primary whitespace-nowrap"
              onClick={() => {
                setEditing(null);
                setCombo({ product: null });
              }}
            >
              Criar combo
            </button>
          </form>
        )}
        {menu.length === 0 && <div className="card text-sm text-zinc-500">Comece criando uma categoria e depois os produtos.</div>}
        {menu.map((c) => (
          <section key={c.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">{c.name}</h2>
              {!c.active && <Badge tone="amber">Oculta</Badge>}
              <div className="ml-auto flex items-center gap-3 text-xs">
                {canEdit && (
                  <>
                    <label className="flex items-center gap-2 text-zinc-600">
                      Visível
                      <Toggle checked={c.active} onChange={(v) => run(() => api(`/cardapio/categories/${c.id}`, { method: 'PATCH', body: { active: v }, tenant: true }))} />
                    </label>
                    <button
                      className="text-zinc-600 hover:underline"
                      onClick={() => {
                        const name = window.prompt('Novo nome da categoria', c.name);
                        if (name) void run(() => api(`/cardapio/categories/${c.id}`, { method: 'PATCH', body: { name }, tenant: true }));
                      }}
                    >
                      Renomear
                    </button>
                    <button className="text-red-600 hover:underline" onClick={() => window.confirm(`Apagar a categoria ${c.name}?`) && run(() => api(`/cardapio/categories/${c.id}`, { method: 'DELETE', tenant: true }))}>
                      Apagar
                    </button>
                  </>
                )}
              </div>
            </div>
            <ul className="divide-y divide-zinc-100">
              {c.products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-lg bg-zinc-100" />
                  )}
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (p.isCombo && canEdit) {
                        setEditing(null);
                        setCombo({ product: p });
                      } else {
                        setCombo(null);
                        setEditing({ product: p });
                      }
                    }}
                  >
                    <div className="font-medium">
                      {p.name} {p.isCombo && <Badge tone="green">Combo</Badge>} {!p.active && <Badge tone="amber">Fora do cardápio</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {formatBRL(p.priceCents)}
                      {activePromoPrice(p) != null && (
                        <span className="ml-1 rounded bg-[var(--brand)]/10 px-1.5 py-0.5 font-medium text-[var(--brand)]">
                          por {formatBRL(activePromoPrice(p)!)} (−{discountPct(p.priceCents, activePromoPrice(p)!)}%)
                        </span>
                      )}
                      {p.promoPriceCents != null && activePromoPrice(p) == null && <span className="ml-1 text-zinc-400">· promoção fora do período</span>}
                      {p.pdvCode && ` · PDV ${p.pdvCode}`}
                      {p.isCombo
                        ? ` · ${p.optionGroups.map((g) => g.name).join(' + ')}`
                        : p.optionGroups.length > 0 && ` · ${p.optionGroups.length} grupo(s) de adicionais`}
                      {canEdit && !p.isCombo && <MarginChip product={p} rates={rates ?? DEFAULT_RATES} />}
                    </div>
                  </button>
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    {p.available ? 'Disponível' : 'Esgotado'}
                    <Toggle checked={p.available} onChange={(v) => run(() => api(`/cardapio/products/${p.id}/available`, { method: 'PATCH', body: { available: v }, tenant: true }))} />
                  </label>
                </li>
              ))}
            </ul>
            {canEdit && (
              <button className="text-sm text-[var(--brand)] hover:underline" onClick={() => {
                  setCombo(null);
                  setEditing({ product: { categoryId: c.id } });
                }}>
                + Adicionar produto
              </button>
            )}
          </section>
        ))}
      </div>

      {combo && (
        <ComboEditor
          key={combo.product?.id ?? 'novo-combo'}
          combo={combo.product}
          categories={menu}
          rates={rates}
          onClose={() => setCombo(null)}
          onSaved={async () => {
            await load();
            setCombo(null);
          }}
        />
      )}

      {editing && editingProduct && (
        <ProductEditor
          key={editingProduct.id ?? 'novo'}
          product={editingProduct as Partial<Product> & { categoryId: string }}
          categories={menu}
          canEdit={canEdit}
          rates={rates}
          onClose={() => setEditing(null)}
          onSaved={async (p) => {
            await load();
            setEditing({ product: p });
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}

function ProductEditor({
  product,
  categories,
  canEdit,
  rates,
  onClose,
  onSaved,
  onChanged,
}: {
  product: Partial<Product> & { categoryId: string };
  categories: Category[];
  canEdit: boolean;
  rates: RatesInfo | null;
  onClose: () => void;
  onSaved: (p: Product) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const isNew = !product.id;
  const [form, setForm] = useState({
    name: product.name ?? '',
    description: product.description ?? '',
    price: product.priceCents != null ? toMoney(product.priceCents) : '',
    imageUrl: product.imageUrl ?? '',
    categoryId: product.categoryId,
    active: product.active ?? true,
  });
  const [promoOn, setPromoOn] = useState(product.promoPriceCents != null);
  const [promo, setPromo] = useState({
    price: product.promoPriceCents != null ? toMoney(product.promoPriceCents) : '',
    starts: toLocalInput(product.promoStartsAt),
    ends: toLocalInput(product.promoEndsAt),
  });
  const [costItems, setCostItems] = useState(product.costItems ?? []);
  const [extraCostBps, setExtraCostBps] = useState(product.extraCostBps ?? 0);
  const [pdvCode, setPdvCode] = useState(product.pdvCode ?? '');
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(product.channelPrices ?? {}).map(([k, v]) => [k, toMoney(v as number)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeChannels = (rates?.channels ?? []).filter((c) => c.active);
  const channelPrices: ChannelPrices = Object.fromEntries(
    Object.entries(prices)
      .map(([k, v]) => [k, v.trim() ? parseBRL(v) : null])
      .filter(([, v]) => v !== null),
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = parseBRL(form.price);
    if (priceCents === null) return setError('Preço inválido.');
    const promoPriceCents = promoOn ? parseBRL(promo.price) : null;
    if (promoOn && promoPriceCents === null) return setError('Preço promocional inválido.');
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description || undefined,
      priceCents,
      imageUrl: form.imageUrl || undefined,
      categoryId: form.categoryId,
      active: form.active,
      costItems: costItems.filter((i) => i.name.trim()),
      extraCostBps,
      pdvCode: pdvCode.trim(),
      promoPriceCents,
      promoStartsAt: promoOn ? fromLocalInput(promo.starts) : null,
      promoEndsAt: promoOn ? fromLocalInput(promo.ends) : null,
      // Só os apps ativos; vazio = mesmo preço da loja.
      ...(canEdit && rates ? { channelPrices } : {}),
    };
    try {
      const saved = isNew
        ? await api<Product>('/cardapio/products', { method: 'POST', body, tenant: true })
        : await api<Product>(`/cardapio/products/${product.id}`, { method: 'PATCH', body, tenant: true });
      await onSaved({ ...saved, optionGroups: product.optionGroups ?? [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!product.id || !window.confirm(`Apagar ${product.name}? Pedidos antigos continuam no histórico.`)) return;
    try {
      await api(`/cardapio/products/${product.id}`, { method: 'DELETE', tenant: true });
      await onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao apagar.');
    }
  }

  return (
    <aside className="card h-fit space-y-4 lg:sticky lg:top-4">
      <div className="flex items-center">
        <h2 className="font-semibold">{isNew ? 'Novo produto' : 'Editar produto'}</h2>
        <button className="ml-auto text-sm text-zinc-500 hover:text-zinc-800" onClick={onClose}>Fechar</button>
      </div>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="label">Nome</label>
          <input className="input" required disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Descrição</label>
          <textarea className="input" rows={2} disabled={!canEdit} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Preço (R$)</label>
            <input className="input" required inputMode="decimal" disabled={!canEdit} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          <div>
            <label className="label">Categoria</label>
            <select className="input" disabled={!canEdit} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        {(canEdit || promoOn) && (
          <PromoFields
            on={promoOn}
            onToggle={setPromoOn}
            value={promo}
            onChange={setPromo}
            canEdit={canEdit}
            priceCents={parseBRL(form.price) ?? 0}
            costItems={costItems}
            extraCostBps={extraCostBps}
            rates={rates}
          />
        )}
        <div>
          <label className="label" htmlFor="pdv-code">Código PDV</label>
          <input
            id="pdv-code"
            className="input"
            disabled={!canEdit}
            placeholder="Ex.: XB01"
            maxLength={40}
            value={pdvCode}
            onChange={(e) => setPdvCode(e.target.value.replace(/\s/g, ''))}
          />
          <p className="mt-1 text-xs text-zinc-500">Use o mesmo código no iFood, 99Food e Keeta: assim o pedido do app cai no produto certo, com a receita separada por canal.</p>
        </div>
        {canEdit && activeChannels.length > 0 && (
          <div>
            <span className="label">Preço nos apps (R$)</span>
            <div className="grid grid-cols-3 gap-2">
              {activeChannels.map((c) => (
                <div key={c.channel}>
                  <label className="text-xs text-zinc-500" htmlFor={`price-${c.channel}`}>{CHANNEL_LABELS[c.channel]}</label>
                  <input
                    id={`price-${c.channel}`}
                    className="input"
                    inputMode="decimal"
                    placeholder={form.price || '0,00'}
                    value={prices[c.channel] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [c.channel]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Vazio = mesmo preço da loja própria.</p>
          </div>
        )}
        <div>
          <label className="label">Foto do produto</label>
          <ImageField value={form.imageUrl} disabled={!canEdit} onChange={(imageUrl) => setForm({ ...form, imageUrl })} hint="Foto quadrada fica melhor. JPG, PNG ou WebP." />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Aparece no cardápio
        </label>
        {canEdit && (
          <CostSheetEditor
            priceCents={parseBRL(form.price) ?? 0}
            items={costItems}
            extraCostBps={extraCostBps}
            rates={rates}
            channelPrices={channelPrices}
            onChange={(items, extra) => {
              setCostItems(items);
              setExtraCostBps(extra);
            }}
          />
        )}
        <ErrorBox message={error} />
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
            {!isNew && <button type="button" className="btn-ghost text-red-600" onClick={remove}>Apagar</button>}
          </div>
        )}
      </form>

      {!isNew && product.id && <GroupsEditor productId={product.id} groups={product.optionGroups ?? []} canEdit={canEdit} onChanged={onChanged} />}
      {isNew && <p className="text-xs text-zinc-500">Salve o produto para cadastrar os adicionais (bordas, tamanhos, extras).</p>}
    </aside>
  );
}

function GroupsEditor({ productId, groups, canEdit, onChanged }: { productId: string; groups: Group[]; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState({ name: '', minSelect: '0', maxSelect: '1' });

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  function addOption(groupId: string) {
    const name = window.prompt('Nome da opção (ex.: Catupiry)');
    if (!name) return;
    const price = window.prompt('Preço adicional em R$ (0 se não cobra)', '0');
    const priceCents = parseBRL(price ?? '0');
    if (priceCents === null) return setError('Preço inválido.');
    const cost = window.prompt('Custo deste adicional em R$, para o CMV (ex.: bacon 1,50). 0 se não tem custo.', '0');
    const costCents = parseBRL(cost ?? '0');
    if (costCents === null) return setError('Custo inválido.');
    const pdvCode = window.prompt('Código PDV do adicional (o mesmo dos apps). Deixe vazio se não tiver.', '') ?? '';
    void run(() => api(`/cardapio/groups/${groupId}/options`, { method: 'POST', body: { name, priceCents, costCents, pdvCode: pdvCode.trim() }, tenant: true }));
  }

  const rule = (g: Group) =>
    g.minSelect === 0 ? `Opcional, até ${g.maxSelect}` : g.minSelect === g.maxSelect ? `Obrigatório, escolher ${g.minSelect}` : `Escolher de ${g.minSelect} a ${g.maxSelect}`;

  return (
    <div className="space-y-3 border-t border-zinc-100 pt-4">
      <h3 className="font-semibold">Adicionais</h3>
      {groups.length === 0 && <p className="text-sm text-zinc-500">Nenhum grupo. Ex.: &quot;Borda&quot; (obrigatório, 1) ou &quot;Extras&quot; (opcional, até 3).</p>}
      {groups.map((g) => (
        <div key={g.id} className="rounded-lg border border-zinc-200 p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="text-sm font-medium">{g.name}</div>
              <div className="text-xs text-zinc-500">{rule(g)}</div>
            </div>
            {canEdit && (
              <button className="text-xs text-red-600 hover:underline" onClick={() => window.confirm(`Apagar o grupo ${g.name}?`) && run(() => api(`/cardapio/groups/${g.id}`, { method: 'DELETE', tenant: true }))}>
                Apagar
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1">
            {g.options.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-sm">
                <span className={`flex-1 ${o.available ? '' : 'text-zinc-400 line-through'}`}>{o.name}</span>
                <span className="text-xs text-zinc-500">
                  {o.priceCents ? `+ ${formatBRL(o.priceCents)}` : 'grátis'}
                  {canEdit && (
                    <button
                      type="button"
                      className="ml-1 text-zinc-400 underline"
                      title="Custo do adicional (entra no CMV da venda)"
                      onClick={() => {
                        const cost = window.prompt(`Custo de "${o.name}" em R$ (para o CMV):`, ((o.costCents ?? 0) / 100).toFixed(2).replace('.', ','));
                        const costCents = cost === null ? null : parseBRL(cost);
                        if (costCents !== null) void run(() => api(`/cardapio/options/${o.id}`, { method: 'PATCH', body: { costCents }, tenant: true }));
                      }}
                    >
                      custo {formatBRL(o.costCents ?? 0)}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="ml-1 text-zinc-400 underline"
                      title="Código PDV do adicional (o mesmo dos apps)"
                      onClick={() => {
                        const code = window.prompt(`Código PDV de "${o.name}" (vazio apaga):`, o.pdvCode ?? '');
                        if (code !== null) void run(() => api(`/cardapio/options/${o.id}`, { method: 'PATCH', body: { pdvCode: code.trim() }, tenant: true }));
                      }}
                    >
                      {o.pdvCode ? `PDV ${o.pdvCode}` : 'sem PDV'}
                    </button>
                  )}
                </span>
                <Toggle checked={o.available} disabled={!canEdit} onChange={(v) => run(() => api(`/cardapio/options/${o.id}`, { method: 'PATCH', body: { available: v }, tenant: true }))} />
                {canEdit && (
                  <button className="text-xs text-zinc-400 hover:text-red-600" aria-label={`Apagar ${o.name}`} onClick={() => run(() => api(`/cardapio/options/${o.id}`, { method: 'DELETE', tenant: true }))}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <button className="mt-2 text-xs text-[var(--brand)] hover:underline" onClick={() => addOption(g.id)}>
              + Opção
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <form
          className="grid grid-cols-[1fr_64px_64px_auto] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api(`/cardapio/products/${productId}/groups`, {
                method: 'POST',
                body: { name: newGroup.name, minSelect: Number(newGroup.minSelect), maxSelect: Number(newGroup.maxSelect) },
                tenant: true,
              }),
            ).then(() => setNewGroup({ name: '', minSelect: '0', maxSelect: '1' }));
          }}
        >
          <div>
            <label className="text-xs text-zinc-500">Novo grupo</label>
            <input className="input" placeholder="Ex.: Borda" required value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Mín.</label>
            <input className="input" type="number" min={0} value={newGroup.minSelect} onChange={(e) => setNewGroup({ ...newGroup, minSelect: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Máx.</label>
            <input className="input" type="number" min={1} value={newGroup.maxSelect} onChange={(e) => setNewGroup({ ...newGroup, maxSelect: e.target.value })} />
          </div>
          <button className="btn-ghost">Criar</button>
        </form>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

/** Preço de/por: preço promocional, período e quanto a margem cai pela ficha técnica. */
function PromoFields({
  on,
  onToggle,
  value,
  onChange,
  canEdit,
  priceCents,
  costItems,
  extraCostBps,
  rates,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  value: { price: string; starts: string; ends: string };
  onChange: (v: { price: string; starts: string; ends: string }) => void;
  canEdit: boolean;
  priceCents: number;
  costItems: Product['costItems'];
  extraCostBps: number;
  rates: RatesInfo | null;
}) {
  const promoCents = parseBRL(value.price);
  const valid = promoCents != null && promoCents > 0 && promoCents < priceCents;
  const items = (costItems ?? []).filter((i) => i.name.trim());
  const r = rates ?? DEFAULT_RATES;
  const before = items.length ? costSheet(priceCents, items, r, extraCostBps) : null;
  const after = items.length && valid ? costSheet(promoCents!, items, r, extraCostBps) : null;
  return (
    <fieldset className="rounded-lg border border-zinc-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" disabled={!canEdit} checked={on} onChange={(e) => onToggle(e.target.checked)} />
        Preço promocional (de/por)
      </label>
      {on && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="promo-price">Por (R$)</label>
              <input id="promo-price" className="input" inputMode="decimal" disabled={!canEdit} value={value.price} onChange={(e) => onChange({ ...value, price: e.target.value })} />
            </div>
            <div className="flex items-end pb-2 text-sm">
              {valid ? (
                <span>
                  De <s>{formatBRL(priceCents)}</s> · selo <b>−{discountPct(priceCents, promoCents!)}%</b>
                </span>
              ) : (
                value.price && <span className="text-red-600">Precisa ser menor que {formatBRL(priceCents)}.</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="promo-start">Começa (opcional)</label>
              <input id="promo-start" type="datetime-local" className="input" disabled={!canEdit} value={value.starts} onChange={(e) => onChange({ ...value, starts: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="promo-end">Termina (opcional)</label>
              <input id="promo-end" type="datetime-local" className="input" disabled={!canEdit} value={value.ends} onChange={(e) => onChange({ ...value, ends: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-zinc-500">Sem datas, vale até você desmarcar. Na loja aparece o preço riscado e o selo de desconto.</p>
          {before && after && (
            <p className={`rounded-lg p-2 text-sm ${after.profitCents < 0 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`} role="status">
              {after.profitCents < 0 ? (
                <>
                  <b>Abaixo do custo:</b> cada unidade dá prejuízo de {formatBRL(-after.profitCents)} pela ficha técnica.
                </>
              ) : (
                <>
                  Com {formatBRL(promoCents!)} a margem cai de <b>{before.resultPct?.toLocaleString('pt-BR')}%</b> para{' '}
                  <b>{after.resultPct?.toLocaleString('pt-BR')}%</b>: lucro de {formatBRL(after.profitCents)} por unidade (era {formatBRL(before.profitCents)}).
                </>
              )}
            </p>
          )}
          {!before && valid && <p className="text-xs text-zinc-500">Preencha a ficha técnica para ver quanto a margem cai com a promoção.</p>}
        </div>
      )}
    </fieldset>
  );
}

/** Na lista de produtos: CMV % e lucro por unidade, para bater o olho. */
function MarginChip({ product, rates }: { product: Product; rates: FinanceRates }) {
  const items = product.costItems ?? [];
  if (items.length === 0) return <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">sem ficha técnica</span>;
  // Na promoção, a margem do preço que está valendo.
  const s = costSheet(activePromoPrice(product) ?? product.priceCents, items, rates, product.extraCostBps ?? 0);
  const tone = s.cmvHealth === 'good' ? 'bg-emerald-50 text-emerald-700' : s.cmvHealth === 'attention' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700';
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      CMV {s.cmvPct?.toLocaleString('pt-BR')}% · lucro {formatBRL(s.profitCents)} ({s.resultPct?.toLocaleString('pt-BR')}%)
    </span>
  );
}
