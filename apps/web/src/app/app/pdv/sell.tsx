'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatBRL, parseBRL, PDV_PAYMENT_METHODS, type PdvPayKey, type PublicProduct, type Receipt, type ReceiptKind } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { openReceiptPdf, printReceipt } from '@/components/receipt';
import { api } from '@/lib/api';
import { lineOptions, lineUnit, MenuPicker, type CartLine } from '../salao/menu-picker';
import type { PdvState } from './page';

type Menu = { categories: { id: string; name: string; products: PublicProduct[] }[]; topProductIds: string[] };
interface PayLine {
  id: number;
  key: PdvPayKey;
  amount: string;
  received: string;
}
interface SaleResult {
  orderId: string;
  number: number;
  totalCents: number;
  changeCents: number;
  fiscalError: string | null;
  receipt: Receipt;
}

const ICON: Record<PdvPayKey, string> = { CASH: '💵', PIX: '⚡', DEBIT: '💳', CREDIT: '💳' };
const cents = (v: string) => parseBRL(v) ?? 0;
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** Venda de balcão: escolhe os itens, cobra (pode dividir e calcular o troco) e sai o cupom. */
export function SellView({ state, onSold }: { state: PdvState; onSold: () => void }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<'cart' | 'pay'>('cart');
  const [done, setDone] = useState<SaleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Menu>('/cardapio/salao/menu', { tenant: true }),
      api<{ receiptAutoPrint: boolean }>('/cardapio/store', { tenant: true }).catch(() => ({ receiptAutoPrint: true })),
    ])
      .then(([m, s]) => {
        setMenu(m);
        setAutoPrint(s.receiptAutoPrint);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const subtotal = cart.reduce((s, l) => s + lineUnit(l) * l.quantity, 0);

  function add(line: Omit<CartLine, 'key'>) {
    setCart((c) => {
      const same = c.find((l) => l.product.id === line.product.id && l.optionIds.join() === line.optionIds.join() && l.notes === line.notes);
      if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l));
      return [...c, { ...line, key: `${line.product.id}-${Date.now()}-${Math.random()}` }];
    });
  }
  const setQty = (key: string, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, q) } : l))));

  if (done) {
    return (
      <SaleDone
        result={done}
        onNew={() => {
          setDone(null);
          setCart([]);
          setStep('cart');
        }}
      />
    );
  }
  if (!menu) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className={step === 'pay' ? 'hidden lg:block' : ''}>
        <MenuPicker categories={menu.categories} topIds={menu.topProductIds} cart={cart} onAdd={add} />
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        {step === 'cart' ? (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Venda</h2>
              {cart.length > 0 && (
                <button className="text-sm text-zinc-500 underline" onClick={() => setCart([])}>
                  Limpar
                </button>
              )}
            </div>
            {cart.length === 0 && <p className="py-6 text-center text-sm text-zinc-500">Toque nos produtos para adicionar.</p>}
            <ul className="divide-y divide-zinc-100">
              {cart.map((l) => (
                <li key={l.key} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.product.name}</p>
                    {lineOptions(l).length > 0 && <p className="text-xs text-zinc-500">{lineOptions(l).join(', ')}</p>}
                    <p className="text-sm text-zinc-600">{formatBRL(lineUnit(l) * l.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="h-8 w-8 rounded-full border border-zinc-200 text-lg" aria-label={`Tirar um ${l.product.name}`} onClick={() => setQty(l.key, l.quantity - 1)}>
                      −
                    </button>
                    <span className="w-7 text-center font-semibold">{l.quantity}</span>
                    <button className="h-8 w-8 rounded-full border border-zinc-200 text-lg" aria-label={`Mais um ${l.product.name}`} onClick={() => setQty(l.key, l.quantity + 1)}>
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-lg font-bold">
              <span>Total</span>
              <span>{formatBRL(subtotal)}</span>
            </div>
            <button className="btn-primary w-full py-3 text-base" disabled={!cart.length} onClick={() => setStep('pay')}>
              Cobrar {formatBRL(subtotal)}
            </button>
          </div>
        ) : (
          <Checkout
            cart={cart}
            subtotal={subtotal}
            nfce={state.nfce}
            onBack={() => setStep('cart')}
            onDone={(r) => {
              setDone(r);
              onSold();
              if (autoPrint) void printReceipt(r.receipt).catch(() => undefined);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Checkout({
  cart,
  subtotal,
  nfce,
  onBack,
  onDone,
}: {
  cart: CartLine[];
  subtotal: number;
  nfce: PdvState['nfce'];
  onBack: () => void;
  onDone: (r: SaleResult) => void;
}) {
  const [customer, setCustomer] = useState('');
  const [doc, setDoc] = useState('');
  const [discount, setDiscount] = useState('');
  const [kitchen, setKitchen] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptKind>(nfce.available ? nfce.defaultReceipt : 'NAO_FISCAL');
  const [pays, setPays] = useState<PayLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discountCents = Math.min(subtotal, cents(discount));
  const total = subtotal - discountCents;
  const paid = pays.reduce((s, p) => s + cents(p.amount), 0);
  const left = total - paid;
  const change = pays.filter((p) => p.key === 'CASH').reduce((s, p) => s + Math.max(0, cents(p.received) - cents(p.amount)), 0);

  const addPay = (key: PdvPayKey) => setPays((ps) => [...ps, { id: Date.now(), key, amount: money(Math.max(0, total - ps.reduce((s, p) => s + cents(p.amount), 0))), received: '' }]);
  const setPay = (id: number, patch: Partial<PayLine>) => setPays((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  // Notas comuns para o "valor entregue" (a próxima nota acima do valor em dinheiro).
  const notesFor = useMemo(() => (amount: number) => [amount, ...[2000, 5000, 10000, 20000].filter((n) => n > amount)].slice(0, 4), []);

  async function finish() {
    setError(null);
    if (left > 0) return setError(`Falta receber ${formatBRL(left)}.`);
    setBusy(true);
    try {
      const r = await api<SaleResult>('/cardapio/pdv/vendas', {
        method: 'POST',
        tenant: true,
        body: {
          items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes || undefined })),
          payments: pays.map((p) => ({ key: p.key, amountCents: cents(p.amount), receivedCents: p.key === 'CASH' && p.received ? cents(p.received) : undefined })),
          customerName: customer.trim() || undefined,
          document: doc.trim() || undefined,
          discountCents: discountCents || undefined,
          kitchen,
          receipt,
        },
      });
      onDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <button className="text-sm text-zinc-500 underline" onClick={onBack}>
          ← Itens
        </button>
        <h2 className="font-semibold">Pagamento</h2>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className="label">Cliente (opcional)</span>
          <input className="input" value={customer} maxLength={60} onChange={(e) => setCustomer(e.target.value)} placeholder="Nome para chamar no balcão" />
        </label>
        <label className="block">
          <span className="label">CPF/CNPJ na nota</span>
          <input className="input" inputMode="numeric" value={doc} maxLength={20} onChange={(e) => setDoc(e.target.value)} placeholder="Opcional" />
        </label>
        <label className="block">
          <span className="label">Desconto (R$)</span>
          <input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
        </label>
      </div>

      <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>
            <b>Mandar para a cozinha</b>
            <span className="block text-xs text-zinc-500">Desligue para bebida ou item pronto (sai entregue).</span>
          </span>
          <Toggle checked={kitchen} onChange={setKitchen} />
        </div>
        <div>
          <p className="mb-1 font-semibold">Cupom</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de cupom">
            {(['NAO_FISCAL', 'NFCE'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={receipt === k}
                disabled={k === 'NFCE' && !nfce.available}
                onClick={() => setReceipt(k)}
                className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 ${receipt === k ? 'border-[var(--brand)] bg-orange-50 ring-1 ring-[var(--brand)]' : 'border-zinc-200 bg-white'}`}
              >
                <span className="block font-semibold">{k === 'NFCE' ? 'NFC-e' : 'Não fiscal'}</span>
                <span className="block text-xs text-zinc-500">
                  {k === 'NFCE' ? (nfce.available ? (nfce.environment === 'PRODUCAO' ? 'Nota fiscal' : 'Homologação (teste)') : 'Configure em Nota fiscal') : 'Comprovante simples'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Itens</span>
          <span>{formatBRL(subtotal)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>Desconto</span>
            <span>-{formatBRL(discountCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{formatBRL(total)}</span>
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">Forma de pagamento</p>
        <div className="grid grid-cols-4 gap-2">
          {PDV_PAYMENT_METHODS.map((m) => (
            <button key={m.key} type="button" className="rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm font-medium transition hover:border-[var(--brand)]" onClick={() => addPay(m.key)}>
              <span className="block text-lg" aria-hidden>
                {ICON[m.key]}
              </span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {pays.length > 0 && (
        <ul className="space-y-2">
          {pays.map((p) => {
            const label = PDV_PAYMENT_METHODS.find((m) => m.key === p.key)!.label;
            return (
              <li key={p.id} className="rounded-xl border border-zinc-200 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-20 text-sm font-semibold">{label}</span>
                  <input className="input flex-1 py-1.5" inputMode="decimal" aria-label={`Valor em ${label}`} value={p.amount} onChange={(e) => setPay(p.id, { amount: e.target.value })} />
                  <button className="h-8 w-8 rounded-full text-zinc-400 hover:bg-zinc-100" aria-label={`Tirar ${label}`} onClick={() => setPays((ps) => ps.filter((x) => x.id !== p.id))}>
                    ✕
                  </button>
                </div>
                {p.key === 'CASH' && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-20 text-xs text-zinc-500">Recebido</span>
                      <input className="input flex-1 py-1.5" inputMode="decimal" aria-label="Valor entregue pelo cliente" placeholder="Quanto o cliente deu" value={p.received} onChange={(e) => setPay(p.id, { received: e.target.value })} />
                    </div>
                    <div className="flex flex-wrap gap-1 pl-[5.5rem]">
                      {notesFor(cents(p.amount)).map((n, i) => (
                        <button key={n} type="button" className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs" onClick={() => setPay(p.id, { received: money(n) })}>
                          {i === 0 ? 'Exato' : formatBRL(n)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {change > 0 && (
        <div className="rounded-xl bg-emerald-50 p-3 text-center">
          <p className="text-sm text-emerald-800">Troco</p>
          <p className="text-3xl font-bold text-emerald-700">{formatBRL(change)}</p>
        </div>
      )}
      {pays.length > 0 && left !== 0 && <p className={`text-sm font-medium ${left > 0 ? 'text-amber-700' : 'text-red-700'}`}>{left > 0 ? `Falta ${formatBRL(left)}` : `Passou ${formatBRL(-left)} do total`}</p>}
      <ErrorBox message={error} />
      <button className="btn-primary w-full py-3 text-base" disabled={busy || !pays.length || left !== 0} onClick={finish}>
        {busy ? 'Finalizando...' : `Finalizar venda · ${receipt === 'NFCE' ? 'NFC-e' : 'cupom não fiscal'}`}
      </button>
    </div>
  );
}

function SaleDone({ result, onNew }: { result: SaleResult; onNew: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(result.receipt);
  const [busy, setBusy] = useState(false);
  const fiscal = receipt.fiscal;

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await api(`/cardapio/pdv/pedidos/${result.orderId}/nfce`, { method: 'POST', tenant: true, body: {} });
      const r = await api<Receipt>(`/cardapio/pdv/pedidos/${result.orderId}/cupom`, { tenant: true });
      setReceipt(r);
      void printReceipt(r).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700" aria-hidden>
        ✓
      </div>
      <div>
        <h2 className="text-lg font-semibold">Venda #{result.number} finalizada</h2>
        <p className="text-sm text-zinc-500">{formatBRL(result.totalCents)}</p>
      </div>
      {result.changeCents > 0 && (
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-sm text-emerald-800">Troco</p>
          <p className="text-4xl font-bold text-emerald-700">{formatBRL(result.changeCents)}</p>
        </div>
      )}
      {receipt.kind === 'NFCE' && fiscal ? (
        <p className="rounded-xl bg-zinc-50 p-2 text-sm">
          NFC-e nº {fiscal.number} autorizada{receipt.test ? ' (homologação, sem valor fiscal)' : ''}.
        </p>
      ) : result.fiscalError ? (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-900">
          <p>
            <b>A NFC-e não saiu:</b> {result.fiscalError} A venda está registrada.
          </p>
          <button className="btn-ghost w-full" disabled={busy} onClick={retry}>
            {busy ? 'Emitindo...' : 'Tentar emitir de novo'}
          </button>
        </div>
      ) : null}
      <ErrorBox message={error} />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost" onClick={() => void printReceipt(receipt).catch((e) => setError((e as Error).message))}>
          🖨️ Imprimir cupom
        </button>
        <button className="btn-ghost" onClick={() => void openReceiptPdf(result.orderId).catch((e) => setError((e as Error).message))}>
          📄 Ver PDF
        </button>
      </div>
      <button className="btn-primary w-full py-3 text-base" onClick={onNew} autoFocus>
        Nova venda
      </button>
    </div>
  );
}
