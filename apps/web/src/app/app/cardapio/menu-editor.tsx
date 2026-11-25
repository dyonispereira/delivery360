'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Category, Group, Product } from './types';

const toMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function MenuEditor({ canEdit }: { canEdit: boolean }) {
  const [menu, setMenu] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState<{ product: Partial<Product> & { categoryId: string } } | null>(null);

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
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing({ product: p })}>
                    <div className="font-medium">
                      {p.name} {!p.active && <Badge tone="amber">Fora do cardápio</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {formatBRL(p.priceCents)}
                      {p.optionGroups.length > 0 && ` · ${p.optionGroups.length} grupo(s) de adicionais`}
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
              <button className="text-sm text-[var(--brand)] hover:underline" onClick={() => setEditing({ product: { categoryId: c.id } })}>
                + Adicionar produto
              </button>
            )}
          </section>
        ))}
      </div>

      {editing && editingProduct && (
        <ProductEditor
          key={editingProduct.id ?? 'novo'}
          product={editingProduct as Partial<Product> & { categoryId: string }}
          categories={menu}
          canEdit={canEdit}
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
  onClose,
  onSaved,
  onChanged,
}: {
  product: Partial<Product> & { categoryId: string };
  categories: Category[];
  canEdit: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = parseBRL(form.price);
    if (priceCents === null) return setError('Preço inválido.');
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description || undefined,
      priceCents,
      imageUrl: form.imageUrl || undefined,
      categoryId: form.categoryId,
      active: form.active,
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
        <div>
          <label className="label">Foto (link da imagem)</label>
          <input className="input" disabled={!canEdit} placeholder="https://..." value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Aparece no cardápio
        </label>
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
    void run(() => api(`/cardapio/groups/${groupId}/options`, { method: 'POST', body: { name, priceCents }, tenant: true }));
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
                <span className="text-xs text-zinc-500">{o.priceCents ? `+ ${formatBRL(o.priceCents)}` : 'grátis'}</span>
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
