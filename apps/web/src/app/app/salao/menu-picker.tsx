'use client';

import { useMemo, useState } from 'react';
import { formatBRL, type PublicProduct } from '@delivery360/shared';

export interface CartLine {
  key: string;
  product: PublicProduct;
  quantity: number;
  optionIds: string[];
  notes: string;
}

export const lineUnit = (l: CartLine) =>
  l.product.priceCents +
  l.product.optionGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).reduce((s, o) => s + o.priceCents, 0);

export const lineOptions = (l: CartLine) =>
  l.product.optionGroups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).map((o) => o.name);

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cardápio do garçom: busca, categorias e toque rápido; produto com escolhas abre a folha de opções. */
export function MenuPicker({
  categories,
  topIds,
  cart,
  onAdd,
}: {
  categories: { id: string; name: string; products: PublicProduct[] }[];
  topIds: string[];
  cart: CartLine[];
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('top');
  const [open, setOpen] = useState<PublicProduct | null>(null);

  const all = useMemo(() => categories.flatMap((c) => c.products), [categories]);
  const top = useMemo(() => topIds.map((id) => all.find((p) => p.id === id)).filter((p): p is PublicProduct => !!p).slice(0, 8), [topIds, all]);
  const list = q.trim()
    ? all.filter((p) => norm(p.name).includes(norm(q.trim())))
    : cat === 'top' && top.length
      ? top
      : (categories.find((c) => c.id === cat)?.products ?? categories[0]?.products ?? []);
  const inCart = (id: string) => cart.filter((l) => l.product.id === id).reduce((s, l) => s + l.quantity, 0);

  function tap(p: PublicProduct) {
    if (!p.available) return;
    if (p.optionGroups.length === 0) onAdd({ product: p, quantity: 1, optionIds: [], notes: '' });
    else setOpen(p);
  }

  return (
    <div>
      <input className="input mb-3 py-3 text-base" placeholder="Buscar no cardápio..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no cardápio" />
      {!q.trim() && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {top.length > 0 && (
            <Chip active={cat === 'top'} onClick={() => setCat('top')}>
              ⭐ Mais pedidos
            </Chip>
          )}
          {categories.map((c) => (
            <Chip key={c.id} active={cat === c.id || (cat === 'top' && !top.length && c.id === categories[0]?.id)} onClick={() => setCat(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}
      {list.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Nada encontrado.</p>}
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white">
        {list.map((p) => {
          const n = inCart(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!p.available}
                onClick={() => tap(p)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left transition active:bg-orange-50 disabled:opacity-50"
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-lg">🍽️</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-sm text-zinc-500">
                    {p.available ? formatBRL(p.priceCents) : 'Esgotado'}
                    {p.optionGroups.some((g) => g.minSelect > 0) && ' · com escolhas'}
                  </span>
                </span>
                {n > 0 ? (
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-[image:var(--grad-ember)] px-2 text-sm font-bold text-white">{n}</span>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-orange-200 text-lg text-[var(--brand)]">+</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <OptionsSheet
          product={open}
          onClose={() => setOpen(null)}
          onAdd={(line) => {
            onAdd(line);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${active ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-700'}`}
    >
      {children}
    </button>
  );
}

/** Folha de opções (sabores, ponto, adicionais) e observação do item, como na loja, mas direta. */
function OptionsSheet({ product: p, onClose, onAdd }: { product: PublicProduct; onClose: () => void; onAdd: (line: Omit<CartLine, 'key'>) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const missing = p.optionGroups.filter((g) => picked.filter((id) => g.options.some((o) => o.id === id)).length < g.minSelect);
  const unit = p.priceCents + p.optionGroups.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).reduce((s, o) => s + o.priceCents, 0);

  function toggle(groupId: string, optionId: string) {
    const g = p.optionGroups.find((x) => x.id === groupId)!;
    const inGroup = picked.filter((id) => g.options.some((o) => o.id === id));
    if (picked.includes(optionId)) return setPicked(picked.filter((id) => id !== optionId));
    if (g.maxSelect === 1) return setPicked([...picked.filter((id) => !inGroup.includes(id)), optionId]);
    if (inGroup.length >= g.maxSelect) return;
    setPicked([...picked, optionId]);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.name}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{p.name}</h3>
            <p className="text-sm text-zinc-500">{formatBRL(p.priceCents)}</p>
          </div>
          <button className="rounded-full p-2 text-zinc-500" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {p.optionGroups.map((g) => {
          const count = picked.filter((id) => g.options.some((o) => o.id === id)).length;
          return (
            <section key={g.id} className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-semibold">{g.name}</h4>
                <span className={`rounded-full px-2 py-0.5 text-xs ${g.minSelect > count ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600'}`}>
                  {g.minSelect > 0 ? 'Obrigatório · ' : ''}
                  {g.maxSelect === 1 ? 'escolha 1' : `até ${g.maxSelect}`}
                </span>
              </div>
              <div className="grid gap-2">
                {g.options.map((o) => {
                  const on = picked.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={!o.available}
                      onClick={() => toggle(g.id, o.id)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition disabled:opacity-40 ${on ? 'border-[var(--brand)] bg-orange-50 font-semibold' : 'border-zinc-200'}`}
                    >
                      <span>
                        {on ? '✓ ' : ''}
                        {o.name}
                        {!o.available && ' (esgotado)'}
                      </span>
                      {o.priceCents > 0 && <span className="text-zinc-500">+ {formatBRL(o.priceCents)}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <label className="label" htmlFor="item-notes">Observação para a cozinha</label>
        <input id="item-notes" className="input mb-4" placeholder="Ex.: sem cebola, bem passado" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-zinc-200">
            <button className="px-4 py-3 text-lg" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Menos">−</button>
            <span className="w-6 text-center font-bold">{qty}</span>
            <button className="px-4 py-3 text-lg" onClick={() => setQty(Math.min(50, qty + 1))} aria-label="Mais">+</button>
          </div>
          <button
            className="btn-primary flex-1 py-3 text-base"
            disabled={missing.length > 0}
            onClick={() => onAdd({ product: p, quantity: qty, optionIds: picked, notes: notes.trim() })}
          >
            {missing.length ? `Escolha: ${missing[0].name}` : `Adicionar · ${formatBRL(unit * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
