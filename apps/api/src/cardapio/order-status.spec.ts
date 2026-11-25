import { canTransition, nextStatuses } from './order-status';

describe('order-status', () => {
  it('entrega segue recebido -> preparo -> em entrega -> entregue', () => {
    expect(canTransition('DELIVERY', 'PAID', 'IN_PREPARATION')).toBe(true);
    expect(canTransition('DELIVERY', 'IN_PREPARATION', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('DELIVERY', 'IN_PREPARATION', 'READY')).toBe(true);
    expect(canTransition('DELIVERY', 'READY', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('DELIVERY', 'OUT_FOR_DELIVERY', 'COMPLETED')).toBe(true);
  });

  it('retirada não passa por "em entrega"', () => {
    expect(canTransition('PICKUP', 'IN_PREPARATION', 'OUT_FOR_DELIVERY')).toBe(false);
    expect(canTransition('PICKUP', 'READY', 'COMPLETED')).toBe(true);
  });

  it('não pula etapas nem volta', () => {
    expect(canTransition('DELIVERY', 'PAID', 'COMPLETED')).toBe(false);
    expect(canTransition('DELIVERY', 'IN_PREPARATION', 'PAID')).toBe(false);
  });

  it('cancela só pedido em andamento; não mexe em aguardando pagamento, entregue ou cancelado', () => {
    expect(canTransition('DELIVERY', 'OUT_FOR_DELIVERY', 'CANCELLED')).toBe(true);
    expect(nextStatuses('DELIVERY', 'AWAITING_PAYMENT')).toEqual([]);
    expect(nextStatuses('DELIVERY', 'COMPLETED')).toEqual([]);
    expect(nextStatuses('PICKUP', 'CANCELLED')).toEqual([]);
  });
});
