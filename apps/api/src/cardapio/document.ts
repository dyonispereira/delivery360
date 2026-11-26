/** Confere os dígitos verificadores de CPF (11) ou CNPJ (14). Devolve só os dígitos, ou null se inválido. */
export function normalizeDocument(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 11) return validCpf(d) ? d : null;
  if (d.length === 14) return validCnpj(d) ? d : null;
  return null;
}

function validCpf(d: string) {
  if (/^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

function validCnpj(d: string) {
  if (/^(\d)\1{13}$/.test(d)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}
