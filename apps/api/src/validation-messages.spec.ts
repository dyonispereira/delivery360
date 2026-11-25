import { translateValidationMessage as t } from './validation-messages';

describe('translateValidationMessage', () => {
  it('traduz as mensagens comuns com o nome do campo', () => {
    expect(t('slug must be shorter than or equal to 60 characters')).toBe('Link da loja: use no máximo 60 caracteres.');
    expect(t('customer.name must be longer than or equal to 2 characters')).toBe('Nome: use pelo menos 2 caracteres.');
    expect(t('email must be an email')).toBe('E-mail: informe um e-mail válido.');
  });
  it('mantém mensagens já em português', () => {
    expect(t('Informe um telefone com DDD.')).toBe('Informe um telefone com DDD.');
  });
});
