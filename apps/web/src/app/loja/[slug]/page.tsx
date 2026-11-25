'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatBRL,
  parseBRL,
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

const cartKey = (slug: string) => `d360.cart.${slug}`;
const customerKey = 'd360.customer';

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

export default function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<PublicStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [checkout, setCheckout] = useState(false);

  useEffect(() => {
    api<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.status === 404 ? 'Loja não encontrada.' : e.message));
    setCart(load<CartItem[]>(cartKey(slug), []));
    // Guarda a origem do clique (anúncio, Instagram...) para o módulo de Tráfego medir o resultado.
    const search = new URLSearchParams(window.location.search);
    const utm = { source: search.get('utm_source'), campaign: search.get('utm_campaign') };
    if (utm.source || utm.campaign) save(`d360.utm.${slug}`, utm);
  }, [slug]);

  const updateCart = (next: CartItem[]) => {
    setCart(next);
    save(cartKey(slug), next);
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

  return (
    <main className="mx-auto max-w-2xl pb-28">
      <header className="border-b border-zinc-200 bg-white px-4 py-5">
        <div className="flex items-center gap-3">
          {store.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logoUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] text-xl font-bold text-white">
              {store.displayName.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{store.displayName}</h1>
            <p className="text-sm text-zinc-500">
              {store.isOpen ? (
                <span className="font-medium text-emerald-700">Aberto agora</span>
              ) : (
                <span className="font-medium text-red-600">Fechado no momento</span>
              )}
              {' · '}
              {store.estimatedMinutes} min
              {store.minOrderCents > 0 && <> · Pedido mínimo {formatBRL(store.minOrderCents)}</>}
            </p>
          </div>
        </div>
        {store.description && <p className="mt-3 text-sm text-zinc-600">{store.description}</p>}
      </header>

      {data.categories.length > 1 && (
        <nav className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur">
          {data.categories.map((c) => (
            <a key={c.id} href={`#cat-${c.id}`} className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-sm hover:bg-zinc-200">
              {c.name}
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-6 px-4 py-4">
        {data.categories.length === 0 && <p className="text-sm text-zinc-500">O cardápio ainda está sendo montado.</p>}
        {data.categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-14">
            <h2 className="mb-2 text-lg font-semibold">{c.name}</h2>
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {c.products.map((p) => (
                <button
                  key={p.id}
                  disabled={!p.available || !store.isOpen}
                  onClick={() => setSelected(p)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{p.description}</p>}
                    <p className="mt-1 text-sm font-semibold">
                      {p.available ? formatBRL(p.priceCents) : 'Indisponível'}
                    </p>
                  </div>
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {count > 0 && !checkout && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white p-3">
          <button className="btn-primary mx-auto flex w-full max-w-2xl justify-between py-3" onClick={() => setCheckout(true)}>
            <span>Ver carrinho ({count})</span>
            <span>{formatBRL(subtotal)}</span>
          </button>
        </div>
      )}

      {selected && (
        <ProductModal
          product={selected}
          onClose={() => setSelected(null)}
          onAdd={(item) => {
            updateCart([...cart, item]);
            setSelected(null);
          }}
        />
      )}

      {checkout && (
        <Checkout slug={slug} data={data} cart={cart} onCart={updateCart} onClose={() => setCheckout(false)} />
      )}
    </main>
  );
}

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
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
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-zinc-300">
            <button className="px-3 py-2" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Diminuir">
              −
            </button>
            <span className="w-6 text-center text-sm font-medium">{quantity}</span>
            <button className="px-3 py-2" onClick={() => setQuantity((q) => Math.min(50, q + 1))} aria-label="Aumentar">
              +
            </button>
          </div>
          <button
            className="btn-primary flex-1 justify-between"
            disabled={!!missing}
            onClick={() =>
              onAdd({
                key: `${Date.now()}-${Math.random()}`,
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
      {product.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt="" className="mb-3 h-48 w-full rounded-lg object-cover" />
      )}
      {product.description && <p className="mb-3 text-sm text-zinc-600">{product.description}</p>}
      <p className="mb-4 font-semibold">{formatBRL(product.priceCents)}</p>

      {product.optionGroups.map((g) => {
        const cur = picked[g.id] ?? [];
        return (
          <fieldset key={g.id} className="mb-4">
            <legend className="mb-1 flex w-full items-center justify-between bg-zinc-100 px-3 py-2 text-sm">
              <span className="font-medium">{g.name}</span>
              <span className="text-xs text-zinc-500">
                {g.minSelect > 0 ? 'Obrigatório · ' : ''}
                {g.maxSelect === 1 ? 'escolha 1' : `até ${g.maxSelect}`}
              </span>
            </legend>
            {g.options.map((o) => (
              <label key={o.id} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${o.available ? '' : 'opacity-50'}`}>
                <span>
                  {o.name}
                  {o.priceCents > 0 && <span className="text-zinc-500"> + {formatBRL(o.priceCents)}</span>}
                </span>
                <input
                  type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                  name={g.id}
                  disabled={!o.available || (!cur.includes(o.id) && g.maxSelect > 1 && cur.length >= g.maxSelect)}
                  checked={cur.includes(o.id)}
                  onChange={() => toggle(g.id, o.id, g.maxSelect)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
              </label>
            ))}
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
  onCart,
  onClose,
}: {
  slug: string;
  data: PublicStore;
  cart: CartItem[];
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
        </dl>
        <ErrorBox message={error} />
      </div>
    </Sheet>
  );
}
