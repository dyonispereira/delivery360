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
  type OrderQuote,
  type OrderTracking,
  type PaymentMethod,
  type PublicBanner,
  type PublicCoupon,
  type PublicOffer,
  type PublicProduct,
  type PublicLoyalty,
  type PublicStore,
} from '@delivery360/shared';
import { LoyaltyCard, LoyaltyCheckout } from '@/components/loyalty';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { CardFields, cardError, cardPayload, emptyCard, type CardState } from '@/components/card-form';

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
const couponKey = (slug: string) => `d360.coupon.${slug}`;
/** Indique e Ganhe: código de quem indicou, guardado até o primeiro pedido. */
const referralKey = (slug: string) => `d360.ref.${slug}`;
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
  const [coupon, setCoupon] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<PublicLoyalty | null>(null);
  const [referral, setReferral] = useState<string | null>(null);

  useEffect(() => {
    setCoupon(load<string | null>(couponKey(slug), null));
    const ref = new URLSearchParams(window.location.search).get('indicacao')?.trim().toUpperCase();
    if (ref) save(referralKey(slug), ref);
    setReferral(ref || load<string | null>(referralKey(slug), null));
    const phone = load<{ phone?: string }>(customerKey, {}).phone?.replace(/\D/g, '') ?? '';
    api<PublicLoyalty>(`/public/stores/${encodeURIComponent(slug)}/fidelidade${phone.length >= 10 ? `?telefone=${phone}` : ''}`)
      .then(setLoyalty)
      .catch(() => setLoyalty(null));
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

  const chooseCoupon = (code: string | null) => {
    setCoupon(code);
    save(couponKey(slug), code);
  };
  /** Cupom tocado na faixa da loja: fica guardado e entra sozinho no carrinho. */
  const pickCoupon = (code: string) => {
    chooseCoupon(code);
    if (cart.length) setCheckout(true);
    else setToast(`Cupom ${code} guardado. Ele entra no carrinho.`);
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
  const offerFor = (id: string) => data.offers.find((o) => o.productIds.includes(id));
  const combos = data.categories.flatMap((c) => c.products).filter((p) => p.isCombo && p.available);
  const storeWide = data.offers.filter((o) => o.productIds.length === 0);

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

          {loyalty?.program && <LoyaltyCard data={loyalty} referral={referral} />}

          <div className="px-4 pt-4">
            <label className="sr-only" htmlFor="busca">Buscar no cardápio</label>
            <input id="busca" className="input py-3" type="search" placeholder="Buscar no cardápio" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {!q && data.banners.some((b) => !b.fullArt) && <BannerCarousel banners={data.banners.filter((b) => !b.fullArt)} onPick={pickCoupon} />}
          {!q &&
            data.banners
              .filter((b) => b.fullArt)
              .map((b) => (
                <section key={b.id} className="px-4 pt-4" aria-label={b.title}>
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded-2xl"
                    onClick={() => b.couponCode && pickCoupon(b.couponCode)}
                    aria-label={b.couponCode ? `${b.title}: usar cupom ${b.couponCode}` : b.title}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.imageUrl} alt={b.title} className="block h-auto w-full" />
                  </button>
                </section>
              ))}

          {!q && storeWide.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900" role="note">
              <p className="font-bold">Desconto especial hoje</p>
              <p>
                {storeWide.map((o) => o.label).join(' · ')}. Já sai no carrinho, sem código.
              </p>
            </div>
          )}

          {!q && data.coupons.length > 0 && <CouponStrip coupons={data.coupons} applied={coupon} onPick={pickCoupon} />}

          {!q && combos.length > 0 && (
            <section className="pt-5" aria-label="Combos">
              <h2 className="mb-2 px-4 text-lg font-bold">Combos</h2>
              <div className="flex gap-3 overflow-x-auto px-4 pb-1">
                {combos.map((p) => (
                  <button key={p.id} className="w-60 shrink-0 overflow-hidden rounded-2xl border border-zinc-200 text-left" onClick={() => setSelected(p)} disabled={!canOrder}>
                    <ComboCover product={p} lookup={(id) => products.get(id)} />
                    <div className="space-y-1 p-3">
                      <p className="line-clamp-1 font-semibold">{p.name}</p>
                      <p className="line-clamp-1 text-xs text-zinc-500">{p.optionGroups.map((g) => g.name).join(' + ')}</p>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{formatBRL(p.priceCents)}</span>
                        {p.comboSeparateCents != null && <span className="text-xs text-zinc-400 line-through">{formatBRL(p.comboSeparateCents)}</span>}
                        {p.comboSeparateCents != null && (
                          <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs font-bold text-white">−{discountPct(p.comboSeparateCents, p.priceCents)}%</span>
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

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
                              <ComboSaving product={p} />
                              <OfferTag offer={offerFor(p.id)} />
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
          lookup={(id) => products.get(id)}
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
          coupon={coupon}
          onCoupon={chooseCoupon}
          loyalty={loyalty?.program ?? null}
          referral={referral}
          onOrdered={() => {
            // Já é cliente: a indicação não vale mais.
            setReferral(null);
            save(referralKey(slug), null);
          }}
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

/** Desconto especial automático deste produto (o carrinho já desconta). */
function OfferTag({ offer }: { offer: PublicOffer | undefined }) {
  if (!offer) return null;
  return <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs font-bold text-white">{offer.label.replace(/ em .*/, '')} no carrinho</span>;
}

/** Combo: preço dos itens separados, riscado, e quanto o cliente economiza. */
function ComboSaving({ product }: { product: PublicProduct }) {
  if (!product.isCombo) return null;
  const separate = product.comboSeparateCents;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-amber-950">Combo</span>
      {separate != null && (
        <span className="text-xs text-zinc-500">
          separado <span className="line-through">{formatBRL(separate)}</span>
          <span className="ml-1 font-semibold text-emerald-700">economize {formatBRL(separate - product.priceCents)}</span>
        </span>
      )}
    </span>
  );
}

/** Combo sem foto: mostra lado a lado a foto do primeiro produto de cada etapa. */
function ComboCover({ product, lookup }: { product: PublicProduct; lookup: (id: string) => PublicProduct | undefined }) {
  const pics = product.imageUrl
    ? []
    : product.optionGroups
        .map((g) => g.options.map((o) => (o.productId ? lookup(o.productId)?.imageUrl : null)).find(Boolean))
        .filter((u): u is string => !!u)
        .slice(0, 3);
  if (pics.length < 2) return <ProductImage product={product} className="aspect-[16/9] w-full" />;
  return (
    <div className="flex aspect-[16/9] w-full items-center justify-center gap-1 bg-zinc-50" aria-hidden>
      {pics.map((u, i) => (
        <span key={u} className="flex items-center gap-1">
          {i > 0 && <span className="text-lg font-bold text-zinc-400">+</span>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" className="h-20 w-16 rounded-xl object-cover" />
        </span>
      ))}
    </div>
  );
}

function ComboThumb({ product }: { product: PublicProduct | undefined }) {
  if (!product?.imageUrl) return <span className="h-10 w-10 shrink-0 rounded-lg bg-zinc-100" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={product.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />;
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

/** Etapa de combo que já vem inteira (ex.: "Inclui: batata e refri"): não tem o que escolher. */
const isFixed = (g: PublicProduct['optionGroups'][number]) => g.minSelect > 0 && g.minSelect >= g.options.length;

function ProductModal({
  product,
  onClose,
  onAdd,
  lookup,
}: {
  product: PublicProduct;
  onClose: () => void;
  onAdd: (i: CartItem) => void;
  lookup?: (id: string) => PublicProduct | undefined;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(product.optionGroups.filter(isFixed).map((g) => [g.id, g.options.map((o) => o.id)])),
  );
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
        <ComboSaving product={product} />
        {product.promoEndsAt && <span className="text-xs text-zinc-500">{untilLabel(product.promoEndsAt)}</span>}
      </p>
      {product.description && <p className="mb-4 text-sm text-zinc-600">{product.description}</p>}

      {product.optionGroups.map((g) => {
        if (isFixed(g)) {
          return (
            <div key={g.id} className="-mx-4 mb-4">
              <p className="bg-zinc-100 px-4 py-2.5 font-semibold">{g.name}</p>
              <ul>
                {g.options.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2.5 text-sm">
                    <ComboThumb product={o.productId ? lookup?.(o.productId) : undefined} />
                    <span className="flex-1 font-medium">{o.name}</span>
                    <span className="text-xs font-semibold text-emerald-700">{o.available ? 'Incluso' : 'Esgotado'}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
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
                  {o.productId && <ComboThumb product={lookup?.(o.productId)} />}
                  <span className="flex-1">
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
  coupon,
  onCoupon,
  loyalty,
  referral,
  onOrdered,
  onCart,
  onClose,
}: {
  slug: string;
  data: PublicStore;
  cart: CartItem[];
  warnings: string[];
  coupon: string | null;
  onCoupon: (code: string | null) => void;
  loyalty: PublicLoyalty['program'];
  referral: string | null;
  onOrdered: () => void;
  onCart: (c: CartItem[]) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { store, zones } = data;
  const saved = useMemo(() => load(customerKey, { name: '', phone: '', street: '', number: '', complement: '', zoneId: '', document: '' }), []);
  const [type, setType] = useState<'DELIVERY' | 'PICKUP'>(store.acceptsDelivery ? 'DELIVERY' : 'PICKUP');
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [zoneId, setZoneId] = useState(zones.some((z) => z.id === saved.zoneId) ? saved.zoneId : '');
  const [street, setStreet] = useState(saved.street);
  const [number, setNumber] = useState(saved.number);
  const [complement, setComplement] = useState(saved.complement);
  const [doc, setDoc] = useState(saved.document ?? '');
  const methods = store.paymentMethods;
  const [method, setMethod] = useState<PaymentMethod | ''>(methods[0] ?? '');
  const [change, setChange] = useState('');
  // Cartão: só em memória, nunca salvo no navegador.
  const [cardData, setCardData] = useState<CardState>(() => emptyCard(saved.number));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const subtotal = cart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const listOf = new Map(data.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)));
  const savings = cart.reduce((s, i) => {
    const p = listOf.get(i.productId);
    return s + (p?.listPriceCents != null ? (p.listPriceCents - p.priceCents) * i.quantity : 0);
  }, 0);
  const fee = type === 'DELIVERY' ? (zones.find((z) => z.id === zoneId)?.feeCents ?? 0) : 0;

  // Cupom: quem calcula é o servidor. Recalcula quando muda o carrinho, a entrega, o bairro ou o telefone.
  const [couponInput, setCouponInput] = useState('');
  const [couponOpen, setCouponOpen] = useState(false);
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const phoneOk = phone.replace(/\D/g, '').length >= 10 ? phone : '';
  const cartSig = JSON.stringify(cart.map((i) => [i.productId, i.quantity, i.optionIds]));
  // Com cupom ou com desconto especial na loja, quem calcula a conta é o servidor.
  const needsQuote = !!coupon || data.offers.length > 0 || !!loyalty;
  useEffect(() => {
    if (!needsQuote) {
      setQuote(null);
      setCouponError(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const ask = (couponCode: string | null) =>
      api<OrderQuote>(`/public/stores/${encodeURIComponent(slug)}/quote`, {
        method: 'POST',
        body: {
          type,
          zoneId: type === 'DELIVERY' && zoneId ? zoneId : undefined,
          items: JSON.parse(cartSig).map(([productId, quantity, optionIds]: [string, number, string[]]) => ({ productId, quantity, optionIds })),
          paymentMethod: method || undefined,
          phone: phoneOk || undefined,
          couponCode: couponCode ?? undefined,
          rewardId: rewardId ?? undefined,
          referralCode: referral ?? undefined,
        },
      });
    const t = setTimeout(async () => {
      try {
        const q = await ask(coupon);
        if (!alive) return;
        setQuote(q);
        setCouponError(null);
        if (rewardId) setRewardError(null);
      } catch (e) {
        if (!alive) return;
        // Prêmio recusado (falta ponto, produto fora do carrinho...): mostra o motivo e tira a escolha.
        if (rewardId) {
          setRewardError((e as ApiError).message);
          setRewardId(null);
          return;
        }
        setCouponError(coupon ? (e as ApiError).message : null);
        // Cupom recusado: o desconto especial continua valendo sem ele.
        const q = coupon ? await ask(null).catch(() => null) : null;
        if (alive) setQuote(q);
      } finally {
        if (alive) setChecking(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [needsQuote, coupon, type, zoneId, phoneOk, method, cartSig, slug, rewardId, referral]);

  const discount = quote?.coupon ? quote.discountCents : 0;
  const special = quote?.platformDiscountCents ?? 0;
  const fid = quote?.loyalty;
  const total = subtotal + fee - discount - special - (fid?.totalCents ?? 0);
  const applyCoupon = (code: string) => {
    const c = code.trim().toUpperCase();
    if (c) onCoupon(c);
  };
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
    const needsDoc = (method === 'PIX' || method === 'CREDIT_CARD') && !!store.pixNeedsDocument;
    if (needsDoc && ![11, 14].includes(doc.replace(/\D/g, '').length)) return setError(`Informe seu CPF para pagar com ${method === 'PIX' ? 'Pix' : 'cartão'}.`);
    if (method === 'CREDIT_CARD') {
      const bad = cardError(cardData);
      if (bad) return setError(bad);
    }
    let changeForCents: number | undefined;
    if (method === 'CASH_ON_DELIVERY' && change.trim()) {
      const c = parseBRL(change);
      if (c === null || c < total) return setError(`O troco precisa ser para um valor de pelo menos ${formatBRL(total)}.`);
      changeForCents = c;
    }
    save(customerKey, { name, phone, street, number, complement, zoneId, document: doc });
    const utm = load<{ source: string | null; campaign: string | null }>(`d360.utm.${slug}`, { source: null, campaign: null });

    setSending(true);
    try {
      const order = await api<OrderTracking>(`/public/stores/${encodeURIComponent(slug)}/orders`, {
        method: 'POST',
        body: {
          type,
          customer: { name: name.trim(), phone, ...(needsDoc ? { document: doc } : {}) },
          address: type === 'DELIVERY' ? { zoneId, street: street.trim(), number: number.trim(), complement: complement.trim() || undefined } : undefined,
          items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, optionIds: i.optionIds, notes: i.notes || undefined })),
          paymentMethod: method,
          changeForCents,
          couponCode: quote?.coupon ? coupon : undefined,
          rewardId: fid?.reward ? rewardId : undefined,
          referralCode: referral ?? undefined,
          utmSource: utm.source ?? undefined,
          utmCampaign: utm.campaign ?? undefined,
        },
      });
      rememberOrder(slug, order);
      if (order.couponCode) onCoupon(null);
      onOrdered();
      onCart([]);
      let cardFailure = '';
      if (method === 'CREDIT_CARD' && order.payment?.cardForm) {
        // Checkout transparente: paga o cartão logo depois de criar o pedido, sem sair da loja.
        try {
          await api<OrderTracking>(`/public/orders/${encodeURIComponent(order.trackingCode)}/pay-card`, {
            method: 'POST',
            body: cardPayload(cardData, needsDoc ? doc : undefined),
          });
        } catch (e) {
          cardFailure = (e as ApiError).message;
        }
      }
      router.push(`/pedido/${order.trackingCode}${cardFailure ? `?cartao=${encodeURIComponent(cardFailure)}` : ''}`);
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
        {(method === 'PIX' || method === 'CREDIT_CARD') && store.pixNeedsDocument && (
          <div>
            <label className="label" htmlFor="c-doc">{method === 'PIX' ? 'CPF (o banco exige no Pix)' : 'CPF do titular do cartão'}</label>
            <input id="c-doc" className="input" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
        )}
        {method === 'CREDIT_CARD' && <CardFields value={cardData} onChange={setCardData} idPrefix="checkout-card" />}
        {method === 'CASH_ON_DELIVERY' && (
          <div>
            <label className="label" htmlFor="c-change">Troco para (opcional)</label>
            <input id="c-change" className="input" inputMode="decimal" placeholder="Ex.: 100,00" value={change} onChange={(e) => setChange(e.target.value)} />
          </div>
        )}

        <Upsell data={data} cart={cart} onAdd={(i) => onCart([...cart, i])} />

        {loyalty && (
          <LoyaltyCheckout
            program={loyalty}
            quote={fid}
            phoneOk={!!phoneOk}
            rewardId={rewardId}
            onReward={(id) => {
              setRewardError(null);
              setRewardId(id);
            }}
            error={rewardError}
          />
        )}

        <CouponField
          applied={coupon}
          quote={quote}
          error={couponError}
          checking={checking}
          open={couponOpen}
          onOpen={() => setCouponOpen(true)}
          input={couponInput}
          onInput={setCouponInput}
          onApply={applyCoupon}
          onRemove={() => {
            onCoupon(null);
            setCouponInput('');
          }}
          suggestions={data.coupons}
        />

        <dl className="space-y-1 border-t border-zinc-200 pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(subtotal)}</dd></div>
          {type === 'DELIVERY' && <div className="flex justify-between"><dt>Entrega</dt><dd>{zoneId ? formatBRL(fee) : '—'}</dd></div>}
          {discount > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Cupom {quote!.coupon!.code}</dt><dd>−{formatBRL(discount)}</dd></div>
          )}
          {special > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Desconto especial</dt><dd>−{formatBRL(special)}</dd></div>
          )}
          {fid && fid.clubDiscountCents > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Clube {fid.level?.name}</dt><dd>−{formatBRL(fid.clubDiscountCents)}</dd></div>
          )}
          {fid && fid.referralDiscountCents > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Indicação de amigo</dt><dd>−{formatBRL(fid.referralDiscountCents)}</dd></div>
          )}
          {fid?.reward && (
            <div className="flex justify-between text-emerald-700"><dt>Prêmio: {fid.reward.name} ({fid.reward.points} pts)</dt><dd>−{formatBRL(fid.reward.discountCents)}</dd></div>
          )}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatBRL(total)}</dd></div>
          {savings > 0 && <div className="flex justify-between text-emerald-700"><dt>Você economizou com as promoções</dt><dd>{formatBRL(savings)}</dd></div>}
        </dl>
        <ErrorBox message={error} />
      </div>
    </Sheet>
  );
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Regras do cupom em poucas palavras, para o cliente não se frustrar no carrinho. */
function couponFinePrint(c: PublicCoupon) {
  const parts: string[] = [];
  if (c.firstOrderOnly) parts.push('Primeiro pedido');
  if (c.weekdays.length && c.weekdays.length < 7) parts.push(`Só ${c.weekdays.map((d) => WEEKDAY_SHORT[d]).join(', ')}`);
  if (c.endsAt) parts.push(`Até ${new Date(c.endsAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`);
  return parts.join(' · ');
}

/** Faixa de cupons no topo da loja, com cara de ticket. */
/** Banners das campanhas (criados pela Delivery360). Passa sozinho; o que tem cupom aplica ao tocar. */
function BannerCarousel({ banners, onPick }: { banners: PublicBanner[]; onPick: (code: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => {
      const el = ref.current;
      if (!el || el.matches(':hover')) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  return (
    <section className="px-4 pt-4" aria-label="Campanhas">
      <div
        ref={ref}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none]"
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      >
        {banners.map((b) => (
          <button
            key={b.id}
            type="button"
            className="relative aspect-[16/7] w-full shrink-0 snap-start overflow-hidden text-left"
            onClick={() => b.couponCode && onPick(b.couponCode)}
            aria-label={b.couponCode ? `${b.title}: usar cupom ${b.couponCode}` : b.title}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
            <span className="relative flex h-full max-w-[70%] flex-col justify-end gap-1 p-4 text-white">
              <span className="text-lg font-bold leading-tight">{b.title}</span>
              {b.subtitle && <span className="text-sm text-white/90">{b.subtitle}</span>}
              {b.couponCode && <span className="mt-1 w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-900">Usar cupom {b.couponCode}</span>}
            </span>
          </button>
        ))}
      </div>
      {banners.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {banners.map((b, i) => (
            <span key={b.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-[var(--brand)]' : 'w-1.5 bg-zinc-300'}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function CouponStrip({ coupons, applied, onPick }: { coupons: PublicCoupon[]; applied: string | null; onPick: (code: string) => void }) {
  return (
    <section className="pt-5" aria-label="Cupons">
      <h2 className="mb-2 px-4 text-lg font-bold">Cupons para você</h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1">
        {coupons.map((c) => {
          const on = applied === c.code;
          const fine = couponFinePrint(c);
          return (
            <div key={c.code} className="relative flex w-64 shrink-0 overflow-hidden rounded-2xl border border-[var(--brand)]/30 bg-[var(--brand)]/5">
              <div className="flex w-14 shrink-0 items-center justify-center bg-[var(--brand)] text-2xl text-white" aria-hidden>
                {c.type === 'FREE_DELIVERY' ? '🛵' : '%'}
              </div>
              <div className="min-w-0 flex-1 border-l-2 border-dashed border-white p-3">
                <p className="text-sm font-bold leading-tight">{c.label}</p>
                {(c.description || fine) && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600">{c.description || fine}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tracking-wide text-[var(--brand)]">{c.code}</span>
                  <button
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? 'bg-emerald-600 text-white' : 'bg-[var(--brand)] text-white'}`}
                    onClick={() => onPick(c.code)}
                    aria-pressed={on}
                  >
                    {on ? 'Ativado ✓' : 'Usar'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CouponField({
  applied,
  quote,
  error,
  checking,
  open,
  onOpen,
  input,
  onInput,
  onApply,
  onRemove,
  suggestions,
}: {
  applied: string | null;
  quote: OrderQuote | null;
  error: string | null;
  checking: boolean;
  open: boolean;
  onOpen: () => void;
  input: string;
  onInput: (v: string) => void;
  onApply: (code: string) => void;
  onRemove: () => void;
  suggestions: PublicCoupon[];
}) {
  if (applied) {
    const ok = quote?.coupon;
    return (
      <div className={`rounded-xl border p-3 text-sm ${error ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`} role="status">
        <div className="flex items-center gap-2">
          <span aria-hidden>🎟️</span>
          <span className="font-mono font-semibold">{applied}</span>
          <span className="flex-1 text-zinc-600">
            {checking ? 'Conferindo...' : ok ? ok.label : ''}
          </span>
          <button className="text-xs font-medium text-zinc-600 underline" onClick={onRemove}>
            Remover
          </button>
        </div>
        {!checking && error && <p className="mt-1 text-amber-900">{error}</p>}
        {!checking && ok && ok.discountCents > 0 && <p className="mt-1 font-medium text-emerald-800">Você ganhou {formatBRL(ok.discountCents)} de desconto.</p>}
        {!checking && ok?.promoExcluded && <p className="mt-0.5 text-xs text-zinc-600">Os itens que já estão em promoção ficam fora deste cupom.</p>}
        {!checking && ok && quote.zonePending && <p className="mt-1 text-emerald-800">Escolha o bairro para ver o desconto na entrega.</p>}
      </div>
    );
  }
  if (!open) {
    return (
      <button className="flex w-full items-center gap-2 rounded-xl border border-dashed border-zinc-300 p-3 text-left text-sm font-medium" onClick={onOpen}>
        <span aria-hidden>🎟️</span>
        <span className="flex-1">Tem um cupom?</span>
        {suggestions.length > 0 && <span className="text-xs text-[var(--brand)]">{suggestions.length === 1 ? '1 disponível' : `${suggestions.length} disponíveis`}</span>}
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(input);
        }}
      >
        <label className="sr-only" htmlFor="c-coupon">Código do cupom</label>
        <input
          id="c-coupon"
          className="input flex-1 font-mono uppercase"
          placeholder="Código do cupom"
          autoFocus
          value={input}
          onChange={(e) => onInput(e.target.value.replace(/\s/g, '').toUpperCase())}
        />
        <button className="btn-primary px-4" disabled={!input.trim()}>
          Aplicar
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((c) => (
            <button key={c.code} className="rounded-full border border-[var(--brand)]/40 px-2.5 py-1 text-xs" onClick={() => onApply(c.code)}>
              <span className="font-mono font-semibold text-[var(--brand)]">{c.code}</span> · {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Peça também": até 3 itens que ainda não estão no carrinho, os que mais dão lucro primeiro. */
function Upsell({ data, cart, onAdd }: { data: PublicStore; cart: CartItem[]; onAdd: (i: CartItem) => void }) {
  const products = new Map(data.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)));
  const inCart = new Set(cart.map((i) => i.productId));
  const picks = data.upsellProductIds
    .filter((id) => !inCart.has(id))
    .map((id) => products.get(id))
    .filter((p): p is PublicProduct => !!p && p.available)
    .slice(0, 3);
  if (!picks.length) return null;
  return (
    <section aria-label="Peça também">
      <h3 className="mb-2 font-semibold">Peça também</h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {picks.map((p) => (
          <div key={p.id} className="flex w-44 shrink-0 items-center gap-2 rounded-xl border border-zinc-200 p-2">
            <ProductImage product={p} className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs font-medium leading-tight">{p.name}</p>
              <Price product={p} className="text-xs" />
            </div>
            <button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)] text-lg font-semibold text-white"
              aria-label={`Adicionar ${p.name}`}
              onClick={() =>
                onAdd({ key: newKey(), productId: p.id, name: p.name, quantity: 1, unitPriceCents: p.priceCents, optionIds: [], optionNames: [], notes: '' })
              }
            >
              +
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
