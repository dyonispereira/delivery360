import { normalizeDocument } from './document';

describe('normalizeDocument', () => {
  it('aceita CPF e CNPJ válidos, com ou sem pontuação', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725');
    expect(normalizeDocument('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('recusa dígito errado, repetidos e tamanho errado', () => {
    expect(normalizeDocument('529.982.247-24')).toBeNull();
    expect(normalizeDocument('111.111.111-11')).toBeNull();
    expect(normalizeDocument('11.222.333/0001-80')).toBeNull();
    expect(normalizeDocument('1234')).toBeNull();
    expect(normalizeDocument(undefined)).toBeNull();
  });
});
