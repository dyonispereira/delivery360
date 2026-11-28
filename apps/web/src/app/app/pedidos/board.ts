'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_LABELS, formatBRL, orderOrigin, PAYMENT_METHOD_LABELS, totemTicketLine, type DeliveryFailReason, type TotemConsumption, type OrderStatus, type PaymentMethod, type SalesChannel } from '@delivery360/shared';
import { api } from '@/lib/api';

export interface BoardOrder {
  id: string;
  number: number;
  trackingCode: string;
  status: OrderStatus;
  type: 'DELIVERY' | 'PICKUP' | 'DINE_IN' | 'COUNTER';
  /** Salão: mesa e garçom que lançou. */
  tableName: string | null;
  waiterName: string | null;
  customerName: string;
  customerPhone: string;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressReference: string | null;
  deliveryZoneName: string | null;
  notes: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  /** Pedido agendado: horário do cliente, quando entra na cozinha e se ainda está esperando. */
  scheduledFor?: string | null;
  releaseAt?: string | null;
  held?: boolean;
  /** Prêmio da fidelidade trocado por pontos (ex.: "Coca 2L grátis"). */
  rewardName?: string | null;
  paymentMethod: PaymentMethod;
  changeForCents: number | null;
  /** De onde veio: loja própria ou app de delivery (com o número do pedido no app). */
  channel: SalesChannel;
  externalCode: string | null;
  /** Totem de autoatendimento: de onde veio, senha de chamada e comer aqui/levar. */
  totemId?: string | null;
  ticket?: string | null;
  consumption?: TotemConsumption | null;
  printedAt: string | null;
  createdAt: string;
  /** O motoboy não conseguiu entregar e o restaurante precisa decidir (reenviar ou cancelar). */
  deliveryIssue: DeliveryFailReason | null;
  ratingStore: number | null;
  ratingDelivery: number | null;
  items: { id: string; name: string; quantity: number; totalCents: number; notes: string | null; options: { name: string }[] }[];
  statusHistory: { status: OrderStatus; createdAt: string }[];
}

/** Próximo passo principal de cada status (o botão grande do cartão). */
/**
 * Com o módulo Entregas, o pedido de entrega para em "Pronto" e sai pelo lote do motoboy
 * (tela Entregas); sem o módulo, a própria loja marca "Saiu para entrega".
 */
export function primaryAction(o: Pick<BoardOrder, 'status' | 'type'>, withCouriers = false): { to: OrderStatus; label: string } | null {
  switch (o.status) {
    case 'PAID':
      return { to: 'IN_PREPARATION', label: 'Iniciar preparo' };
    case 'IN_PREPARATION':
      if (o.type === 'DINE_IN') return { to: 'READY', label: 'Pronto para servir' };
      if (o.type === 'PICKUP' || o.type === 'COUNTER') return { to: 'READY', label: 'Pronto para retirar' };
      return withCouriers ? { to: 'READY', label: 'Pronto' } : { to: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' };
    case 'READY':
      if (o.type === 'DINE_IN') return { to: 'COMPLETED', label: 'Servido na mesa' };
      if (o.type === 'PICKUP' || o.type === 'COUNTER') return { to: 'COMPLETED', label: 'Cliente retirou' };
      return withCouriers ? null : { to: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' };
    case 'OUT_FOR_DELIVERY':
      return { to: 'COMPLETED', label: 'Finalizar (entregue)' };
    default:
      return null;
  }
}

/** Minutos desde que o pedido entrou na operação (pago). */
export function minutesSince(o: BoardOrder, now: number): number {
  // Agendado: conta a partir da hora de começar, não de quando o cliente pediu.
  const paid = o.releaseAt ?? o.statusHistory.find((h) => h.status === 'PAID')?.createdAt ?? o.createdAt;
  return Math.max(0, Math.floor((now - new Date(paid).getTime()) / 60000));
}

const prefKey = (k: string) => `d360.board.${k}`;
export function readPref(k: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(prefKey(k));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
export function writePref(k: string, v: boolean) {
  try {
    localStorage.setItem(prefKey(k), v ? '1' : '0');
  } catch {
    /* sem storage: vale só nesta aba */
  }
}

let audioCtx: AudioContext | null = null;
/** Precisa de um clique antes (regra dos navegadores); depois toca sozinho. */
export async function unlockSound() {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}
export function soundUnlocked() {
  return audioCtx?.state === 'running';
}
export function playAlert() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t0 = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((offset, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'square';
    osc.frequency.value = i === 2 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.2);
    osc.connect(gain).connect(audioCtx!.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.22);
  });
}

/**
 * Lê os pedidos a cada `intervalMs` e avisa quando chega pedido novo (status Pago que ainda não tinha sido visto).
 * Na primeira leitura não avisa: o que já estava lá não é novidade.
 */
export function useBoard(intervalMs: number, onNew?: (orders: BoardOrder[]) => void) {
  const [orders, setOrders] = useState<BoardOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const load = useCallback(async () => {
    try {
      const list = await api<BoardOrder[]>('/cardapio/orders/board', { tenant: true });
      // Agendado avisa duas vezes: quando chega e quando é hora de começar (sai de "Agendados").
      const key = (o: BoardOrder) => `${o.id}:${o.held ? 'held' : 'live'}`;
      const fresh = seen.current ? list.filter((o) => o.status === 'PAID' && !seen.current!.has(key(o))) : [];
      seen.current = new Set(list.map(key));
      setOrders(list);
      setError(null);
      if (fresh.length) onNewRef.current?.(fresh);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  const move = useCallback(
    async (id: string, to: OrderStatus, note?: string) => {
      setOrders((cur) => cur?.map((o) => (o.id === id ? { ...o, status: to } : o)) ?? cur);
      try {
        await api(`/cardapio/orders/${id}/status`, { method: 'PATCH', tenant: true, body: { status: to, note } });
      } catch (e) {
        setError((e as Error).message);
      }
      await load();
    },
    [load],
  );

  return { orders, error, reload: load, move };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Largura do papel da impressora da cozinha (Nota fiscal e impressoras, no PDV). */
let kitchenWidthMm = 80;
export function setKitchenWidth(mm: number | undefined) {
  if (mm === 58 || mm === 80) kitchenWidthMm = mm;
}

/** Comanda para impressora térmica (58 ou 80 mm, como configurado). Abre a janela de impressão do navegador. */
export function printOrder(o: BoardOrder, storeName: string, markPrinted = true) {
  const when = new Date(o.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const items = o.items
    .map(
      (i) => `<div class="row"><b>${i.quantity}x ${esc(i.name)}</b><span>${formatBRL(i.totalCents)}</span></div>
      ${i.options.map((op) => `<div class="sub">+ ${esc(op.name)}</div>`).join('')}
      ${i.notes ? `<div class="sub obs">OBS: ${esc(i.notes)}</div>` : ''}`,
    )
    .join('');
  const address =
    o.type === 'DELIVERY'
      ? `<div><b>ENTREGA</b> - ${esc(o.deliveryZoneName ?? '')}</div><div>${esc(o.addressStreet ?? '')}, ${esc(o.addressNumber ?? '')}${o.addressComplement ? ` - ${esc(o.addressComplement)}` : ''}</div>${o.addressReference ? `<div>Ref.: ${esc(o.addressReference)}</div>` : ''}`
      : o.type === 'DINE_IN'
        ? ''
        : o.type === 'COUNTER'
          ? `<div><b>BALCÃO (PDV)</b></div>`
          : '<div><b>RETIRADA NO BALCÃO</b></div>';
  const payment = `${PAYMENT_METHOD_LABELS[o.paymentMethod]}${o.paymentMethod === 'PIX' || o.paymentMethod === 'APP_ONLINE' ? ' (PAGO)' : ''}${o.changeForCents ? ` - troco p/ ${formatBRL(o.changeForCents)}` : ''}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${o.number}</title><style>
    @page { size: ${kitchenWidthMm}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: ${kitchenWidthMm === 58 ? 10 : 12}px; width: 100%; max-width: ${kitchenWidthMm - 4}mm; margin: 0; color: #000; }
    h1 { font-size: 22px; text-align: center; margin: 4px 0; }
    .c { text-align: center; } .row { display: flex; justify-content: space-between; gap: 6px; }
    .sub { padding-left: 10px; } .obs { font-weight: bold; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .big { font-size: 14px; font-weight: bold; }
  </style></head><body>
    <div class="c">${esc(storeName)}</div>
    <h1>PEDIDO #${o.number}</h1>
    ${o.channel && o.channel !== 'LOJA' ? `<div class="c big">${CHANNEL_LABELS[o.channel]}${o.externalCode ? ` ${esc(o.externalCode)}` : ''}</div>` : ''}
    <div class="c">${when}</div>
    <div class="c"><b>Origem: ${esc(orderOrigin(o.type, o.channel, !!o.totemId))}</b></div>
    ${totemTicketLine(o) ? `<h1>${esc(totemTicketLine(o)!)}</h1>` : ''}<hr>
    ${
      o.type === 'DINE_IN'
        ? `<h1>${esc(o.tableName ?? 'SALÃO')}</h1>${o.waiterName ? `<div class="c">Garçom: ${esc(o.waiterName)}</div>` : ''}<hr>`
        : `<div class="big">${esc(o.customerName)}</div>${o.customerPhone ? `<div>Tel: ${esc(o.customerPhone)}</div>` : ''}
    ${address}<hr>`
    }
    ${items}
    ${o.notes ? `<hr><div class="obs">OBS DO PEDIDO: ${esc(o.notes)}</div>` : ''}<hr>
    <div class="row"><span>Subtotal</span><span>${formatBRL(o.subtotalCents)}</span></div>
    ${o.type === 'DELIVERY' ? `<div class="row"><span>Entrega</span><span>${formatBRL(o.deliveryFeeCents)}</span></div>` : ''}
    ${o.scheduledFor ? `<div class="obs">AGENDADO: ${esc(scheduleText(o.scheduledFor))}</div><hr>` : ''}
    ${o.subtotalCents + o.deliveryFeeCents > o.totalCents ? `<div class="row"><span>Descontos</span><span>-${formatBRL(o.subtotalCents + o.deliveryFeeCents - o.totalCents)}</span></div>` : ''}
    ${o.rewardName ? `<div class="obs">PRÊMIO FIDELIDADE: ${esc(o.rewardName)}</div>` : ''}
    <div class="row big"><span>TOTAL</span><span>${formatBRL(o.totalCents)}</span></div>
    <div>${o.type === 'DINE_IN' ? 'Soma na conta da mesa' : o.type === 'COUNTER' ? 'PAGO NO BALCÃO' : payment}</div><hr><div class="c">Delivery360</div>
  </body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 50);
  if (markPrinted) void api(`/cardapio/orders/${o.id}/printed`, { method: 'POST', tenant: true }).catch(() => undefined);
}

/** Impressão automática: só imprime se esta tela foi a primeira a marcar o pedido (evita duas comandas). */
export async function autoPrint(o: BoardOrder, storeName: string) {
  try {
    const { first } = await api<{ first: boolean }>(`/cardapio/orders/${o.id}/printed`, { method: 'POST', tenant: true });
    if (first) printOrder(o, storeName, false);
  } catch {
    /* sem conexão: o pedido continua no painel para imprimir à mão */
  }
}

/** "sáb, 29/11 às 20:00" no horário de Brasília. */
export function scheduleText(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).replace('.', '');
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${day} às ${hm}`;
}
