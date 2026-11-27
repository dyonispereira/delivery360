'use client';

/**
 * Campos do cartão para o checkout transparente: o cliente digita o cartão na própria loja.
 * Os dados vão direto para a API (que repassa ao gateway) e nunca são guardados no navegador.
 */
export interface CardState {
  number: string;
  name: string;
  expiry: string;
  cvv: string;
  email: string;
  cep: string;
  addressNumber: string;
}

export const emptyCard = (addressNumber = ''): CardState => ({ number: '', name: '', expiry: '', cvv: '', email: '', cep: '', addressNumber });

const digits = (s: string) => s.replace(/\D/g, '');

function luhn(n: string) {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(number: string) {
  const n = digits(number);
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(n)) return 'Elo';
  if (/^(606282|3841)/.test(n)) return 'Hipercard';
  return null;
}

/** Devolve a mensagem do primeiro campo errado, ou null se está tudo certo. */
export function cardError(c: CardState): string | null {
  const n = digits(c.number);
  if (n.length < 13 || n.length > 19 || !luhn(n)) return 'Confira o número do cartão.';
  if (c.name.trim().length < 3) return 'Informe o nome impresso no cartão.';
  const m = c.expiry.match(/^(\d{2})\/?(\d{2})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return 'Informe a validade no formato MM/AA.';
  const now = new Date();
  const year = 2000 + Number(m[2]);
  if (year < now.getFullYear() || (year === now.getFullYear() && Number(m[1]) < now.getMonth() + 1)) return 'Cartão vencido. Confira a validade.';
  if (!/^\d{3,4}$/.test(c.cvv)) return 'Informe o código de segurança (CVV).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return 'Informe um e-mail válido.';
  if (digits(c.cep).length !== 8) return 'Informe o CEP do endereço da fatura.';
  if (!c.addressNumber.trim()) return 'Informe o número do endereço da fatura.';
  return null;
}

/** Corpo de POST /public/orders/:code/pay-card. */
export function cardPayload(c: CardState, document?: string) {
  const [month, year] = c.expiry.replace(/\D/g, '').match(/^(\d{2})(\d{2})$/)?.slice(1) ?? ['', ''];
  return {
    holderName: c.name.trim().toUpperCase(),
    number: digits(c.number),
    expiryMonth: month,
    expiryYear: `20${year}`,
    ccv: c.cvv,
    email: c.email.trim(),
    postalCode: digits(c.cep),
    addressNumber: c.addressNumber.trim(),
    ...(document ? { document } : {}),
  };
}

const groupCard = (v: string) => digits(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
const maskExpiry = (v: string) => {
  const d = digits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const maskCep = (v: string) => {
  const d = digits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

export function CardFields({ value, onChange, idPrefix = 'card' }: { value: CardState; onChange: (c: CardState) => void; idPrefix?: string }) {
  const set = (patch: Partial<CardState>) => onChange({ ...value, ...patch });
  const brand = cardBrand(value.number);
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-3">
      <div>
        <label className="label flex items-center justify-between" htmlFor={id('number')}>
          <span>Número do cartão</span>
          {brand && <span className="text-xs font-semibold text-zinc-500">{brand}</span>}
        </label>
        <input
          id={id('number')}
          className="input font-mono"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="0000 0000 0000 0000"
          value={value.number}
          onChange={(e) => set({ number: groupCard(e.target.value) })}
        />
      </div>
      <div>
        <label className="label" htmlFor={id('name')}>Nome impresso no cartão</label>
        <input id={id('name')} className="input uppercase" autoComplete="cc-name" value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={id('exp')}>Validade</label>
          <input id={id('exp')} className="input" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={value.expiry} onChange={(e) => set({ expiry: maskExpiry(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor={id('cvv')}>CVV</label>
          <input
            id={id('cvv')}
            className="input"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            value={value.cvv}
            onChange={(e) => set({ cvv: digits(e.target.value).slice(0, 4) })}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={id('email')}>E-mail (para o comprovante)</label>
        <input id={id('email')} className="input" type="email" autoComplete="email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={id('cep')}>CEP da fatura</label>
          <input id={id('cep')} className="input" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={value.cep} onChange={(e) => set({ cep: maskCep(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor={id('addrnum')}>Número</label>
          <input id={id('addrnum')} className="input" value={value.addressNumber} onChange={(e) => set({ addressNumber: e.target.value.slice(0, 10) })} />
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span aria-hidden>🔒</span> Pagamento protegido. Os dados do cartão não ficam salvos na loja.
      </p>
    </div>
  );
}
