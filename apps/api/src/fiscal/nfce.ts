import { createHash } from 'node:crypto';

/**
 * NFC-e (modelo 65), funções puras: monta o que vai para o emissor, a chave de acesso e o QR Code.
 * O emissor (provedor) é quem assina e manda para a SEFAZ; aqui só preparamos e conferimos os dados.
 */

/** Código IBGE da UF (os 2 primeiros dígitos da chave de acesso). */
export const UF_CODES: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

/** Formas de pagamento da NFC-e (tPag). */
export const TPAG = { CASH: '01', CREDIT: '03', DEBIT: '04', PIX: '17', OTHER: '99' } as const;

export class FiscalError extends Error {}

export interface NfceItemInput {
  code: string;
  name: string;
  ncm: string;
  cfop: string;
  quantity: number;
  /** Valor total do item (já com adicionais), em centavos. */
  totalCents: number;
}

export interface NfceInput {
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  cnpj: string;
  uf: string;
  taxRegime: number;
  csosn: string;
  series: number;
  number: number;
  issuedAt: Date;
  /** 1 = presencial (balcão), 4 = entrega em domicílio. */
  presence: 1 | 4;
  items: NfceItemInput[];
  discountCents: number;
  freightCents: number;
  payments: { tPag: string; amountCents: number }[];
  changeCents: number;
  document: string | null;
  customerName: string | null;
}

export interface NfcePayloadItem {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  codigo_ncm: string;
  cfop: string;
  unidade_comercial: 'UN';
  quantidade_comercial: number;
  valor_unitario_comercial: number;
  valor_bruto: number;
  valor_desconto: number;
  icms_origem: 0;
  icms_situacao_tributaria: string;
}

const reais = (c: number) => Math.round(c) / 100;
const digits = (s: string) => s.replace(/\D/g, '');

/** Divide o desconto entre os itens na proporção do valor, sem perder centavos (o último leva a sobra). */
export function allocate(totalsCents: number[], amountCents: number): number[] {
  const sum = totalsCents.reduce((s, v) => s + v, 0);
  if (amountCents <= 0 || sum <= 0) return totalsCents.map(() => 0);
  if (amountCents > sum) throw new FiscalError('O desconto é maior que o valor dos itens.');
  let left = amountCents;
  return totalsCents.map((v, i) => {
    if (i === totalsCents.length - 1) return left;
    const share = Math.floor((v * amountCents) / sum);
    left -= share;
    return share;
  });
}

/** Confere os dados e monta o corpo que vai para o emissor (formato próximo ao dos emissores do mercado). */
export function buildNfcePayload(i: NfceInput) {
  if (!i.items.length) throw new FiscalError('A nota precisa de pelo menos um item.');
  if (digits(i.cnpj).length !== 14) throw new FiscalError('Informe o CNPJ do restaurante nos dados fiscais.');
  if (!UF_CODES[i.uf]) throw new FiscalError('Informe a UF do restaurante nos dados fiscais.');
  for (const it of i.items) {
    if (!/^\d{8}$/.test(it.ncm)) throw new FiscalError(`O NCM de "${it.name}" precisa ter 8 números.`);
    if (!/^[5-7]\d{3}$/.test(it.cfop)) throw new FiscalError(`O CFOP de "${it.name}" é inválido.`);
    if (it.quantity <= 0 || it.totalCents <= 0) throw new FiscalError(`"${it.name}" está sem valor.`);
  }
  const discounts = allocate(i.items.map((x) => x.totalCents), i.discountCents);
  const items: NfcePayloadItem[] = i.items.map((it, n) => ({
    numero_item: n + 1,
    codigo_produto: it.code,
    descricao: i.environment === 'HOMOLOGACAO' && n === 0 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : it.name.slice(0, 120),
    codigo_ncm: it.ncm,
    cfop: it.cfop,
    unidade_comercial: 'UN',
    quantidade_comercial: it.quantity,
    valor_unitario_comercial: reais(it.totalCents / it.quantity),
    valor_bruto: reais(it.totalCents),
    valor_desconto: reais(discounts[n]),
    icms_origem: 0,
    icms_situacao_tributaria: i.csosn,
  }));
  const gross = i.items.reduce((s, x) => s + x.totalCents, 0);
  const totalCents = gross - i.discountCents + i.freightCents;
  const paid = i.payments.reduce((s, p) => s + p.amountCents, 0);
  if (paid !== totalCents) throw new FiscalError('Os pagamentos não fecham com o total da nota.');
  const doc = i.document ? digits(i.document) : null;
  return {
    totalCents,
    body: {
      cnpj_emitente: digits(i.cnpj),
      data_emissao: i.issuedAt.toISOString(),
      serie: i.series,
      numero: i.number,
      natureza_operacao: 'Venda ao consumidor',
      regime_tributario_emitente: i.taxRegime,
      presenca_comprador: i.presence,
      modalidade_frete: i.freightCents > 0 ? 0 : 9,
      ...(i.freightCents > 0 ? { valor_frete: reais(i.freightCents) } : {}),
      ...(doc?.length === 11 ? { cpf_destinatario: doc } : doc?.length === 14 ? { cnpj_destinatario: doc } : {}),
      ...(doc && i.customerName ? { nome_destinatario: i.customerName.slice(0, 60) } : {}),
      valor_produtos: reais(gross),
      valor_desconto: reais(i.discountCents),
      valor_total: reais(totalCents),
      items,
      // Dinheiro: o valor pago inclui o troco (vPag = entregue; vTroco = devolvido).
      formas_pagamento: i.payments.map((p) => ({
        forma_pagamento: p.tPag,
        valor_pagamento: reais(p.amountCents + (p.tPag === TPAG.CASH ? i.changeCents : 0)),
        ...(p.tPag === TPAG.CREDIT || p.tPag === TPAG.DEBIT ? { tipo_integracao: 2 } : {}),
      })),
      ...(i.changeCents > 0 ? { valor_troco: reais(i.changeCents) } : {}),
    },
  };
}

/** Dígito verificador da chave (módulo 11, pesos 2 a 9 da direita para a esquerda). */
export function mod11(base: string): number {
  let sum = 0;
  let w = 2;
  for (let k = base.length - 1; k >= 0; k--) {
    sum += Number(base[k]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Chave de acesso de 44 dígitos: UF, AAMM, CNPJ, modelo 65, série, número, tipo de emissão, código numérico e DV. */
export function accessKey(a: { uf: string; issuedAt: Date; cnpj: string; series: number; number: number; code: number }) {
  const local = new Date(a.issuedAt.getTime() - 3 * 3600_000);
  const aamm = `${String(local.getUTCFullYear()).slice(2)}${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = [
    UF_CODES[a.uf],
    aamm,
    digits(a.cnpj).padStart(14, '0'),
    '65',
    String(a.series).padStart(3, '0'),
    String(a.number).padStart(9, '0'),
    '1',
    String(a.code % 1e8).padStart(8, '0'),
  ].join('');
  return base + mod11(base);
}

/** Endereço de consulta da NFC-e por UF (o de SP como padrão nos testes). */
export function consultUrl(uf: string, environment: 'HOMOLOGACAO' | 'PRODUCAO') {
  if (uf === 'SP') return environment === 'PRODUCAO' ? 'https://www.nfce.fazenda.sp.gov.br/consulta' : 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta';
  return `https://www.sefaz.${uf.toLowerCase()}.gov.br/nfce/consulta`;
}

/**
 * QR Code da NFC-e (versão 2, emissão online): chave|2|ambiente|id do CSC|hash,
 * hash = SHA-1 de "chave|2|ambiente|id do CSC" + CSC, em hexadecimal maiúsculo.
 */
export function qrCodeUrl(a: { key: string; environment: 'HOMOLOGACAO' | 'PRODUCAO'; cscId: string; csc: string; uf: string }) {
  const tpAmb = a.environment === 'PRODUCAO' ? '1' : '2';
  const id = String(Number(a.cscId || '1'));
  const base = `${a.key}|2|${tpAmb}|${id}`;
  const hash = createHash('sha1').update(base + a.csc).digest('hex').toUpperCase();
  const host = a.uf === 'SP'
    ? a.environment === 'PRODUCAO' ? 'https://www.nfce.fazenda.sp.gov.br/qrcode' : 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode'
    : `https://www.sefaz.${a.uf.toLowerCase()}.gov.br/nfce/qrcode`;
  return `${host}?p=${base}|${hash}`;
}
