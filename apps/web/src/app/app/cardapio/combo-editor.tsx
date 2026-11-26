'use client';

import { useMemo, useState } from 'react';
import { costSheet, DEFAULT_RATES, discountPct, effectivePrice, formatBRL, parseBRL, unitCost, type CostItem } from '@delivery360/shared';
import { ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';
import type { RatesInfo } from './cost-sheet';
import type { Category, Product } from './types';

const toMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Item de uma etapa: um produto do cardápio ou um item que só existe no combo. */
interface ItemForm {
  id?: string;
  productId?: string;
  name: string;
  /** Acréscimo no preço do combo ao escolher este item (R$). */
  extra: string;
  /** Custo do item novo (R$); o do produto do cardápio vem da ficha técnica dele. */
  cost: string;
}
interface StepForm {
  id?: string;
  name: string;
  /** Quantos itens o cliente escolhe nesta etapa. */
  pick: number;
  optional: boolean;
  items: ItemForm[];
}

const NEW_STEP = (name: string): StepForm => ({ name, pick: 1, optional: false, items: [] });

const fromProduct = (p: Product): StepForm[] =>
  p.optionGroups.map((g) => ({
    id: g.id,
    name: g.name,
    pick: g.maxSelect,
    optional: g.minSelect === 0,
    items: g.options.map((o) => ({
      id: o.id,
      productId: o.linkedProductId ?? undefined,
      name: o.name,
      extra: o.priceCents ? toMoney(o.priceCents) : '',
      cost: o.costCents ? toMoney(o.costCents) : '',
    })),
  }));

/**
 * "Criar combo": o restaurante junta produtos do cardápio (pizza + refri) ou cria itens só do combo
 * (ex.: brownie da casa), define o preço promocional e vê na hora quanto o cliente economiza e a margem.
 */
export function ComboEditor({
  combo,
  categories,
  rates,
  onClose,
  onSaved,
}: {
  combo: Product | null;
  categories: Category[];
  rates: RatesInfo | null;
  onClose: () => void;
  onSaved: (p: Product) => Promise<void>;
}) {
  const combosCategory = categories.find((c) => c.name.trim().toLowerCase() === 'combos');
  const [name, setName] = useState(combo?.name ?? '');
  const [description, setDescription] = useState(combo?.description ?? '');
  const [imageUrl, setImageUrl] = useState(combo?.imageUrl ?? '');
  const [categoryId, setCategoryId] = useState(combo?.categoryId ?? combosCategory?.id ?? 'new');
  const [price, setPrice] = useState(combo ? toMoney(combo.priceCents) : '');
  const [steps, setSteps] = useState<StepForm[]>(combo ? fromProduct(combo) : [NEW_STEP('Escolha o lanche'), NEW_STEP('Bebida')]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const products = useMemo(
    () => categories.flatMap((c) => c.products.filter((p) => !p.isCombo && p.id !== combo?.id).map((p) => ({ ...p, categoryName: c.name }))),
    [categories, combo?.id],
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Separado: os itens mais baratos de cada etapa, comprados avulsos. Custo: os mesmos itens pela ficha técnica.
  const summary = useMemo(() => {
    let separate = 0;
    let cost = 0;
    let missingCost = false;
    for (const s of steps) {
      if (s.optional) continue;
      const options = s.items
        .map((i) => {
          const p = i.productId ? byId.get(i.productId) : undefined;
          const extra = parseBRL(i.extra || '0') ?? 0;
          const itemCost = p ? unitCost((p.costItems ?? []) as CostItem[]) : (parseBRL(i.cost || '0') ?? 0);
          if (p && !(p.costItems ?? []).length) missingCost = true;
          return { separate: p ? effectivePrice(p) + extra : null, cost: itemCost };
        })
        .sort((a, b) => (a.separate ?? 0) - (b.separate ?? 0));
      const chosen = options.slice(0, s.pick);
      separate += chosen.reduce((t, o) => t + (o.separate ?? 0), 0);
      cost += chosen.reduce((t, o) => t + o.cost, 0);
    }
    return { separate, cost, missingCost };
  }, [steps, byId]);
  const priceCents = parseBRL(price) ?? 0;
  const sheet = priceCents > 0 && summary.cost > 0 ? costSheet(priceCents, [{ name: 'Itens', kind: 'INGREDIENT', costCents: summary.cost }], rates ?? DEFAULT_RATES) : null;
  const saving = summary.separate > priceCents && priceCents > 0 ? discountPct(summary.separate, priceCents) : 0;

  const setStep = (i: number, s: Partial<StepForm>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const setItem = (i: number, k: number, it: Partial<ItemForm>) => setStep(i, { items: steps[i].items.map((x, j) => (j === k ? { ...x, ...it } : x)) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!priceCents) return setError('Informe o preço do combo.');
    if (!steps.length) return setError('Adicione pelo menos uma etapa.');
    for (const s of steps) {
      if (!s.name.trim()) return setError('Dê um nome a cada etapa.');
      if (!s.items.length) return setError(`A etapa "${s.name}" está sem itens.`);
      if (!s.optional && s.pick > s.items.length) return setError(`Em "${s.name}", o cliente escolhe ${s.pick}, mas só há ${s.items.length} item(ns).`);
    }
    setBusy(true);
    try {
      let catId = categoryId;
      if (catId === 'new') {
        catId = (await api<{ id: string }>('/cardapio/categories', { method: 'POST', body: { name: 'Combos', position: 0 }, tenant: true })).id;
      }
      const body = {
        categoryId: catId,
        name: name.trim(),
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        priceCents,
        steps: steps.map((s) => ({
          id: s.id,
          name: s.name.trim(),
          minSelect: s.optional ? 0 : s.pick,
          maxSelect: s.pick,
          options: s.items.map((i) => ({
            id: i.id,
            productId: i.productId,
            name: i.productId ? undefined : i.name.trim(),
            priceCents: parseBRL(i.extra || '0') ?? 0,
            costCents: i.productId ? undefined : (parseBRL(i.cost || '0') ?? 0),
          })),
        })),
      };
      const saved = combo
        ? await api<Product>(`/cardapio/combos/${combo.id}`, { method: 'PUT', body, tenant: true })
        : await api<Product>('/cardapio/combos', { method: 'POST', body, tenant: true });
      await onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card h-fit space-y-4 lg:sticky lg:top-4">
      <div className="flex items-center">
        <h2 className="font-semibold">{combo ? 'Editar combo' : 'Criar combo'}</h2>
        <button className="ml-auto text-sm text-zinc-500 hover:text-zinc-800" onClick={onClose}>
          Fechar
        </button>
      </div>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="combo-name">Nome do combo</label>
          <input id="combo-name" className="input" required maxLength={120} placeholder="Ex.: Combo Família" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="combo-desc">Descrição (opcional)</label>
          <textarea id="combo-desc" className="input" rows={2} placeholder="Pizza grande + refri 2L + sobremesa" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="combo-cat">Categoria</label>
            <select id="combo-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {!combosCategory && <option value="new">Combos (nova)</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="combo-img">Foto (link)</label>
            <input id="combo-img" className="input" placeholder="https://..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          <span className="label">O que vem no combo</span>
          {steps.map((s, i) => (
            <fieldset key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3">
              <div className="flex items-center gap-2">
                <input className="input flex-1 font-medium" aria-label="Nome da etapa" value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} />
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  Tirar
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                Cliente escolhe
                <select className="input w-16 py-1" aria-label="Quantos itens" value={s.pick} onChange={(e) => setStep(i, { pick: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                {s.items.length <= s.pick && !s.optional ? '(já vem incluído)' : `de ${s.items.length}`}
                <label className="ml-auto flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={s.optional} onChange={(e) => setStep(i, { optional: e.target.checked })} />
                  Opcional
                </label>
              </div>
              <ul className="space-y-1.5">
                {s.items.map((it, k) => {
                  const p = it.productId ? byId.get(it.productId) : undefined;
                  return (
                    <li key={k} className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-sm">
                      {p ? (
                        <span className="min-w-0 flex-1 truncate">
                          {p.name} <span className="text-xs text-zinc-500">· avulso {formatBRL(effectivePrice(p))}</span>
                        </span>
                      ) : (
                        <>
                          <input className="input min-w-0 flex-1 py-1" placeholder="Item só do combo" value={it.name} onChange={(e) => setItem(i, k, { name: e.target.value })} />
                          <input className="input w-24 py-1" inputMode="decimal" placeholder="Custo R$" aria-label="Custo do item" value={it.cost} onChange={(e) => setItem(i, k, { cost: e.target.value })} />
                        </>
                      )}
                      <input className="input w-24 py-1" inputMode="decimal" placeholder="+ R$ 0,00" aria-label="Acréscimo no preço" value={it.extra} onChange={(e) => setItem(i, k, { extra: e.target.value })} />
                      <button type="button" className="text-xs text-zinc-500 hover:text-red-600" aria-label="Tirar item" onClick={() => setStep(i, { items: s.items.filter((_, j) => j !== k) })}>
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2">
                <select
                  className="input flex-1 py-1 text-sm"
                  aria-label="Adicionar produto do cardápio"
                  value=""
                  onChange={(e) => e.target.value && setStep(i, { items: [...s.items, { productId: e.target.value, name: '', extra: '', cost: '' }] })}
                >
                  <option value="">+ Produto do cardápio</option>
                  {categories.map((c) => (
                    <optgroup key={c.id} label={c.name}>
                      {c.products
                        .filter((p) => byId.has(p.id) && !s.items.some((x) => x.productId === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {formatBRL(effectivePrice(p))}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" className="btn-ghost py-1 text-sm" onClick={() => setStep(i, { items: [...s.items, { name: '', extra: '', cost: '' }] })}>
                  + Item novo
                </button>
              </div>
            </fieldset>
          ))}
          <button type="button" className="text-sm text-[var(--brand)] hover:underline" onClick={() => setSteps([...steps, NEW_STEP('Sobremesa')])}>
            + Adicionar etapa
          </button>
        </div>

        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="grid grid-cols-2 items-end gap-3">
            <div>
              <label className="label" htmlFor="combo-price">Preço do combo (R$)</label>
              <input id="combo-price" className="input text-lg font-semibold" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="pb-2 text-sm">
              {summary.separate > 0 && (
                <p className="text-zinc-600">
                  Separado: <span className="line-through">{formatBRL(summary.separate)}</span>
                </p>
              )}
              {saving > 0 && <p className="font-semibold text-emerald-700">Cliente economiza {saving}%</p>}
            </div>
          </div>
          {sheet && (
            <p className={`mt-2 text-sm ${sheet.profitCents > 0 ? 'text-zinc-700' : 'text-red-700'}`}>
              Custo dos itens {formatBRL(summary.cost)} (CMV {sheet.cmvPct ?? 0}%) · lucro estimado {formatBRL(sheet.profitCents)} por combo
              {sheet.profitCents <= 0 && '. Abaixo do custo!'}
            </p>
          )}
          {summary.missingCost && <p className="mt-1 text-xs text-zinc-500">Alguns produtos estão sem ficha técnica: o custo pode estar menor do que o real.</p>}
        </div>

        <ErrorBox message={error} />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Salvando...' : combo ? 'Salvar combo' : 'Criar combo'}
        </button>
        {combo && (
          <button
            type="button"
            className="w-full text-sm text-red-600 hover:underline"
            onClick={async () => {
              if (!window.confirm(`Apagar ${combo.name}? Pedidos antigos continuam no histórico.`)) return;
              try {
                await api(`/cardapio/products/${combo.id}`, { method: 'DELETE', tenant: true });
                await onSaved(combo);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Erro ao apagar.');
              }
            }}
          >
            Apagar combo
          </button>
        )}
      </form>
    </aside>
  );
}
