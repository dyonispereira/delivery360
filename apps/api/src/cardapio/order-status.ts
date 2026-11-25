import type { OrderStatus, OrderType } from '@prisma/client';

/** Status em que o pedido ainda está na operação (aparece no painel e na cozinha). */
export const ACTIVE_STATUSES: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY'];

/**
 * Próximos status permitidos a partir do atual.
 * Entrega: recebido -> em preparo -> (pronto) -> em entrega -> entregue.
 * Retirada: recebido -> em preparo -> pronto -> retirado.
 * Cancelar é possível enquanto o pedido não terminou.
 */
export function nextStatuses(type: OrderType, current: OrderStatus): OrderStatus[] {
  const flow: OrderStatus[] = (() => {
    switch (current) {
      case 'PAID':
        return ['IN_PREPARATION'];
      case 'IN_PREPARATION':
        return type === 'DELIVERY' ? ['READY', 'OUT_FOR_DELIVERY'] : ['READY'];
      case 'READY':
        return type === 'DELIVERY' ? ['OUT_FOR_DELIVERY'] : ['COMPLETED'];
      case 'OUT_FOR_DELIVERY':
        return ['COMPLETED'];
      default:
        return [];
    }
  })();
  return ACTIVE_STATUSES.includes(current) ? [...flow, 'CANCELLED'] : flow;
}

export function canTransition(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  return nextStatuses(type, from).includes(to);
}
