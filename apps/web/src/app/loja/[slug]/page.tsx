'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  discountPct,
  formatBRL,
  parseBRL,
  rebuildOrder,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderTracking,
  type PaymentMethod,
  type PublicProduct,
  type PublicStore,
} from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';

interface CartItem {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  optionIds: string[];
  optionNames: string[];
  notes: string;
}

/** Pedido feito neste aparelho (só o código de acompanhamento fica guardado). */
interface PastOrder {
  code: string;
  createdAt: string;
  totalCents: number;
}

const cartKey = (slug: string) => `d360.cart.${slug}`;
const ordersKey = (slug: string) => `d360.orders.${slug}`;
const customerKey = 'd360.customer';
const MAX_PAST_ORDERS = 20;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem storage: o carrinho vive só nesta aba */
  }
}

function rememberOrder(slug: string, order: OrderTracking) {
  const list = load<PastOrder[]>(ordersKey(slug), []).filter((o) => o.code !== order.trackingCode);
  save(ordersKey(slug), [{ code: order.trackingCode, createdAt: String(order.createdAt), totalCents: order.totalCents }, ...list].slice(0, MAX_PAST_ORDERS));
}

const newKey = () => `${Date.now()}-${Math.random()}`;
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
const ACTIVE_STATUSES = ['AWAITING_PAYMENT', 'PAID', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY'];

export default function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<PublicStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<'inicio' | 'promos' | 'pedidos'>('inicio');
  const [query, setQuery] = useState('');
  const [past, setPast] = useState<PastOrder[]>([]);
  const [last, setLast] = useState<OrderTracking | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.status === 404 ? 'Loja não encontrada.' : e.message));
    setCart(load<CartItem[]>(cartKey(slug), []));
    const orders = load<PastOrder[]>(ordersKey(slug), []);
    setPast(orders);
    if (orders[0]) {
      api<OrderTracking>(`/public/orders/${encodeURIComponent(orders[0].code)}`)
        .then(setLast)
        .catch(() => setLast(null));
    }
    // Guarda a origem do clique (anúncio, Instagram...) para o módulo de Tráfego medir o resultado.
    const search = new URLSearchParams(window.location.search);
    const utm = { source: search.get('utm_source'), campaign: search.get('utm_campaign') };
    if (utm.source || utm.campaign) save(`d360.utm.${slug}`, utm);
  }, [slug]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const updateCart = (next: CartItem[]) => {
    setCart(next);
    save(cartKey(slug), next);
  };
  const addToCart = (item: CartItem) => {
    updateCart([...cart, item]);
    setToast(`${item.name} no carrinho`);
  };

  const products = useMemo(() => new Map((data?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const))), [data]);

  /** Produto sem escolha obrigatória entra direto no carrinho pelo botão +. */
  const quickAdd = (p: PublicProduct) => {
    if (p.optionGroups.some((g) => g.minSelect > 0)) return setSelected(p);
    addToCart({ key: newKey(), productId: p.id, name: p.name, quantity: 1, unitPriceCents: p.priceCents, optionIds: [], optionNames: [], notes: '' });
  };

  const reorder = async (code: string) => {
    if (!data) return;
    try {
      const order = last?.trackingCode === code ? last : await api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}`);
      const r = rebuildOrder(order, data);
      if (!r.items.length) {
        setWarnings(r.warnings);
        setToast('Nenhum item desse pedido está disponível hoje.');
        return;
      }
      updateCart(r.items.map((i) => ({ ...i, key: newKey() })));
      setWarnings(r.warnings);
      setTab('inicio');
      setCheckout(true);
    } catch (e) {
      setToast((e as ApiError).message);
    }
  };

  const subtotal = cart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const count = cart.reduce((s, i) => s + i.quantity, 0);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <ErrorBox message={error} />
      </main>
    );
  }
  if (!data) return <Spinner />;
  const { store } = data;
  const promos = data.categories.flatMap((c) => c.products).filter((p) => p.listPriceCents != null && p.available);
  const top = data.topProductIds.map((id) => products.get(id)).filter((p): p is PublicProduct => !!p);
  const q = query.trim().toLowerCase();
  const categories = q
    ? data.categories
        .map((c) => ({ ...c, products: c.products.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q)) }))
        .filter((c) => c.products.length > 0)
    : data.categories;
  const canOrder = store.isOpen;

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white pb-36">
      {tab === 'inicio' ? (
        <>
          <StoreHeader store={store} />

          {last && (
            <section className="px-4 pt-4" aria-label="Seu último pedido">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-bold">Seu último pedido</h2>
                <span className="text-xs capitalize text-zinc-500">{dateLabel(String(last.createdAt))}</span>
              </div>
              <div className="rounded-2xl border border-zinc-200 p-3">
                <ul className="space-y-1 text-sm">
                  {last.items.map((i, n) => (
                    <li key={n} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {i.quantity}× {i.name}
                        {i.options.length > 0 && <span className="text-zinc-500"> ({i.options.map((o) => o.name).join(', ')})</span>}
                      </span>
                      <span className="shrink-0 text-zinc-500">{formatBRL(i.totalCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  {ACTIVE_STATUSES.includes(last.status) ? (
                    <a href={`/pedido/${last.trackingCode}`} className="btn-primary flex-1 py-3">
                      Acompanhar pedido · {ORDER_STATUS_LABELS[last.status]}
                    </a>
                  ) : (
                    <button className="btn-primary flex-1 py-3" disabled={!canOrder} onClick={() => reorder(last.trackingCode)}>
                      {canOrder ? 'Pedir de novo' : 'Loja fechada'}
                    </button>
                  )}
                  <button className="btn-ghost py-3" onClick={() => setTab('pedidos')}>
                    Ver todos
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="px-4 pt-4">
            <label className="sr-only" htmlFor="busca">Buscar no cardápio</label>
            <input id="busca" className="input py-3" type="search" placeholder="Buscar no cardápio" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {!q && promos.length > 0 && (
            <section className="pt-5" aria-label="Em promoção">
              <div className="mb-2 flex items-baseline justify-between px-4">
                <h2 className="text-lg font-bold">Em promoção</h2>
                <button className="text-sm font-medium text-[var(--brand)]" onClick={() => setTab('promos')}>
                  Ver todas
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto px-4 pb-1">
                {promos.slice(0, 8).map((p) => (
                  <div key={p.id} className="w-36 shrink-0">
                    <div className="relative">
                      <button className="block w-full" onClick={() => setSelected(p)} disabled={!canOrder} aria-label={p.name}>
                        <ProductImage product={p} className="aspect-square w-full rounded-xl" />
                      </button>
                      <OffBadge product={p} className="absolute left-2 top-2" />
                      {canOrder && (
                        <button
                          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xl font-semibold shadow-md"
                          onClick={() => quickAdd(p)}
                          aria-label={`Adicionar ${p.name}`}
                        >
                          +
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                    <Price product={p} className="text-sm" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {!q && top.length >= 3 && (
            <section className="pt-5" aria-label="Mais pedidos">
              <h2 className="mb-2 px-4 text-lg font-bold">Mais pedidos</h2>
              <div className="flex gap-3 overflow-x-auto px-4 pb-1">
                {top.map((p) => (
                  <div key={p.id} className="w-36 shrink-0">
                    <div className="relative">
                      <button className="block w-full" onClick={() => setSelected(p)} disabled={!canOrder} aria-label={p.name}>
                        <ProductImage product={p} className="aspect-square w-full rounded-xl" />
                      </button>
                      <OffBadge product={p} className="absolute left-2 top-2" />
                      {canOrder && (
                        <button
                          className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xl font-semibold shadow-md"
                          onClick={() => quickAdd(p)}
                          aria-label={`Adicionar ${p.name}`}
                        >
                          +
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                    <Price product={p} className="text-sm" />
                  </div>
                ))}
              </div>
            </section>
          )}

          <CategoryTabs categories={categories} />

          <div className="px-4">
            {data.categories.length === 0 && <p className="py-6 text-sm text-zinc-500">O cardápio ainda está sendo montado.</p>}
            {q && categories.length === 0 && <p className="py-6 text-sm text-zinc-500">Nada encontrado para “{query}”.</p>}
            {categories.map((c) => (
              <section key={c.id} id={`cat-${c.id}`} data-cat={c.id} className="scroll-mt-16 pt-5">
                <h2 className="text-lg font-bold">{c.name}</h2>
                <div className="divide-y divide-zinc-100">
                  {c.products.map((p) => (
                    <div key={p.id} className="flex items-start gap-3 py-4">
                      <button
                        disabled={!p.available || !canOrder}
                        onClick={() => setSelected(p)}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                      >
                        <p className={`font-semibold ${p.available ? '' : 'text-zinc-400'}`}>{p.name}</p>
                        {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{p.description}</p>}
                        <p className="mt-1.5 flex flex-wrap items-center gap-2">
                          {p.available ? (
                            <>
                              <Price product={p} />
                              <OffBadge product={p} />
                            </>
                          ) : (
                            <span className="text-sm font-medium text-zinc-400">Esgotado hoje</span>
                          )}
                        </p>
                      </button>
                      {(p.imageUrl || (p.available && canOrder)) && (
                        <div className="relative shrink-0">
                          <button disabled={!p.available || !canOrder} onClick={() => setSelected(p)} aria-label={p.name} tabIndex={-1}>
                            <ProductImage product={p} className={`h-24 w-24 rounded-xl ${p.available ? '' : 'opacity-50 grayscale'}`} />
                          </button>
                          {p.available && canOrder && (
                            <button
                              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xl font-semibold shadow-md ring-1 ring-zinc-200"
                              onClick={() => quickAdd(p)}
                              aria-label={`Adicionar ${p.name}`}
                            >
                              +
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : tab === 'promos' ? (
        <section className="px-4 pt-6" aria-label="Promoções">
          <h1 className="text-2xl font-bold">Promoções</h1>
          {promos.length === 0 ? (
            <p className="mt-6 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">Nenhuma promoção agora. Volte mais tarde!</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {promos.map((p) => (
                <div key={p.id}>
                  <div className="relative">
                    <button className="block w-full" onClick={() => setSelected(p)} disabled={!canOrder || !p.available} aria-label={p.name}>
                      <ProductImage product={p} className="aspect-square w-full rounded-xl" />
                    </button>
                    <OffBadge product={p} className="absolute left-2 top-2" />
                    {canOrder && p.available && (
                      <button
                        className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xl font-semibold shadow-md"
                        onClick={() => quickAdd(p)}
                        aria-label={`Adicionar ${p.name}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                  <Price product={p} className="text-sm" />
                  {p.promoEndsAt && <p className="text-xs text-zinc-500">{untilLabel(p.promoEndsAt)}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <MyOrders slug={slug} past={past} canOrder={canOrder} storeName={store.displayName} onReorder={reorder} />
      )}

      {count > 0 && !checkout && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-3">
          <button
            className="mx-auto flex w-full max-w-2xl items-center justify-between rounded-2xl bg-[var(--brand)] px-4 py-3.5 font-semibold text-white shadow-lg"
            onClick={() => setCheckout(true)}
          >
            <span className="flex items-center gap-2">
              <span className="rounded-md bg-white/25 px-2 text-sm">{count}</span>
              Ver carrinho
            </span>
            <span>{formatBRL(subtotal)}</span>
          </button>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)]" aria-label="Navegação da loja">
        <div className="mx-auto grid h-16 max-w-2xl grid-cols-3">
          {(
            [
              ['inicio', 'Início', 'M3 11 12 4l9 7v9h-6v-6H9v6H3z'],
              ['promos', 'Promoções', 'M20 12 12 20l-8-8V4h8zM8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3'],
              ['pedidos', 'Meus pedidos', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'],
            ] as const
          ).map(([key, label, d]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                window.scrollTo({ top: 0 });
              }}
              className={`flex flex-col items-center justify-center gap-0.5 text-xs ${tab === key ? 'font-bold text-zinc-900' : 'text-zinc-500'}`}
              aria-current={tab === key ? 'page' : undefined}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
                <path d={d} />
              </svg>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {toast && (
        <div role="status" className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {selected && (
        <ProductModal
          product={selected}
          onClose={() => setSelected(null)}
          onAdd={(item) => {
            addToCart(item);
            setSelected(null);
          }}
        />
      )}

      {checkout && (
        <Checkout
          slug={slug}
          data={data}
          cart={cart}
          warnings={warnings}
          onCart={updateCart}
          onClose={() => {
            setCheckout(false);
            setWarnings([]);
          }}
        />
      )}
    </main>
  );
}

/** Preço de hoje; na promoção, o preço normal riscado ao lado. */
function Price({ product, className = '' }: { product: PublicProduct; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      <span className="font-bold">{formatBRL(product.priceCents)}</span>
      {product.listPriceCents != null && <s className="text-xs font-normal text-zinc-400">{formatBRL(product.listPriceCents)}</s>}
    </span>
  );
}

function OffBadge({ product, className = '' }: { product: PublicProduct; className?: string }) {
  if (product.listPriceCents == null) return null;
  const pct = discountPct(product.listPriceCents, product.priceCents);
  if (!pct) return null;
  return <span className={`rounded-md bg-[var(--brand)] px-1.5 py-0.5 text-xs font-bold text-white ${className}`}>−{pct}%</span>;
}

const untilLabel = (iso: string | null) =>
  iso ? `até ${new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : null;

function ProductImage({ product, className }: { product: PublicProduct; className: string }) {
  if (product.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.imageUrl} alt="" loading="lazy" className={`${className} bg-zinc-100 object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center bg-[var(--brand)]/10 text-2xl font-bold text-[var(--brand)]`} aria-hidden="true">
      {product.name.charAt(0)}
    </div>
  );
}

function StoreHeader({ store }: { store: PublicStore['store'] }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) return await navigator.share({ title: store.displayName, url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* o cliente cancelou */
    }
  };
  return (
    <header>
      <div
        className="relative h-36 bg-zinc-800 bg-cover bg-center sm:h-44"
        style={store.coverUrl ? { backgroundImage: `url("${store.coverUrl}")` } : { background: 'linear-gradient(135deg, var(--brand), #1f1f1f)' }}
      >
        <button
          onClick={share}
          className="absolute right-3 top-3 flex h-9 items-center gap-1 rounded-full bg-white/95 px-3 text-sm font-medium text-zinc-900 shadow"
          aria-label="Compartilhar a loja"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
          </svg>
          {copied ? 'Link copiado' : 'Compartilhar'}
        </button>
      </div>
      <div className="relative -mt-8 px-4">
        {store.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logoUrl} alt="" className="h-16 w-16 rounded-2xl border-4 border-white bg-white object-cover shadow" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-white bg-[var(--brand)] text-2xl font-bold text-white shadow">
            {store.displayName.charAt(0)}
          </div>
        )}
        <h1 className="mt-2 text-2xl font-bold">{store.displayName}</h1>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-zinc-500">
          {store.rating && (
            <span>
              <b className="text-zinc-900">{store.rating.average.toFixed(1).replace('.', ',')}</b> ★ ({store.rating.count} avaliações)
            </span>
          )}
          <span>{store.estimatedMinutes} min</span>
          {store.minOrderCents > 0 && <span>Pedido mínimo {formatBRL(store.minOrderCents)}</span>}
        </p>
        {store.description && <p className="mt-2 text-sm text-zinc-600">{store.description}</p>}
        <p
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${store.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
        >
          <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
          {store.isOpen ? 'Aberto agora' : 'Fechado no momento'}
        </p>
      </div>
    </header>
  );
}

/** Abas fixas no topo; a aba da seção que está na tela fica marcada. */
function CategoryTabs({ categories }: { categories: { id: string; name: string }[] }) {
  const [active, setActive] = useState<string | null>(categories[0]?.id ?? null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set((e.target as HTMLElement).dataset.cat!, e.isIntersecting);
        const first = categories.find((c) => seen.get(c.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-64px 0px -60% 0px' },
    );
    document.querySelectorAll<HTMLElement>('[data-cat]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [categories]);
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);
  if (categories.length < 2) return null;
  return (
    <nav ref={bar} className="sticky top-0 z-10 mt-4 flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur" aria-label="Categorias">
      {categories.map((c) => (
        <a
          key={c.id}
          data-tab={c.id}
          href={`#cat-${c.id}`}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${active === c.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          {c.name}
        </a>
      ))}
    </nav>
  );
}

function MyOrders({
  slug,
  past,
  canOrder,
  storeName,
  onReorder,
}: {
  slug: string;
  past: PastOrder[];
  canOrder: boolean;
  storeName: string;
  onReorder: (code: string) => void;
}) {
  const [orders, setOrders] = useState<(OrderTracking | null)[] | null>(null);
  useEffect(() => {
    Promise.all(past.slice(0, 10).map((o) => api<OrderTracking>(`/public/orders/${encodeURIComponent(o.code)}`).catch(() => null))).then(setOrders);
  }, [past]);
  return (
    <section className="px-4 pt-6">
      <h1 className="text-2xl font-bold">Meus pedidos</h1>
      <p className="mt-1 text-sm text-zinc-500">Pedidos feitos neste celular na {storeName}.</p>
      {past.length === 0 && <p className="mt-6 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">Seu primeiro pedido aparece aqui, com o botão para pedir de novo.</p>}
      {past.length > 0 && !orders && <Spinner />}
      <ul className="mt-4 space-y-3">
        {orders?.map((o, n) =>
          o ? (
            <li key={o.trackingCode} className="rounded-2xl border border-zinc-200 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">Pedido #{o.number}</span>
                <span className="text-xs capitalize text-zinc-500">{dateLabel(String(o.createdAt))}</span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
              <p className="mt-1 text-sm">
                <b>{formatBRL(o.totalCents)}</b> · {ORDER_STATUS_LABELS[o.status]}
              </p>
              <div className="mt-3 flex gap-2">
                {!ACTIVE_STATUSES.includes(o.status) && (
                  <button className="btn-primary flex-1 py-2.5" disabled={!canOrder} onClick={() => onReorder(o.trackingCode)}>
                    {canOrder ? 'Pedir de novo' : 'Loja fechada'}
                  </button>
                )}
                <a className="btn-ghost flex-1 py-2.5" href={`/pedido/${o.trackingCode}`}>
                  {ACTIVE_STATUSES.includes(o.status) ? 'Acompanhar' : 'Detalhes'}
                </a>
              </div>
            </li>
          ) : (
            <li key={past[n].code} className="rounded-2xl border border-dashed border-zinc-200 p-3 text-sm text-zinc-500">
              Pedido de {dateLabel(past[n].createdAt)} não encontrado.
            </li>
          ),
        )}
      </ul>
      <a className="mt-6 block text-center text-sm text-zinc-500 underline" href={`/loja/${slug}`}>
        Voltar ao cardápio
      </a>
    </section>
  );
}

function Sheet({ title, onClose, children, footer, cover }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; cover?: string | null }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {cover ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" className="h-52 w-full object-cover" />
            <button className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow" onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        <div className="border-t border-zinc-200 p-3">{footer}</div>
      </div>
    </div>
  );
}

function ProductModal({ product, onClose, onAdd }: { product: PublicProduct; onClose: () => void; onAdd: (i: CartItem) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const toggle = (groupId: string, optionId: string, max: number) => {
    setPicked((prev) => {
      const cur = prev[groupId] ?? [];
      if (cur.includes(optionId)) return { ...prev, [groupId]: cur.filter((x) => x !== optionId) };
      if (max === 1) return { ...prev, [groupId]: [optionId] };
      if (cur.length >= max) return prev;
      return { ...prev, [groupId]: [...cur, optionId] };
    });
  };

  const missing = product.optionGroups.find((g) => (picked[g.id]?.length ?? 0) < g.minSelect);
  const options = product.optionGroups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id)));
  const unit = product.priceCents + options.reduce((s, o) => s + o.priceCents, 0);

  return (
    <Sheet
      title={product.name}
      cover={product.imageUrl}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-zinc-300">
            <button className="px-3 py-2.5" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Diminuir">
              −
            </button>
            <span className="w-6 text-center text-sm font-medium">{quantity}</span>
            <button className="px-3 py-2.5" onClick={() => setQuantity((q) => Math.min(50, q + 1))} aria-label="Aumentar">
              +
            </button>
          </div>
          <button
            className="btn-primary flex-1 justify-between py-3"
            disabled={!!missing}
            onClick={() =>
              onAdd({
                key: newKey(),
                productId: product.id,
                name: product.name,
                quantity,
                unitPriceCents: unit,
                optionIds: options.map((o) => o.id),
                optionNames: options.map((o) => o.name),
                notes: notes.trim(),
              })
            }
          >
            <span>{missing ? `Escolha: ${missing.name}` : 'Adicionar'}</span>
            <span>{formatBRL(unit * quantity)}</span>
          </button>
        </div>
      }
    >
      {product.imageUrl && <h2 className="text-xl font-bold">{product.name}</h2>}
      <p className="mb-1 mt-1 flex flex-wrap items-center gap-2 text-lg">
        <Price product={product} />
        <OffBadge product={product} />
        {product.promoEndsAt && <span className="text-xs text-zinc-500">{untilLabel(product.promoEndsAt)}</span>}
      </p>
      {product.description && <p className="mb-4 text-sm text-zinc-600">{product.description}</p>}

      {product.optionGroups.map((g) => {
        const cur = picked[g.id] ?? [];
        const full = g.maxSelect > 1 && cur.length >= g.maxSelect;
        const done = cur.length >= Math.max(1, g.minSelect);
        return (
          <fieldset key={g.id} className="-mx-4 mb-4">
            <legend className="sticky top-0 z-[1] flex w-full items-center justify-between gap-3 bg-zinc-100 px-4 py-2.5">
              <span>
                <span className="block font-semibold">{g.name}</span>
                <span className="text-xs text-zinc-500">
                  {g.maxSelect === 1 ? 'Escolha 1' : g.minSelect > 0 ? `Escolha de ${g.minSelect} a ${g.maxSelect}` : `Até ${g.maxSelect}`}
                </span>
              </span>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  g.minSelect > 0 && !done ? 'bg-zinc-900 text-white' : done ? 'bg-emerald-600 text-white' : 'bg-zinc-200 text-zinc-600'
                }`}
              >
                {g.maxSelect > 1 ? `${cur.length} de ${g.maxSelect}` : g.minSelect > 0 ? (done ? 'Pronto' : 'Obrigatório') : 'Opcional'}
              </span>
            </legend>
            {g.options.map((o) => {
              const on = cur.includes(o.id);
              const off = !o.available || (!on && full);
              return (
                <label key={o.id} className={`flex cursor-pointer items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 text-sm ${off ? 'opacity-45' : ''}`}>
                  <span>
                    <span className="font-medium">{o.name}</span>
                    {!o.available && <span className="text-zinc-500"> · esgotado</span>}
                    {o.priceCents > 0 && <span className="block text-zinc-500">+ {formatBRL(o.priceCents)}</span>}
                  </span>
                  <input
                    type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                    name={g.id}
                    disabled={off}
                    checked={on}
                    onChange={() => toggle(g.id, o.id, g.maxSelect)}
                    className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                  />
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <label className="label" htmlFor="notes">
        Alguma observação?
      </label>
      <textarea id="notes" className="input" rows={2} maxLength={300} placeholder="Ex.: sem cebola" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Sheet>
  );
}

function Checkout({
  slug,
  data,
  cart,
  warnings,
  onCart,
  onClose,
}: {
  slug: string;
  data: PublicStore;
  cart: CartItem[];
  warnings: string[];
  onCart: (c: CartItem[]) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { store, zones } = data;
  const saved = useMemo(() => load(customerKey, { name: '', phone: '', street: '', number: '', complement: '', zoneId: '' }), []);
  const [type, setType] = useState<'DELIVERY' | 'PICKUP'>(store.acceptsDelivery ? 'DELIVERY' : 'PICKUP');
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [zoneId, setZoneId] = useState(zones.some((z) => z.id === saved.zoneId) ? saved.zoneId : '');
  const [street, setStreet] = useState(saved.street);
  const [number, setNumber] = useState(saved.number);
  const [complement, setComplement] = useState(saved.complement);
  const methods = store.paymentMethods.filter((m) => m !== 'CREDIT_CARD');
  const [method, setMethod] = useState<PaymentMethod | ''>(methods[0] ?? '');
  const [change, setChange] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const subtotal = cart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const listOf = new Map(data.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)));
  const savings = cart.reduce((s, i) => {
    const p = listOf.get(i.productId);
    return s + (p?.listPriceCents != null ? (p.listPriceCents - p.priceCents) * i.quantity : 0);
  }, 0);
  const fee = type === 'DELIVERY' ? (zones.find((z) => z.id === zoneId)?.feeCents ?? 0) : 0;
  const total = subtotal + fee;
  const belowMin = subtotal < store.minOrderCents;

  const setQty = (key: string, q: number) => {
    const next = q <= 0 ? cart.filter((i) => i.key !== key) : cart.map((i) => (i.key === key ? { ...i, quantity: Math.min(50, q) } : i));
    onCart(next);
    if (next.length === 0) onClose();
  };

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Informe seu nome.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Informe um telefone com DDD.');
    if (type === 'DELIVERY' && (!zoneId || street.trim().length < 2 || !number.trim())) {
      return setError('Preencha bairro, rua e número para a entrega.');
    }
    if (!method) return setError('Escolha a forma de pagamento.');
    let changeForCents: number | undefined;
    if (method === 'CASH_ON_DELIVERY' && change.trim()) {
      const c = parseBRL(change);
      if (c === null || c < total) return setError(`O troco precisa ser para um valor de pelo menos ${formatBRL(total)}.`);
      changeForCents = c;
    }
    save(customerKey, { name, phone, street, number, complement, zoneId });
    const utm = load<{ source: string | null; campaign: string | null }>(`d360.utm.${slug}`, { source: null, campaign: null });

    setSending(true);
    try {
      const order = await api<OrderTracking>(`/public/stores/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        body: {
          type,
          customer: { name: name.trim(), phone },
          address: type === 'DELIVERY' ? { zoneId, street: street.trim(), number: number.trim(), complement: complement.trim() || undefined } : undefined,
          items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, optionIds: i.optionIds, notes: i.notes || undefined })),
          paymentMethod: method,
          changeForCents,
          utmSource: utm.source ?? undefined,
          utmCampaign: utm.campaign ?? undefined,
        },
      });
      rememberOrder(slug, order);
      onCart([]);
      router.push(`/pedido/${order.trackingCode}`);
    } catch (e) {
      setError((e as ApiError).message);
      setSending(false);
    }
  }

  return (
    <Sheet
      title="Seu pedido"
      onClose={onClose}
      footer={
        <button className="btn-primary flex w-full justify-between py-3" disabled={sending || belowMin} onClick={submit}>
          <span>{sending ? 'Enviando...' : belowMin ? `Mínimo ${formatBRL(store.minOrderCents)}` : 'Fazer pedido'}</span>
          <span>{formatBRL(total)}</span>
        </button>
      }
    >
      {warnings.length > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <p className="font-semibold">Mudou desde o seu último pedido:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mb-4 divide-y divide-zinc-100">
        {cart.map((i) => (
          <li key={i.key} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{i.name}</p>
              {i.optionNames.length > 0 && <p className="text-xs text-zinc-500">{i.optionNames.join(', ')}</p>}
              {i.notes && <p className="text-xs text-zinc-500">Obs.: {i.notes}</p>}
              <div className="mt-1 flex items-center gap-2">
                <button className="h-6 w-6 rounded border border-zinc-300" onClick={() => setQty(i.key, i.quantity - 1)} aria-label="Diminuir">
                  −
                </button>
                <span>{i.quantity}</span>
                <button className="h-6 w-6 rounded border border-zinc-300" onClick={() => setQty(i.key, i.quantity + 1)} aria-label="Aumentar">
                  +
                </button>
              </div>
            </div>
            <span className="shrink-0">{formatBRL(i.unitPriceCents * i.quantity)}</span>
          </li>
        ))}
      </ul>

      {store.acceptsDelivery && store.acceptsPickup && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(['DELIVERY', 'PICKUP'] as const).map((t) => (
            <button key={t} className={type === t ? 'btn-primary' : 'btn-ghost'} onClick={() => setType(t)}>
              {t === 'DELIVERY' ? 'Entrega' : 'Retirar na loja'}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="c-name">Nome</label>
          <input id="c-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="c-phone">Telefone (WhatsApp)</label>
          <input id="c-phone" className="input" type="tel" autoComplete="tel" placeholder="(11) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        {type === 'DELIVERY' && (
          <>
            <div>
              <label className="label" htmlFor="c-zone">Bairro</label>
              <select id="c-zone" className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">Selecione</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.feeCents === 0 ? 'grátis' : formatBRL(z.feeCents)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div>
                <label className="label" htmlFor="c-street">Rua</label>
                <input id="c-street" className="input" autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="c-number">Número</label>
                <input id="c-number" className="input" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="c-comp">Complemento (opcional)</label>
              <input id="c-comp" className="input" value={complement} onChange={(e) => setComplement(e.target.value)} />
            </div>
          </>
        )}

        <div>
          <span className="label">Pagamento</span>
          <div className="space-y-1">
            {methods.map((m) => (
              <label key={m} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                <input type="radio" name="pay" checked={method === m} onChange={() => setMethod(m)} className="accent-[var(--brand)]" />
                {PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>
        </div>
        {method === 'CASH_ON_DELIVERY' && (
          <div>
            <label className="label" htmlFor="c-change">Troco para (opcional)</label>
            <input id="c-change" className="input" inputMode="decimal" placeholder="Ex.: 100,00" value={change} onChange={(e) => setChange(e.target.value)} />
          </div>
        )}

        <dl className="space-y-1 border-t border-zinc-200 pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(subtotal)}</dd></div>
          {type === 'DELIVERY' && <div className="flex justify-between"><dt>Entrega</dt><dd>{zoneId ? formatBRL(fee) : '—'}</dd></div>}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatBRL(total)}</dd></div>
          {savings > 0 && <div className="flex justify-between text-emerald-700"><dt>Você economizou com as promoções</dt><dd>{formatBRL(savings)}</dd></div>}
        </dl>
        <ErrorBox message={error} />
      </div>
    </Sheet>
  );
}
