import { checkDeliveryCode, deliveryCode, maskPhone } from './delivery-code';

describe('delivery-code', () => {
  it('usa os 4 últimos dígitos do telefone', () => {
    expect(deliveryCode('5511987654321')).toBe('4321');
    expect(checkDeliveryCode('5511987654321', '4321')).toBe(true);
    expect(checkDeliveryCode('5511987654321', ' 43-21 ')).toBe(true);
  });

  it('recusa código errado, curto ou vazio', () => {
    expect(checkDeliveryCode('5511987654321', '1234')).toBe(false);
    expect(checkDeliveryCode('5511987654321', '321')).toBe(false);
    expect(checkDeliveryCode('5511987654321', '')).toBe(false);
    expect(checkDeliveryCode('', '')).toBe(false);
  });

  it('esconde os 4 últimos dígitos para o motoboy', () => {
    expect(maskPhone('5511987654321')).toBe('(11) 98765-••••');
    expect(maskPhone('1133334444')).toBe('(11) 3333-••••');
    expect(maskPhone('5511987654321')).not.toContain('4321');
  });
});
