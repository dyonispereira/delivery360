'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, ORDER_STATUS_LABELS, parseBRL, PAYMENT_METHOD_LABELS, RATING_LABELS, type OrderStatus, type OrderTracking } from '@delivery360/shared';
import { api, ApiError } from '@/lib/api';
import { ErrorBox, Spinner } from '@/components/ui';
import { LiveMap } from '@/components/live-map';

const DELIVERY_STEPS: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'COMPLETED'];
const PICKUP_STEPS: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'READY', 'COMPLETED'];
const FINAL: OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export default function TrackingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [order, setOrder] = useState<OrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const load = useCallback(() => {
    api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}`)
      .then((o) => {
        setOrder(o);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.status === 404 ? 'Pedido não encontrado.' : e.message));
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza sozinho enquanto o pedido está em andamento (mais rápido enquanto espera o PIX).
  useEffect(() => {
    // Concluído com PIX de gorjeta aberto: continua atualizando até confirmar.
    const waitingTip = order?.tip?.status === 'PENDING';
    if (!order || (FINAL.includes(order.status) && !waitingTip)) return;
    // Mais rápido enquanto espera o PIX e enquanto o motoboy está a caminho (mapa ao vivo).
    const fast = order.status === 'AWAITING_PAYMENT' || order.status === 'OUT_FOR_DELIVERY' || waitingTip;
    const t = setInterval(load, fast ? 5000 : 15000);
    return () => clearInterval(t);
  }, [order, load]);

  async function simulate() {
    setSimulating(true);
    try {
      setOrder(await api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}/simulate-payment`, { method: 'POST' }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSimulating(false);
    }
  }

  if (error && !order) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <ErrorBox message={error} />
      </main>
    );
  }
  if (!order) return <Spinner />;

  const steps = order.type === 'DELIVERY' ? DELIVERY_STEPS : PICKUP_STEPS;
  const current = steps.indexOf(order.status);
  const pix = order.paymentMethod === 'PIX' && order.payment;
  const card = order.paymentMethod === 'CREDIT_CARD' && order.payment;
  const expired = order.payment?.status === 'EXPIRED';

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-10">
      <header className="pt-2">
        {order.store && (
          <Link href={`/loja/${order.store.slug}`} className="text-sm text-[var(--brand)] hover:underline">
            ← {order.store.displayName}
          </Link>
        )}
        <h1 className="mt-1 text-2xl font-bold">Pedido #{order.number}</h1>
        <p className="text-sm text-zinc-500">Olá, {order.customerName.split(' ')[0]}! Acompanhe seu pedido por aqui.</p>
      </header>

      <ErrorBox message={error} />

      <section className="card">
        <p className="text-sm text-zinc-500">Situação</p>
        <p className={`text-lg font-semibold ${order.status === 'CANCELLED' ? 'text-red-600' : ''}`}>
          {expired ? 'Pagamento expirado' : order.type === 'PICKUP' && order.status === 'COMPLETED' ? 'Retirado' : ORDER_STATUS_LABELS[order.status]}
        </p>
        {order.status !== 'AWAITING_PAYMENT' && order.status !== 'CANCELLED' && (
          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    i <= current ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-500'
                  }`}
                >
                  {i < current || order.status === 'COMPLETED' ? '✓' : i + 1}
                </span>
                <span className={i <= current ? 'font-medium' : 'text-zinc-500'}>
                  {s === 'COMPLETED' && order.type === 'PICKUP' ? 'Retirado' : ORDER_STATUS_LABELS[s]}
                </span>
              </li>
            ))}
          </ol>
        )}
        {order.deliveryIssue && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            O entregador não conseguiu concluir a entrega. O restaurante vai falar com você para combinar.
          </p>
        )}
        {order.status === 'OUT_FOR_DELIVERY' && order.courierName && (
          <p className="mt-4 text-sm font-medium">🛵 {order.courierName} está levando seu pedido.</p>
        )}
        {order.store && !FINAL.includes(order.status) && order.status !== 'AWAITING_PAYMENT' && (
          <p className="mt-4 text-sm text-zinc-500">Tempo estimado: cerca de {order.store.estimatedMinutes} minutos.</p>
        )}
      </section>

      {order.status === 'OUT_FOR_DELIVERY' && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Acompanhe no mapa</h2>
          {order.courierLocation ? (
            <>
              <LiveMap courier={order.courierLocation} courierName={order.courierName} />
              <p className="text-xs text-zinc-500">
                Atualizado às {new Date(order.courierLocation.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-500">A localização do entregador aparece aqui assim que o celular dele enviar o sinal.</p>
          )}
        </section>
      )}

      {order.status === 'COMPLETED' && (order.canRate || order.rating) && <RatingCard order={order} code={code} onSaved={setOrder} />}
      {(order.canTip || order.tip?.status === 'PAID') && order.tipCourierName && <TipCard order={order} code={code} onSaved={setOrder} />}

      {pix && order.status === 'AWAITING_PAYMENT' && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Pague com PIX para confirmar</h2>
          <p className="text-sm text-zinc-600">
            {order.payment?.pixQrImage ? 'Aponte a câmera do app do banco para o QR Code ou copie o código e cole em “PIX copia e cola”.' : 'Copie o código abaixo e cole no app do seu banco, em “PIX copia e cola”.'}
            {order.payment?.expiresAt && (
              <> O código vale até {new Date(order.payment.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</>
            )}
          </p>
          {order.payment?.pixQrImage && <PixQr image={order.payment.pixQrImage} />}
          <textarea readOnly className="input font-mono text-xs" rows={3} value={order.payment?.pixCopyPaste ?? ''} />
          <button
            className="btn-primary w-full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(order.payment?.pixCopyPaste ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                /* sem permissão de área de transferência: o cliente copia manualmente */
              }
            }}
          >
            {copied ? 'Copiado!' : 'Copiar código PIX'}
          </button>
          <p className="text-xs text-zinc-500">Esta página atualiza sozinha quando o pagamento for confirmado.</p>
          {order.payment?.canSimulate && (
            <button className="btn-ghost w-full" disabled={simulating} onClick={simulate}>
              {simulating ? 'Confirmando...' : 'Simular pagamento (ambiente de teste)'}
            </button>
          )}
        </section>
      )}

      {card && order.status === 'AWAITING_PAYMENT' && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Pague com cartão para confirmar</h2>
          <p className="text-sm text-zinc-600">
            Você paga na página segura do Asaas, que recebe pela loja. A loja não vê os dados do seu cartão.
            {order.payment?.expiresAt && (
              <> O pagamento fica aberto até {new Date(order.payment.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</>
            )}
          </p>
          {order.payment?.checkoutUrl && (
            <a className="btn-primary block w-full text-center" href={order.payment.checkoutUrl} target="_blank" rel="noopener noreferrer">
              Pagar com cartão
            </a>
          )}
          <p className="text-xs text-zinc-500">Depois de pagar, volte aqui: esta página atualiza sozinha quando o pagamento for confirmado.</p>
          {order.payment?.canSimulate && (
            <button className="btn-ghost w-full" disabled={simulating} onClick={simulate}>
              {simulating ? 'Confirmando...' : 'Simular pagamento (ambiente de teste)'}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 font-semibold">Itens</h2>
        <ul className="divide-y divide-zinc-100 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3 py-2">
              <div>
                <p>
                  {i.quantity}× {i.name}
                </p>
                {i.options.length > 0 && <p className="text-xs text-zinc-500">{i.options.map((o) => o.name).join(', ')}</p>}
                {i.notes && <p className="text-xs text-zinc-500">Obs.: {i.notes}</p>}
              </div>
              <span className="shrink-0">{formatBRL(i.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(order.subtotalCents)}</dd></div>
          {order.promoDiscountCents > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Você economizou com as promoções</dt><dd>{formatBRL(order.promoDiscountCents)}</dd></div>
          )}
          {order.type === 'DELIVERY' && <div className="flex justify-between"><dt>Entrega</dt><dd>{formatBRL(order.deliveryFeeCents)}</dd></div>}
          {order.discountCents > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Cupom {order.couponCode}</dt><dd>−{formatBRL(order.discountCents)}</dd></div>
          )}
          {order.platformDiscountCents > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Desconto especial</dt><dd>−{formatBRL(order.platformDiscountCents)}</dd></div>
          )}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatBRL(order.totalCents)}</dd></div>
          <div className="flex justify-between text-zinc-500">
            <dt>Pagamento</dt>
            <dd>
              {PAYMENT_METHOD_LABELS[order.paymentMethod]}
              {order.changeForCents ? ` (troco para ${formatBRL(order.changeForCents)})` : ''}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card text-sm">
        <h2 className="mb-1 font-semibold">{order.type === 'DELIVERY' ? 'Entrega' : 'Retirada na loja'}</h2>
        {order.address ? (
          <p className="text-zinc-600">
            {order.address.street}, {order.address.number}
            {order.address.complement ? ` – ${order.address.complement}` : ''} · {order.address.zone}
          </p>
        ) : (
          <p className="text-zinc-600">Retire seu pedido no balcão informando o número #{order.number}.</p>
        )}
        {order.type === 'DELIVERY' && (
          <p className="mt-2 text-zinc-500">Na entrega, informe ao entregador os <b>4 últimos dígitos do seu telefone</b>: é o código que confirma que o pedido chegou em você.</p>
        )}
      </section>

      {order.store?.whatsapp && (
        <a
          className="btn-ghost w-full"
          href={`https://wa.me/${order.store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Sobre o pedido #${order.number}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Falar com a loja no WhatsApp
        </a>
      )}
    </main>
  );
}

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
            className={`text-4xl leading-none transition-transform active:scale-90 ${n <= value ? 'text-amber-400' : 'text-zinc-300'}`}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        ))}
        <span className="ml-2 text-sm text-zinc-500">{value ? RATING_LABELS[value] : ''}</span>
      </div>
    </div>
  );
}

/** Depois de receber: o cliente avalia restaurante e entrega (5 estrelas = excelente) e conta o que mais gostou. */
function RatingCard({ order, code, onSaved }: { order: OrderTracking; code: string; onSaved: (o: OrderTracking) => void }) {
  const [store, setStore] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDelivery = order.type === 'DELIVERY';

  if (order.rating) {
    const r = order.rating;
    return (
      <section className="card space-y-1 text-center">
        <p className="font-semibold">Obrigado pela avaliação! 💛</p>
        <p className="text-sm text-zinc-600">
          Restaurante: <span className="text-amber-400">{'★'.repeat(r.store)}</span>
          <span className="text-zinc-300">{'★'.repeat(5 - r.store)}</span>
          {r.delivery && (
            <>
              {' · '}Entrega: <span className="text-amber-400">{'★'.repeat(r.delivery)}</span>
              <span className="text-zinc-300">{'★'.repeat(5 - r.delivery)}</span>
            </>
          )}
        </p>
        {r.comment && <p className="text-sm italic text-zinc-500">“{r.comment}”</p>}
      </section>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}/rating`, {
          method: 'POST',
          body: { store, delivery: isDelivery ? delivery : undefined, comment: comment.trim() || undefined },
        }),
      );
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-4" onSubmit={submit}>
      <div>
        <h2 className="font-semibold">Como foi o seu pedido?</h2>
        <p className="text-sm text-zinc-500">Toque nas estrelas: 5 é excelente.</p>
      </div>
      <StarPicker label={`Restaurante${order.store ? ` (${order.store.displayName})` : ''}`} value={store} onChange={setStore} />
      {isDelivery && <StarPicker label="Entrega" value={delivery} onChange={setDelivery} />}
      <div>
        <label className="label" htmlFor="rating-comment">O que você mais gostou? (opcional)</label>
        <textarea
          id="rating-comment"
          className="input"
          rows={3}
          maxLength={500}
          placeholder="Ex.: chegou quentinho, entregador muito educado..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <ErrorBox message={error} />
      <button className="btn-primary w-full" disabled={busy || !store || (isDelivery && !delivery)}>
        {busy ? 'Enviando...' : 'Enviar avaliação'}
      </button>
    </form>
  );
}

const TIP_PRESETS = [300, 500, 1000];

/** Gorjeta para o motoboy por PIX. O restaurante recebe e repassa ao entregador. */
function TipCard({ order, code, onSaved }: { order: OrderTracking; code: string; onSaved: (o: OrderTracking) => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const tip = order.tip;
  const name = order.tipCourierName;

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<OrderTracking>(`/public/orders/${encodeURIComponent(code)}${path}`, { method: 'POST', body }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (tip?.status === 'PAID') {
    return (
      <section className="card text-center">
        <p className="font-semibold">💚 Gorjeta de {formatBRL(tip.amountCents)} enviada!</p>
        <p className="text-sm text-zinc-500">O restaurante repassa para {name}. Obrigado pelo carinho!</p>
      </section>
    );
  }

  if (tip?.status === 'PENDING') {
    return (
      <section className="card space-y-3">
        <h2 className="font-semibold">Gorjeta de {formatBRL(tip.amountCents)} para {name}</h2>
        <p className="text-sm text-zinc-600">Copie o código e pague no app do banco, em “PIX copia e cola”.</p>
        {tip.pixQrImage && <PixQr image={tip.pixQrImage} />}
        <textarea readOnly className="input font-mono text-xs" rows={3} value={tip.pixCopyPaste ?? ''} />
        <button
          className="btn-primary w-full"
          onClick={() =>
            void navigator.clipboard.writeText(tip.pixCopyPaste ?? '').then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              },
              () => undefined,
            )
          }
        >
          {copied ? 'Copiado!' : 'Copiar código PIX'}
        </button>
        {tip.canSimulate && (
          <button className="btn-ghost w-full" disabled={busy} onClick={() => void call('/tip/simulate-payment')}>
            Simular pagamento da gorjeta (ambiente de teste)
          </button>
        )}
        <ErrorBox message={error} />
      </section>
    );
  }

  const customCents = custom ? parseBRL(custom) : null;
  const chosen = amount ?? customCents;
  const askCpf = !!error?.includes('CPF') || cpf !== '';
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Gostou da entrega? Dê uma gorjeta para {name} 🛵</h2>
        <p className="text-sm text-zinc-500">É opcional. O valor vai inteiro para o entregador, pelo restaurante.</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {TIP_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`rounded-lg border py-2 text-sm font-semibold ${amount === c ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-zinc-300'}`}
            onClick={() => {
              setAmount(c);
              setCustom('');
            }}
          >
            {formatBRL(c)}
          </button>
        ))}
        <input
          aria-label="Outro valor"
          className="input px-2 text-sm"
          inputMode="decimal"
          placeholder="Outro"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            setAmount(null);
          }}
        />
      </div>
      {askCpf && (
        <label className="block text-sm">
          CPF de quem paga (o banco exige no Pix)
          <input className="input mt-1" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} />
        </label>
      )}
      <ErrorBox message={error} />
      <button
        className="btn-primary w-full"
        disabled={busy || !chosen}
        onClick={() => void call('/tip', { amountCents: chosen, ...(cpf.trim() ? { document: cpf.trim() } : {}) })}
      >
        {busy ? 'Gerando PIX...' : chosen ? `Dar ${formatBRL(chosen)} de gorjeta` : 'Escolha um valor'}
      </button>
    </section>
  );
}

/** QR Code do Pix que o gateway gerou (PNG em base64). */
function PixQr({ image }: { image: string }) {
  return (
    <div className="flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${image}`} alt="QR Code do Pix" className="h-52 w-52 rounded-xl border border-zinc-200 bg-white p-2" />
    </div>
  );
}
