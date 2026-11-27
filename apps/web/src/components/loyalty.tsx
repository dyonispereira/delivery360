'use client';

import { useState } from 'react';
import { formatBRL, type OrderTracking, type PublicLoyalty, type QuoteLoyalty } from '@delivery360/shared';

type Program = NonNullable<PublicLoyalty['program']>;
type Reward = Program['rewards'][number];

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function rewardLabel(r: Pick<Reward, 'type' | 'valueCents' | 'name'>) {
  if (r.type === 'FIXED') return `${formatBRL(r.valueCents)} de desconto`;
  if (r.type === 'FREE_DELIVERY') return 'Entrega grátis';
  return r.name;
}

export function levelPerks(l: { discountBps: number; freeDelivery: boolean }) {
  return [l.discountBps > 0 ? `${pct(l.discountBps)} em todo pedido` : null, l.freeDelivery ? 'entrega grátis' : null].filter(Boolean).join(' + ');
}

/** Faixa da fidelidade na loja: como ganhar, saldo do cliente, próximo prêmio, clube e indicação. */
export function LoyaltyCard({ data, referral }: { data: PublicLoyalty; referral: string | null }) {
  const [open, setOpen] = useState(false);
  const p = data.program;
  if (!p) return null;
  const c = data.customer;
  const points = c?.points ?? 0;
  const nextReward = p.rewards.find((r) => r.pointsCost > points);
  const ready = p.rewards.filter((r) => r.pointsCost <= points);
  const progress = nextReward ? Math.min(100, Math.round((points / nextReward.pointsCost) * 100)) : 100;

  return (
    <section className="px-4 pt-4" aria-label="Fidelidade">
      {referral && p.referral && (
        <div className="mb-3 rounded-2xl bg-emerald-600 p-4 text-white">
          <p className="text-lg font-bold">Você ganhou {formatBRL(p.referral.friendCents)} de desconto!</p>
          <p className="text-sm text-emerald-50">
            Um amigo te indicou. O desconto entra sozinho no seu primeiro pedido
            {p.referral.minOrderCents > 0 ? ` acima de ${formatBRL(p.referral.minOrderCents)}` : ''}.
          </p>
        </div>
      )}
      {p.pointsEnabled && (
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
          <button type="button" className="w-full p-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Programa de fidelidade</p>
                {c?.known ? (
                  <p className="text-lg font-bold text-zinc-900">
                    Você tem {points} {points === 1 ? 'ponto' : 'pontos'}
                    {c.level && <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 align-middle text-xs font-semibold text-amber-300">{c.level.name}</span>}
                  </p>
                ) : (
                  <p className="text-lg font-bold text-zinc-900">Ganhe {p.pointsPerReal} {p.pointsPerReal === 1 ? 'ponto' : 'pontos'} a cada R$ 1</p>
                )}
                <p className="text-sm text-zinc-600">
                  {ready.length > 0
                    ? `Já dá para trocar por: ${ready.map(rewardLabel).join(', ')}. Escolha no carrinho.`
                    : nextReward
                      ? `${c?.known ? `Faltam ${nextReward.pointsCost - points} pontos` : `Com ${nextReward.pointsCost} pontos`} para ${rewardLabel(nextReward).toLowerCase()}.`
                      : 'Troque seus pontos por prêmios no carrinho.'}
                </p>
              </div>
              <span className="text-3xl text-amber-500" aria-hidden>
                ★
              </span>
            </div>
            {nextReward && c?.known && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100" aria-hidden>
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${progress}%` }} />
              </div>
            )}
          </button>
          {open && (
            <div className="space-y-3 border-t border-amber-200 bg-white/60 p-4 text-sm">
              {p.rewards.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold">Prêmios</p>
                  <ul className="space-y-1">
                    {p.rewards.map((r) => (
                      <li key={r.id} className="flex justify-between gap-3">
                        <span>{rewardLabel(r)}{r.minOrderCents > 0 ? ` (pedido a partir de ${formatBRL(r.minOrderCents)})` : ''}</span>
                        <span className="shrink-0 font-semibold text-amber-700">{r.pointsCost} pts</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.levels.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold">Clube de benefícios</p>
                  <ul className="space-y-1">
                    {p.levels.map((l) => (
                      <li key={l.name} className="flex justify-between gap-3">
                        <span>
                          <b>{l.name}</b>: {levelPerks(l)}
                        </span>
                        <span className="shrink-0 text-zinc-500">{l.minPoints} pts/ano</span>
                      </li>
                    ))}
                  </ul>
                  {c?.next && <p className="mt-1 text-xs text-zinc-500">Faltam {c.next.missing} pontos para o nível {c.next.name}.</p>}
                </div>
              )}
              {p.referral && (
                <p>
                  <b>Indique e Ganhe:</b> depois do seu pedido, você recebe um link. Cada amigo ganha {formatBRL(p.referral.friendCents)} no primeiro pedido e você ganha{' '}
                  {p.referral.referrerPoints} pontos.
                </p>
              )}
              <p className="text-xs text-zinc-500">
                Os pontos entram quando o pedido é entregue ou retirado. A taxa de entrega não conta.
                {p.expireDays > 0 ? ` Os pontos vencem se você ficar ${p.expireDays} dias sem pedir.` : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** No carrinho: saldo, troca por prêmio, desconto do clube e da indicação. */
export function LoyaltyCheckout({
  program,
  quote,
  phoneOk,
  rewardId,
  onReward,
  error,
}: {
  program: Program;
  quote: QuoteLoyalty | undefined;
  phoneOk: boolean;
  rewardId: string | null;
  onReward: (id: string | null) => void;
  error: string | null;
}) {
  const points = quote?.points ?? 0;
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
      {program.pointsEnabled && (
        <>
          <div className="flex items-center justify-between">
            <p className="font-semibold">★ Seus pontos</p>
            <p className="font-bold text-amber-700">{phoneOk ? `${points} pts` : 'informe o telefone'}</p>
          </div>
          {phoneOk && program.rewards.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {program.rewards.map((r) => {
                const on = rewardId === r.id;
                const short = r.pointsCost - points;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!on && short > 0}
                    onClick={() => onReward(on ? null : r.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${on ? 'border-amber-600 bg-amber-500 text-white' : 'border-amber-300 bg-white text-zinc-800'}`}
                  >
                    {on ? '✓ ' : ''}
                    {rewardLabel(r)} · {r.pointsCost} pts{short > 0 ? ` (faltam ${short})` : ''}
                  </button>
                );
              })}
            </div>
          )}
          {error && <p className="text-red-700">{error}</p>}
        </>
      )}
      {quote?.level && (
        <p className={quote.clubBlockedByCoupon ? 'text-zinc-500' : 'text-emerald-800'}>
          Clube <b>{quote.level.name}</b>: {levelPerks(quote.level)}
          {quote.clubBlockedByCoupon ? ' (não soma com cupom: vale o cupom)' : ''}
        </p>
      )}
      {quote && quote.referralDiscountCents > 0 && <p className="text-emerald-800">Indicação de amigo: {formatBRL(quote.referralDiscountCents)} de desconto no primeiro pedido.</p>}
      {quote?.referralNote && <p className="text-zinc-500">{quote.referralNote}</p>}
    </div>
  );
}

/** Página do pedido: pontos do pedido, saldo e o link para indicar amigos. */
export function LoyaltyOrderCard({ order }: { order: OrderTracking }) {
  const [copied, setCopied] = useState(false);
  const l = order.loyalty;
  if (!l || order.status === 'AWAITING_PAYMENT') return null;
  const link = l.referral && order.store ? `${typeof window !== 'undefined' ? window.location.origin : ''}/loja/${order.store.slug}?indicacao=${l.referral.code}` : null;
  const text = l.referral && link
    ? `Peça na ${order.store?.displayName} pelo meu link e ganhe ${formatBRL(l.referral.friendCents)} de desconto no primeiro pedido: ${link}`
    : '';
  return (
    <section className="card space-y-3">
      {l.pointsEnabled && l.orderPoints > 0 && order.status !== 'CANCELLED' && (
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-600" aria-hidden>
            ★
          </span>
          <div>
            <p className="font-semibold">{l.orderPointsEarned ? `Você ganhou ${l.orderPoints} pontos!` : `Você vai ganhar ${l.orderPoints} pontos`}</p>
            <p className="text-sm text-zinc-600">
              {l.orderPointsEarned ? `Seu saldo agora é ${l.balance} pontos.` : `Eles entram quando o pedido for ${order.type === 'PICKUP' ? 'retirado' : 'entregue'}. Saldo atual: ${l.balance} pontos.`}
            </p>
          </div>
        </div>
      )}
      {l.referral && link && (
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="font-semibold text-emerald-900">Indique e Ganhe</p>
          <p className="text-sm text-emerald-900">
            Seu amigo ganha {formatBRL(l.referral.friendCents)} no primeiro pedido e você ganha {l.referral.referrerPoints} pontos quando ele receber.
          </p>
          <div className="mt-2 flex gap-2">
            <a className="btn-primary flex-1 py-2.5 text-center" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              Mandar no WhatsApp
            </a>
            <button
              type="button"
              className="btn-ghost py-2.5"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                } catch {
                  /* sem permissão: o cliente copia o código abaixo */
                }
              }}
            >
              {copied ? 'Copiado!' : 'Copiar link'}
            </button>
          </div>
          <p className="mt-1 text-xs text-emerald-800">Seu código: {l.referral.code}</p>
        </div>
      )}
    </section>
  );
}
