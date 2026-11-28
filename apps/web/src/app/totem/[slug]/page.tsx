'use client';

/**
 * Totem de autoatendimento.
 *
 * Usa o cardápio público da loja (fotos, preços, adicionais e disponibilidade). Nada fica guardado no
 * aparelho; ao finalizar, cancelar ou ficar parado, a sessão é apagada e o próximo cliente começa do zero.
 *
 * - Modo real: /totem/<slug>?t=<id do totem> (cadastro em PDV > Totens). Cria o pedido "aguardando
 *   pagamento" e mostra a senha; o cliente paga no caixa e o caixa confirma no PDV (sem maquininha integrada).
 *   Comer aqui/levar vem do cadastro do totem. O envio usa uma chave por pedido: repetir não duplica.
 * - Modo demonstração: /totem/<slug> sem ?t. Não cria pedido nem cobra; pagamento simulado na tela.
 *   Opções: ?consumo=aqui | levar | ambos (padrão)   ?observacao=nao (esconde o campo de observação)
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cartTotals,
  consumptionModes,
  demoTicket,
  formatBRL,
  lineTotal,
  optionNames,
  selectionErrors,
  setQuantity,
  toggleOption,
  unitPrice,
  upsertLine,
  TOTEM_CONSUMPTION_LABELS,
  TOTEM_DONE_RETURN_S,
  TOTEM_IDLE_GRACE_S,
  TOTEM_IDLE_WARN_MS,
  TOTEM_ORIGIN_LABEL,
  TOTEM_PAY_HINT_LABELS,
  TOTEM_PAY_LABELS,
  type PublicProduct,
  type PublicTotem,
  type TotemOrderResult,
  type TotemPayHint,
  type PublicStore,
  type TotemConsumption,
  type TotemLine,
  type TotemPayMethod,
} from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';

type Step = 'welcome' | 'consumption' | 'menu' | 'cart' | 'payment' | 'done';
type PayState = { method: TotemPayMethod | null; status: 'choose' | 'pending' | 'failed' };

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const PAY_IDLE: PayState = { method: null, status: 'choose' };

export default function TotemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<PublicStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modes, setModes] = useState<TotemConsumption[]>(['EAT_IN', 'TAKEAWAY']);
  const [allowNotes, setAllowNotes] = useState(true);
  /** Modo real: o totem cadastrado (vazio = demonstração). */
  const [totem, setTotem] = useState<PublicTotem | null>(null);
  const [placed, setPlaced] = useState<TotemOrderResult | null>(null);

  // Sessão do cliente: só na memória da tela (some ao recomeçar).
  const [step, setStep] = useState<Step>('welcome');
  const [consumption, setConsumption] = useState<TotemConsumption | null>(null);
  const [lines, setLines] = useState<TotemLine[]>([]);
  const [editing, setEditing] = useState<{ product: PublicProduct; line: TotemLine | null } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [pay, setPay] = useState<PayState>(PAY_IDLE);
  const [ticket, setTicket] = useState<string | null>(null);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const [doneLeft, setDoneLeft] = useState(TOTEM_DONE_RETURN_S);
  const lastTouch = useRef(Date.now());
  const paying = useRef(false);
  /** Chave do pedido atual: a mesma em cada nova tentativa de envio, nova a cada cliente. */
  const requestKey = useRef(newKey());

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setModes(consumptionModes(q.get('consumo')));
    setAllowNotes(q.get('observacao') !== 'nao');
    const totemId = q.get('t');
    const s = encodeURIComponent(slug);
    Promise.all([
      api<PublicStore>(`/public/stores/${s}`),
      totemId ? api<PublicTotem>(`/public/stores/${s}/totem/${encodeURIComponent(totemId)}`) : Promise.resolve(null),
    ])
      .then(([store, t]) => {
        setData(store);
        if (t) {
          setTotem(t);
          setModes(t.modes);
        }
      })
      .catch((e: ApiError) => setError(e.status === 404 ? (totemId ? 'Totem não encontrado. Confira o endereço no painel (PDV > Totens).' : 'Loja não encontrada.') : e.message));
  }, [slug]);

  /** Apaga tudo do cliente anterior e volta para a tela de boas-vindas. */
  const reset = useCallback(() => {
    paying.current = false;
    setStep('welcome');
    setConsumption(null);
    setLines([]);
    setEditing(null);
    setCategory(null);
    setPay(PAY_IDLE);
    setTicket(null);
    setPlaced(null);
    requestKey.current = newKey();
    setIdleLeft(null);
    setDoneLeft(TOTEM_DONE_RETURN_S);
  }, []);

  // Inatividade: qualquer toque conta como "continuar".
  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
      setIdleLeft(null);
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  const watchIdle = step !== 'welcome' && step !== 'done' && pay.status !== 'pending';
  useEffect(() => {
    if (!watchIdle) {
      setIdleLeft(null);
      return;
    }
    lastTouch.current = Date.now();
    const timer = setInterval(() => {
      const idle = Date.now() - lastTouch.current;
      if (idle < TOTEM_IDLE_WARN_MS) return;
      const left = TOTEM_IDLE_GRACE_S - Math.floor((idle - TOTEM_IDLE_WARN_MS) / 1000);
      if (left <= 0) reset();
      else setIdleLeft(left);
    }, 500);
    return () => clearInterval(timer);
  }, [watchIdle, reset]);

  // Confirmação: volta sozinha ao início.
  useEffect(() => {
    if (step !== 'done') return;
    const timer = setInterval(() => setDoneLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [step]);
  useEffect(() => {
    if (step === 'done' && doneLeft <= 0) reset();
  }, [step, doneLeft, reset]);

  const categories = useMemo(() => (data?.categories ?? []).filter((c) => c.products.length > 0), [data]);
  const totals = cartTotals(lines);
  const current = categories.find((c) => c.id === category) ?? categories[0];

  const start = () => {
    reset();
    if (modes.length === 1) {
      setConsumption(modes[0]);
      setStep('menu');
    } else setStep('consumption');
  };

  // Pagamento simulado: uma tentativa por vez.
  const startPayment = (method: TotemPayMethod) => {
    if (paying.current) return;
    paying.current = true;
    setPay({ method, status: 'pending' });
  };
  const finishPayment = (ok: boolean) => {
    if (!paying.current) return;
    paying.current = false;
    if (ok) {
      setTicket(demoTicket());
      setLines([]);
      setDoneLeft(TOTEM_DONE_RETURN_S);
      setStep('done');
    } else setPay((p) => ({ ...p, status: 'failed' }));
  };

  /** Modo real: manda o pedido (a API calcula o preço) e mostra a senha. */
  const placeOrder = async (payHint: TotemPayHint) => {
    if (!totem || !consumption) return;
    const r = await api<TotemOrderResult>(`/public/stores/${encodeURIComponent(slug)}/totem/${totem.id}/orders`, {
      method: 'POST',
      body: {
        requestKey: requestKey.current,
        consumption,
        payHint,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes || undefined })),
      },
    });
    setPlaced(r);
    setTicket(r.ticket);
    setLines([]);
    setDoneLeft(TOTEM_DONE_RETURN_S);
    setStep('done');
  };

  if (error) return <Shell><Center><p className="text-3xl font-bold">{error}</p></Center></Shell>;
  if (!data) return <Shell><Center><p className="text-2xl text-zinc-500">Carregando o cardápio...</p></Center></Shell>;
  const store = data.store;
  if (totem && !totem.active) return <Shell><Center><p className="text-4xl font-black">Totem fora de uso</p><p className="mt-4 text-2xl text-zinc-600">Faça o seu pedido no caixa.</p></Center></Shell>;

  return (
    <Shell demo={!totem}>
      {step === 'welcome' && (
        <button
          onClick={start}
          className="relative flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden bg-zinc-950 p-8 text-center text-white"
          style={store.coverUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.8)), url("${store.coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <Logo store={store} size="h-40 w-40 text-6xl" />
          <div>
            <h1 className="text-5xl font-black tracking-tight landscape:text-6xl">{store.displayName}</h1>
            <p className="mt-3 text-2xl text-white/80">Peça aqui, pague e retire com a sua senha.</p>
          </div>
          <span className="rounded-3xl bg-[var(--brand)] px-14 py-7 text-4xl font-black shadow-2xl">Começar pedido</span>
          <span className="text-xl text-white/70">Toque em qualquer lugar da tela</span>
        </button>
      )}

      {step === 'consumption' && (
        <Center>
          <h2 className="text-4xl font-black">Onde você vai comer?</h2>
          <div className="mt-10 grid w-full max-w-3xl gap-6 portrait:grid-cols-1 landscape:grid-cols-2">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setConsumption(m);
                  setStep('menu');
                }}
                className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border-4 border-zinc-900 bg-white p-8 text-4xl font-black active:scale-[.98] active:bg-zinc-100"
              >
                <span className="text-7xl" aria-hidden="true">{m === 'EAT_IN' ? '🍽️' : '🛍️'}</span>
                {TOTEM_CONSUMPTION_LABELS[m]}
              </button>
            ))}
          </div>
          <button onClick={reset} className="mt-10 rounded-2xl px-8 py-5 text-2xl font-bold text-zinc-600 underline">
            Cancelar
          </button>
        </Center>
      )}

      {step === 'menu' && (
        <>
          <TopBar store={store} consumption={consumption} onCancel={reset} />
          <div className="flex min-h-0 flex-1 portrait:flex-col landscape:flex-row">
            <nav className="flex shrink-0 gap-3 overflow-auto bg-zinc-100 p-3 portrait:flex-row landscape:w-60 landscape:flex-col">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`shrink-0 rounded-2xl px-6 py-4 text-left text-2xl font-bold ${c.id === current?.id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
                >
                  {c.name}
                </button>
              ))}
            </nav>
            <main className="min-h-0 flex-1 overflow-auto p-4">
              <h2 className="mb-4 text-3xl font-black">{current?.name}</h2>
              <div className="grid grid-cols-2 gap-4 landscape:grid-cols-3">
                {current?.products.map((p) => (
                  <ProductCard key={p.id} product={p} onPick={() => setEditing({ product: p, line: null })} />
                ))}
              </div>
            </main>
            <aside className="hidden w-96 shrink-0 flex-col border-l-2 border-zinc-200 bg-zinc-50 landscape:flex">
              <h2 className="p-4 text-2xl font-black">Seu pedido</h2>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4">
                {lines.length === 0 && <p className="text-xl text-zinc-500">Toque em um produto para adicionar.</p>}
                {lines.map((l) => (
                  <div key={l.key} className="flex justify-between gap-2 rounded-xl bg-white p-3 text-lg">
                    <span><b>{l.quantity}x</b> {l.name}</span>
                    <b className="whitespace-nowrap">{formatBRL(lineTotal(l))}</b>
                  </div>
                ))}
              </div>
              <CartButton items={totals.items} totalCents={totals.totalCents} onClick={() => setStep('cart')} />
            </aside>
          </div>
          <div className="landscape:hidden">
            <CartButton items={totals.items} totalCents={totals.totalCents} onClick={() => setStep('cart')} />
          </div>
        </>
      )}

      {step === 'cart' && (
        <>
          <TopBar store={store} consumption={consumption} onCancel={reset} />
          <main className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-auto p-4">
            <h2 className="mb-4 text-4xl font-black">Revise seu pedido</h2>
            {lines.length === 0 && <p className="py-10 text-center text-2xl text-zinc-500">Seu carrinho está vazio.</p>}
            <ul className="space-y-4">
              {lines.map((l) => {
                const product = categories.flatMap((c) => c.products).find((p) => p.id === l.productId);
                return (
                  <li key={l.key} className="flex gap-4 rounded-3xl border-2 border-zinc-200 p-4">
                    <Photo url={l.imageUrl} name={l.name} className="h-28 w-28 shrink-0 rounded-2xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-3">
                        <p className="text-2xl font-black">{l.name}</p>
                        <p className="whitespace-nowrap text-2xl font-black">{formatBRL(lineTotal(l))}</p>
                      </div>
                      {l.optionNames.length > 0 && <p className="text-lg text-zinc-600">{l.optionNames.join(', ')}</p>}
                      {l.notes && <p className="text-lg italic text-zinc-600">Obs.: {l.notes}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Stepper value={l.quantity} onChange={(q) => setLines((ls) => setQuantity(ls, l.key, q))} />
                        {product && product.optionGroups.length + (allowNotes ? 1 : 0) > 0 && (
                          <button onClick={() => setEditing({ product, line: l })} className="rounded-2xl border-2 border-zinc-900 px-5 py-3 text-xl font-bold">
                            Alterar
                          </button>
                        )}
                        <button onClick={() => setLines((ls) => setQuantity(ls, l.key, 0))} className="rounded-2xl px-5 py-3 text-xl font-bold text-red-700 underline">
                          Remover
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </main>
          <footer className="border-t-2 border-zinc-200 p-4">
            <div className="mx-auto flex max-w-4xl flex-col gap-3">
              <div className="flex items-baseline justify-between text-3xl font-black">
                <span>Total</span>
                <span>{formatBRL(totals.totalCents)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setStep('menu')} className="rounded-2xl border-4 border-zinc-900 py-6 text-2xl font-black">
                  Continuar comprando
                </button>
                <button
                  disabled={lines.length === 0}
                  onClick={() => {
                    setPay(PAY_IDLE);
                    setStep('payment');
                  }}
                  className="rounded-2xl bg-[var(--brand)] py-6 text-2xl font-black text-white disabled:opacity-40"
                >
                  Ir para o pagamento
                </button>
              </div>
            </div>
          </footer>
        </>
      )}

      {step === 'payment' && totem && <RealPayment totalCents={totals.totalCents} onPlace={placeOrder} onBack={() => setStep('cart')} />}

      {step === 'payment' && !totem && (
        <Payment
          totalCents={totals.totalCents}
          pay={pay}
          onChoose={startPayment}
          onResult={finishPayment}
          onRetry={() => pay.method && startPayment(pay.method)}
          onChange={() => setPay(PAY_IDLE)}
          onBack={() => setStep('cart')}
        />
      )}

      {step === 'done' && placed && (
        <Center>
          <p className="text-3xl font-bold text-emerald-700">Pedido feito!</p>
          <p className="mt-6 text-2xl">Sua senha é</p>
          <p className="my-2 text-[9rem] font-black leading-none tracking-tight">{placed.ticket}</p>
          <div className="mt-4 rounded-3xl bg-amber-100 px-8 py-6 text-amber-950">
            <p className="text-3xl font-black">Vá ao caixa e pague {formatBRL(placed.totalCents)}</p>
            <p className="mt-2 text-2xl">Diga a senha {placed.ticket}. Seu pedido vai para a cozinha assim que o pagamento for confirmado.</p>
          </div>
          <p className="mt-4 text-2xl text-zinc-600">{TOTEM_CONSUMPTION_LABELS[placed.consumption]} · Acompanhe a senha no balcão.</p>
          <button onClick={reset} className="mt-10 rounded-3xl bg-zinc-900 px-12 py-6 text-3xl font-black text-white">
            Voltar ao início
          </button>
          <p className="mt-4 text-lg text-zinc-500">Volta sozinho em {Math.max(0, doneLeft)} s</p>
        </Center>
      )}

      {step === 'done' && !placed && (
        <Center>
          <p className="text-3xl font-bold text-emerald-700">Pagamento aprovado (simulado)</p>
          <p className="mt-6 text-2xl">Sua senha é</p>
          <p className="my-2 text-[9rem] font-black leading-none tracking-tight">{ticket}</p>
          <p className="text-2xl text-zinc-600">
            {consumption ? TOTEM_CONSUMPTION_LABELS[consumption] : ''} · Acompanhe a senha no painel e retire no balcão.
          </p>
          <p className="mt-2 text-lg text-zinc-500">Origem no cupom: {TOTEM_ORIGIN_LABEL}</p>
          <button onClick={reset} className="mt-10 rounded-3xl bg-zinc-900 px-12 py-6 text-3xl font-black text-white">
            Voltar ao início
          </button>
          <p className="mt-4 text-lg text-zinc-500">Volta sozinho em {Math.max(0, doneLeft)} s</p>
        </Center>
      )}

      {editing && (
        <ProductSheet
          key={editing.line?.key ?? editing.product.id}
          product={editing.product}
          line={editing.line}
          allowNotes={allowNotes}
          onClose={() => setEditing(null)}
          onSave={(line) => {
            setLines((ls) => upsertLine(ls, line));
            setEditing(null);
          }}
        />
      )}

      {idleLeft !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-xl rounded-3xl bg-white p-8 text-center">
            <p className="text-4xl font-black">Você ainda está aí?</p>
            <p className="mt-4 text-2xl text-zinc-600">O pedido será cancelado em {idleLeft} s.</p>
            <div className="mt-8 grid gap-3">
              <button onClick={() => setIdleLeft(null)} className="rounded-2xl bg-[var(--brand)] py-6 text-3xl font-black text-white">
                Continuar pedido
              </button>
              <button onClick={reset} className="rounded-2xl py-4 text-2xl font-bold text-zinc-600 underline">
                Recomeçar
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  return (
    <div className="flex h-dvh select-none flex-col overflow-hidden bg-white text-zinc-950 [touch-action:manipulation]">
      {demo && (
        <div className="bg-amber-400 px-4 py-2 text-center text-lg font-black text-zinc-950" role="status">
          MODO DEMONSTRAÇÃO · nenhum pedido, cobrança ou caixa real
        </div>
      )}
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center overflow-auto p-8 text-center">{children}</div>;
}

function Logo({ store, size }: { store: PublicStore['store']; size: string }) {
  if (store.logoUrl) return <img src={store.logoUrl} alt={store.displayName} className={`${size} rounded-full bg-white object-cover shadow-xl`} />;
  return <div className={`${size} flex items-center justify-center rounded-full bg-[var(--brand)] font-black text-white`}>{store.displayName.slice(0, 1)}</div>;
}

function Photo({ url, name, className }: { url: string | null; name: string; className: string }) {
  if (url) return <img src={url} alt={name} className={`${className} object-cover`} />;
  return <div className={`${className} flex items-center justify-center bg-zinc-100 text-4xl font-black text-zinc-400`} aria-hidden="true">{name.slice(0, 1)}</div>;
}

function TopBar({ store, consumption, onCancel }: { store: PublicStore['store']; consumption: TotemConsumption | null; onCancel: () => void }) {
  return (
    <header className="flex items-center gap-4 border-b-2 border-zinc-200 px-4 py-3">
      <Logo store={store} size="h-16 w-16 text-3xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-2xl font-black">{store.displayName}</p>
        {consumption && <p className="text-lg font-semibold text-zinc-600">{TOTEM_CONSUMPTION_LABELS[consumption]}</p>}
      </div>
      <button onClick={onCancel} className="rounded-2xl border-2 border-red-700 px-5 py-3 text-xl font-bold text-red-700">
        Cancelar pedido
      </button>
    </header>
  );
}

function ProductCard({ product, onPick }: { product: PublicProduct; onPick: () => void }) {
  const off = !product.available;
  return (
    <button
      disabled={off}
      onClick={onPick}
      className="relative flex flex-col overflow-hidden rounded-3xl border-2 border-zinc-200 bg-white text-left active:scale-[.98] disabled:active:scale-100"
    >
      <Photo url={product.imageUrl} name={product.name} className={`aspect-[4/3] w-full ${off ? 'grayscale opacity-50' : ''}`} />
      {off && <span className="absolute left-3 top-3 rounded-xl bg-zinc-900 px-3 py-1.5 text-lg font-black text-white">Indisponível</span>}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className={`text-xl font-black leading-tight ${off ? 'text-zinc-400' : ''}`}>{product.name}</p>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          {product.listPriceCents && <span className="text-lg text-zinc-400 line-through">{formatBRL(product.listPriceCents)}</span>}
          <span className={`text-2xl font-black ${off ? 'text-zinc-400' : 'text-zinc-950'}`}>{formatBRL(product.priceCents)}</span>
        </div>
      </div>
    </button>
  );
}

function CartButton({ items, totalCents, onClick }: { items: number; totalCents: number; onClick: () => void }) {
  return (
    <div className="border-t-2 border-zinc-200 bg-white p-3">
      <button
        onClick={onClick}
        disabled={items === 0}
        className="flex w-full items-center justify-between rounded-2xl bg-[var(--brand)] px-6 py-5 text-2xl font-black text-white disabled:bg-zinc-300 disabled:text-zinc-600"
      >
        <span>{items === 0 ? 'Carrinho vazio' : `Ver carrinho · ${items} ${items === 1 ? 'item' : 'itens'}`}</span>
        <span>{formatBRL(totalCents)}</span>
      </button>
    </div>
  );
}

function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl border-2 border-zinc-900">
      <button aria-label="Menos" disabled={value <= min} onClick={() => onChange(value - 1)} className="h-14 w-14 text-3xl font-black disabled:opacity-30">
        −
      </button>
      <span className="w-10 text-center text-2xl font-black">{value}</span>
      <button aria-label="Mais" disabled={value >= 20} onClick={() => onChange(value + 1)} className="h-14 w-14 text-3xl font-black disabled:opacity-30">
        +
      </button>
    </div>
  );
}

function ProductSheet({
  product,
  line,
  allowNotes,
  onClose,
  onSave,
}: {
  product: PublicProduct;
  line: TotemLine | null;
  allowNotes: boolean;
  onClose: () => void;
  onSave: (line: TotemLine) => void;
}) {
  const [picked, setPicked] = useState<string[]>(line?.optionIds ?? []);
  const [qty, setQty] = useState(line?.quantity ?? 1);
  const [notes, setNotes] = useState(line?.notes ?? '');
  const errors = selectionErrors(product, picked);
  const unit = unitPrice(product, picked);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 landscape:items-center">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white landscape:rounded-3xl">
        <div className="min-h-0 flex-1 overflow-auto">
          <Photo url={product.imageUrl} name={product.name} className="aspect-[16/7] w-full" />
          <div className="space-y-6 p-6">
            <div>
              <h2 className="text-4xl font-black">{product.name}</h2>
              {product.description && <p className="mt-2 text-xl text-zinc-600">{product.description}</p>}
              <p className="mt-2 text-2xl font-black">{formatBRL(product.priceCents)}</p>
            </div>
            {product.optionGroups.map((g) => {
              const count = g.options.filter((o) => picked.includes(o.id)).length;
              const missing = count < g.minSelect;
              return (
                <section key={g.id}>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <h3 className="text-2xl font-black">{g.name}</h3>
                    {g.minSelect > 0 ? (
                      <span className={`rounded-xl px-3 py-1 text-lg font-bold ${missing ? 'bg-red-700 text-white' : 'bg-emerald-700 text-white'}`}>
                        {missing ? 'Obrigatório' : 'OK'}
                      </span>
                    ) : (
                      <span className="rounded-xl bg-zinc-200 px-3 py-1 text-lg font-bold text-zinc-700">Opcional</span>
                    )}
                    <span className="text-lg text-zinc-600">
                      {g.maxSelect === 1 ? 'Escolha 1' : g.minSelect > 0 ? `Escolha de ${g.minSelect} a ${g.maxSelect}` : `Até ${g.maxSelect}`}
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {g.options.map((o) => {
                      const on = picked.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          disabled={!o.available}
                          onClick={() => setPicked((p) => toggleOption(g, p, o.id))}
                          className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border-4 px-5 py-3 text-left text-xl font-bold ${
                            on ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-white'
                          } disabled:border-zinc-100 disabled:text-zinc-400`}
                        >
                          <span>
                            {on ? '✓ ' : ''}
                            {o.name}
                            {!o.available && ' (indisponível)'}
                          </span>
                          {o.priceCents > 0 && <span>+ {formatBRL(o.priceCents)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {allowNotes && (
              <section>
                <h3 className="mb-3 text-2xl font-black">Observação</h3>
                <input
                  value={notes}
                  maxLength={140}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: sem cebola"
                  className="w-full rounded-2xl border-4 border-zinc-200 px-5 py-4 text-xl"
                />
              </section>
            )}
          </div>
        </div>
        <div className="space-y-3 border-t-2 border-zinc-200 p-4">
          {errors[0] && <p className="text-xl font-bold text-red-700" role="alert">{errors[0]}</p>}
          <div className="flex items-center gap-3">
            <Stepper value={qty} min={1} onChange={setQty} />
            <button
              disabled={errors.length > 0}
              onClick={() =>
                onSave({
                  key: line?.key ?? newKey(),
                  productId: product.id,
                  name: product.name,
                  imageUrl: product.imageUrl,
                  optionIds: picked,
                  optionNames: optionNames(product, picked),
                  notes: notes.trim(),
                  quantity: qty,
                  unitPriceCents: unit,
                })
              }
              className="flex flex-1 items-center justify-between rounded-2xl bg-[var(--brand)] px-6 py-5 text-2xl font-black text-white disabled:bg-zinc-300 disabled:text-zinc-600"
            >
              <span>{line ? 'Salvar' : 'Adicionar'}</span>
              <span>{formatBRL(unit * qty)}</span>
            </button>
          </div>
          <button onClick={onClose} className="w-full py-3 text-xl font-bold text-zinc-600 underline">
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Modo real: o cliente diz como vai pagar no caixa e o pedido é enviado (sem maquininha integrada). */
function RealPayment({ totalCents, onPlace, onBack }: { totalCents: number; onPlace: (h: TotemPayHint) => Promise<void>; onBack: () => void }) {
  const [busy, setBusy] = useState<TotemPayHint | null>(null);
  const [failed, setFailed] = useState<{ hint: TotemPayHint; message: string } | null>(null);
  const sending = useRef(false);
  const send = async (hint: TotemPayHint) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(hint);
    setFailed(null);
    try {
      await onPlace(hint);
    } catch (e) {
      setFailed({ hint, message: (e as Error).message });
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };
  return (
    <Center>
      <p className="text-2xl text-zinc-600">Total</p>
      <p className="text-6xl font-black">{formatBRL(totalCents)}</p>
      <h2 className="mt-10 text-4xl font-black">Como você vai pagar no caixa?</h2>
      <p className="mt-2 text-2xl text-zinc-600">Você recebe uma senha e paga no caixa.</p>
      <div className="mt-6 grid w-full max-w-4xl gap-6 portrait:grid-cols-1 landscape:grid-cols-3">
        {(['CARD', 'PIX', 'CASH'] as TotemPayHint[]).map((h) => (
          <button key={h} disabled={!!busy} onClick={() => void send(h)} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-3xl border-4 border-zinc-900 text-4xl font-black active:bg-zinc-100 disabled:opacity-50">
            <span className="text-6xl" aria-hidden="true">{h === 'PIX' ? '⚡' : h === 'CARD' ? '💳' : '💵'}</span>
            {busy === h ? 'Enviando...' : TOTEM_PAY_HINT_LABELS[h]}
          </button>
        ))}
      </div>
      {failed && (
        <div className="mt-6 w-full max-w-2xl rounded-3xl bg-red-50 p-5 text-center" role="alert">
          <p className="text-2xl font-black text-red-700">Não deu para enviar o pedido</p>
          <p className="mt-1 text-xl text-zinc-700">{failed.message}</p>
          <button onClick={() => void send(failed.hint)} className="mt-4 rounded-2xl bg-[var(--brand)] px-10 py-5 text-2xl font-black text-white">
            Tentar de novo
          </button>
        </div>
      )}
      <button onClick={onBack} disabled={!!busy} className="mt-8 rounded-2xl px-8 py-5 text-2xl font-bold text-zinc-600 underline">
        Voltar ao carrinho
      </button>
    </Center>
  );
}

function Payment({
  totalCents,
  pay,
  onChoose,
  onResult,
  onRetry,
  onChange,
  onBack,
}: {
  totalCents: number;
  pay: PayState;
  onChoose: (m: TotemPayMethod) => void;
  onResult: (ok: boolean) => void;
  onRetry: () => void;
  onChange: () => void;
  onBack: () => void;
}) {
  return (
    <Center>
      <p className="rounded-xl bg-amber-100 px-4 py-2 text-xl font-bold text-amber-900">Pagamento simulado: ninguém é cobrado</p>
      <p className="mt-6 text-2xl text-zinc-600">Total a pagar</p>
      <p className="text-6xl font-black">{formatBRL(totalCents)}</p>

      {pay.status === 'choose' && (
        <>
          <h2 className="mt-10 text-4xl font-black">Como você quer pagar?</h2>
          <div className="mt-6 grid w-full max-w-3xl gap-6 portrait:grid-cols-1 landscape:grid-cols-2">
            {(['PIX', 'CARD'] as TotemPayMethod[]).map((m) => (
              <button key={m} onClick={() => onChoose(m)} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl border-4 border-zinc-900 text-4xl font-black active:bg-zinc-100">
                <span className="text-6xl" aria-hidden="true">{m === 'PIX' ? '⚡' : '💳'}</span>
                {TOTEM_PAY_LABELS[m]}
              </button>
            ))}
          </div>
          <button onClick={onBack} className="mt-8 rounded-2xl px-8 py-5 text-2xl font-bold text-zinc-600 underline">
            Voltar ao carrinho
          </button>
        </>
      )}

      {pay.status === 'pending' && (
        <div className="mt-8 flex w-full max-w-2xl flex-col items-center gap-6" aria-live="polite">
          {pay.method === 'PIX' ? (
            <>
              <FakeQr />
              <p className="text-3xl font-black">Leia o QR Code com o app do seu banco</p>
            </>
          ) : (
            <>
              <span className="text-8xl" aria-hidden="true">💳</span>
              <p className="text-3xl font-black">Aproxime ou insira o cartão na maquininha</p>
            </>
          )}
          <p className="flex items-center gap-3 text-2xl text-zinc-600">
            <span className="h-6 w-6 animate-spin rounded-full border-4 border-zinc-300 border-t-[var(--brand)]" />
            Aguardando pagamento ({TOTEM_PAY_LABELS[pay.method!]})...
          </p>
          <div className="w-full rounded-3xl border-4 border-dashed border-amber-400 bg-amber-50 p-5">
            <p className="text-lg font-bold text-amber-900">Teste da demonstração</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button onClick={() => onResult(true)} className="rounded-2xl bg-emerald-700 py-5 text-2xl font-black text-white">
                Simular aprovado
              </button>
              <button onClick={() => onResult(false)} className="rounded-2xl bg-red-700 py-5 text-2xl font-black text-white">
                Simular recusado
              </button>
            </div>
          </div>
        </div>
      )}

      {pay.status === 'failed' && (
        <div className="mt-8 flex w-full max-w-2xl flex-col items-center gap-4" role="alert">
          <p className="text-4xl font-black text-red-700">Pagamento não aprovado</p>
          <p className="text-2xl text-zinc-600">Nada foi cobrado. Tente de novo ou escolha outra forma.</p>
          <div className="mt-4 grid w-full grid-cols-2 gap-3">
            <button onClick={onRetry} className="rounded-2xl bg-[var(--brand)] py-6 text-2xl font-black text-white">
              Tentar de novo
            </button>
            <button onClick={onChange} className="rounded-2xl border-4 border-zinc-900 py-6 text-2xl font-black">
              Trocar forma
            </button>
          </div>
          <button onClick={onBack} className="mt-2 py-3 text-2xl font-bold text-zinc-600 underline">
            Voltar ao carrinho
          </button>
        </div>
      )}
    </Center>
  );
}

/** QR Code de enfeite (não é um Pix de verdade). */
function FakeQr() {
  const cells = Array.from({ length: 21 * 21 }, (_, i) => {
    const x = i % 21;
    const y = Math.floor(i / 21);
    const finder = (a: number, b: number) => x >= a && x < a + 7 && y >= b && y < b + 7 && (x === a || x === a + 6 || y === b || y === b + 6 || (x >= a + 2 && x <= a + 4 && y >= b + 2 && y <= b + 4));
    if (finder(0, 0) || finder(14, 0) || finder(0, 14)) return true;
    if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) return false;
    return (x * 7 + y * 13 + x * y) % 3 === 0;
  });
  return (
    <div className="relative rounded-3xl bg-white p-4 shadow-lg ring-4 ring-zinc-200">
      <div className="grid h-64 w-64 grid-cols-[repeat(21,1fr)]">
        {cells.map((on, i) => <span key={i} className={on ? 'bg-zinc-950' : ''} />)}
      </div>
      <span className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-lg bg-amber-400 px-3 py-1 text-lg font-black">SIMULADO</span>
    </div>
  );
}
