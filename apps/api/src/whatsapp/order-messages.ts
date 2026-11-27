import type { OrderStatus, OrderType } from '@prisma/client';

export interface StatusMessageInput {
  status: OrderStatus;
  type: OrderType;
  number: number;
  storeName: string;
  customerName: string;
  /** Página de acompanhamento do pedido (também é onde o cliente avalia). */
  trackingUrl: string | null;
  courierName?: string | null;
  estimatedMinutes?: number | null;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || '';

/**
 * Texto do aviso de cada status para o WhatsApp do cliente. null = esse status não gera mensagem.
 * Fluxo: aprovado → em preparo → aguardando entregador (ou pronto para retirar) → saiu → entregue + avaliação.
 */
export function statusMessage(m: StatusMessageInput): string | null {
  const n = `#${m.number}`;
  const hi = firstName(m.customerName);
  const link = m.trackingUrl ? `\n\nAcompanhe aqui: ${m.trackingUrl}` : '';
  const delivery = m.type === 'DELIVERY';
  switch (m.status) {
    case 'PAID':
      return (
        `✅ *Pedido ${n} aprovado!*\n\n${hi ? `Oi, ${hi}! ` : ''}A *${m.storeName}* recebeu seu pedido e já vai começar a preparar.` +
        (m.estimatedMinutes ? ` Tempo estimado: cerca de ${m.estimatedMinutes} minutos.` : '') +
        link
      );
    case 'IN_PREPARATION':
      return `👨‍🍳 *Pedido ${n} em preparo*\n\nSeu pedido já está sendo preparado com carinho.${link}`;
    case 'READY':
      return delivery
        ? `📦 *Pedido ${n} pronto!*\n\nEstá aguardando o entregador para sair.${link}`
        : `🛍️ *Pedido ${n} pronto para retirada!*\n\nÉ só passar no balcão da *${m.storeName}* e informar o número ${n}.`;
    case 'OUT_FOR_DELIVERY':
      return (
        `🛵 *Pedido ${n} saiu para entrega!*\n\n${m.courierName ? `${firstName(m.courierName)} está a caminho.` : 'O entregador está a caminho.'}${m.trackingUrl ? ` Veja no mapa: ${m.trackingUrl}` : ''}` +
        `\n\n🔑 Ao receber, informe ao entregador o código de entrega: *os 4 últimos números do seu telefone*.`
      );
    case 'COMPLETED':
      return (
        `🎉 *Pedido ${n} ${delivery ? 'entregue' : 'retirado'}!*\n\nBom apetite! Obrigado por pedir na *${m.storeName}*.` +
        (m.trackingUrl ? `\n\n⭐ Conta pra gente como foi? Leva 10 segundos: ${m.trackingUrl}` : '')
      );
    case 'CANCELLED':
      return `❌ *Pedido ${n} cancelado*\n\nSe tiver alguma dúvida, é só responder esta mensagem.`;
    default:
      return null;
  }
}

/** Número no formato do WhatsApp (55 + DDD + número), ou null se não parece um celular brasileiro. */
export function whatsappNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

/** Endereço do site (para o link do pedido): PUBLIC_WEB_URL, ou o PUBLIC_API_URL sem o /api. */
export function publicWebUrl(): string | null {
  const web = process.env.PUBLIC_WEB_URL ?? (process.env.PUBLIC_API_URL ?? '').replace(/\/api\/?$/, '');
  return web ? web.replace(/\/+$/, '') : null;
}
