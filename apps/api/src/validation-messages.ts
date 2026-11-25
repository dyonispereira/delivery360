/**
 * Traduz as mensagens padrão (em inglês) do class-validator para o português, com o nome do campo
 * em linguagem de gente. Mensagens já escritas em português nos DTOs passam direto.
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  displayName: 'Nome na loja',
  phone: 'Telefone',
  email: 'E-mail',
  password: 'Senha',
  description: 'Descrição',
  street: 'Rua',
  number: 'Número',
  complement: 'Complemento',
  reference: 'Referência',
  notes: 'Observação',
  note: 'Motivo',
  slug: 'Link da loja',
  city: 'Cidade',
  logoUrl: 'Logo',
  imageUrl: 'Foto',
  legalName: 'Razão social',
  priceCents: 'Preço',
  feeCents: 'Valor',
  minOrderCents: 'Pedido mínimo',
  estimatedMinutes: 'Tempo estimado',
  quantity: 'Quantidade',
  code: 'Código',
};

function label(path: string): string {
  const last = path.split('.').pop() ?? path;
  return FIELD_LABELS[last] ?? last;
}

const RULES: [RegExp, (field: string, n?: string) => string][] = [
  [/^(.+) must be shorter than or equal to (\d+) characters$/, (f, n) => `${label(f)}: use no máximo ${n} caracteres.`],
  [/^(.+) must be longer than or equal to (\d+) characters$/, (f, n) => `${label(f)}: use pelo menos ${n} caracteres.`],
  [/^(.+) must be an email$/, (f) => `${label(f)}: informe um e-mail válido.`],
  [/^(.+) must be a URL address$/, (f) => `${label(f)}: informe um link completo, começando com https://.`],
  [/^(.+) should not be empty$/, (f) => `${label(f)}: preencha este campo.`],
  [/^(.+) must be a string$/, (f) => `${label(f)}: preencha este campo.`],
  [/^(.+) must be an integer number$/, (f) => `${label(f)}: informe um número inteiro.`],
  [/^(.+) must not be less than (\d+)$/, (f, n) => `${label(f)}: o mínimo é ${n}.`],
  [/^(.+) must not be greater than (\d+)$/, (f, n) => `${label(f)}: o máximo é ${n}.`],
  [/^property (.+) should not exist$/, (f) => `Campo não permitido: ${f}.`],
];

export function translateValidationMessage(message: string): string {
  for (const [re, fn] of RULES) {
    const m = re.exec(message);
    if (m) return fn(m[1], m[2]);
  }
  return message;
}
