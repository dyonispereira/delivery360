/** Código de entrega = 4 últimos dígitos do telefone do cliente (o cliente sabe, o motoboy não vê). */
export function deliveryCode(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

export function checkDeliveryCode(phone: string, input: string): boolean {
  const code = deliveryCode(phone);
  return code.length === 4 && input.replace(/\D/g, '') === code;
}

/** Telefone sem os 4 últimos dígitos, para o motoboy não descobrir o código: "(11) 98765-••••". */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const local = d.length > 11 ? d.slice(-11) : d;
  if (local.length < 10) return '••••';
  const ddd = local.slice(0, 2);
  const mid = local.slice(2, -4);
  return `(${ddd}) ${mid}-••••`;
}

export const MAX_CODE_FAILS = 5;
