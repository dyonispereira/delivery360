'use client';

import QRCode from 'qrcode';
import { formatAccessKey, formatBRL, formatDocument, type Receipt } from '@delivery360/shared';
import { apiBlobUrl } from '@/lib/api';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** HTML do cupom para a impressora térmica (58 ou 80 mm): não fiscal ou DANFE NFC-e, com QR Code. */
export async function receiptHtml(r: Receipt): Promise<string> {
  const qr = r.fiscal?.qrCodeUrl ? await QRCode.toDataURL(r.fiscal.qrCodeUrl, { margin: 0, width: 220, errorCorrectionLevel: 'M' }) : null;
  const w = r.widthMm;
  const row = (a: string, b: string, cls = '') => `<div class="row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const f = r.fiscal;
  const one = `
    <div class="c b big">${esc(r.store.name)}</div>
    ${r.store.legalName && r.store.legalName !== r.store.name ? `<div class="c s">${esc(r.store.legalName)}</div>` : ''}
    ${r.store.cnpj ? `<div class="c s">CNPJ ${formatDocument(r.store.cnpj)}${r.store.stateRegistration ? ` IE ${esc(r.store.stateRegistration)}` : ''}</div>` : ''}
    ${r.store.address ? `<div class="c s">${esc(r.store.address)}</div>` : ''}
    <hr>
    ${
      r.kind === 'NFCE'
        ? `<div class="c s b">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
           ${r.test ? '<div class="c s b">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>' : ''}
           ${f?.status === 'CANCELLED' ? '<div class="c b big">NFC-e CANCELADA</div>' : ''}`
        : '<div class="c b">CUPOM NÃO FISCAL</div><div class="c s">Não é documento fiscal</div>'
    }
    <div class="c s">Pedido #${r.number} · ${when(r.issuedAt)}</div>
    <hr>
    ${r.items
      .map(
        (i) => `${row(`${i.quantity}x ${esc(i.name)}`, formatBRL(i.totalCents))}${i.options.map((o) => `<div class="sub s">+ ${esc(o)}</div>`).join('')}`,
      )
      .join('')}
    <hr>
    ${row('Qtde. total de itens', String(r.items.reduce((s, i) => s + i.quantity, 0)), 's')}
    ${row('Subtotal', formatBRL(r.subtotalCents))}
    ${r.deliveryFeeCents > 0 ? row('Entrega', formatBRL(r.deliveryFeeCents)) : ''}
    ${r.discountCents > 0 ? row('Descontos', `-${formatBRL(r.discountCents)}`) : ''}
    ${row('VALOR A PAGAR', formatBRL(r.totalCents), 'b big')}
    ${row('FORMA DE PAGAMENTO', 'VALOR PAGO', 's b')}
    ${r.payments.map((p) => row(esc(p.label), formatBRL(p.amountCents))).join('')}
    ${r.changeCents > 0 ? row('Troco', formatBRL(r.changeCents), 'b') : ''}
    <hr>
    ${
      r.kind === 'NFCE' && f
        ? `${f.consultUrl ? `<div class="c s">Consulte pela chave de acesso em<br>${esc(f.consultUrl)}</div>` : ''}
           ${f.accessKey ? `<div class="c s b key">${formatAccessKey(f.accessKey)}</div>` : ''}
           <div class="c s b">${r.customer.document ? `CONSUMIDOR - ${r.customer.document.length === 14 ? 'CNPJ' : 'CPF'} ${formatDocument(r.customer.document)}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div>
           <div class="c s b">NFC-e nº ${String(f.number).padStart(9, '0')} Série ${String(f.series).padStart(3, '0')} ${when(f.authorizedAt ?? r.issuedAt)}</div>
           ${f.protocol ? `<div class="c s">Protocolo de autorização: ${esc(f.protocol)}</div>` : ''}
           ${qr ? `<div class="c"><img class="qr" src="${qr}" alt="QR Code da NFC-e"></div>` : ''}
           <hr>`
        : r.customer.name || r.customer.document
          ? `${r.customer.name ? `<div class="c s">Cliente: ${esc(r.customer.name)}</div>` : ''}${r.customer.document ? `<div class="c s">CPF/CNPJ: ${formatDocument(r.customer.document)}</div>` : ''}<hr>`
          : ''
    }
    ${r.footer ? `<div class="c s">${esc(r.footer)}</div>` : ''}
    <div class="c s">Delivery360</div>`;
  const copies = Array.from({ length: Math.max(1, r.copies) }, () => `<section>${one}</section>`).join('<div class="cut"></div>');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${r.kind === 'NFCE' ? 'NFC-e' : 'Cupom'} ${r.number}</title><style>
    @page { size: ${w}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; font-size: ${w === 58 ? 10 : 12}px; width: 100%; max-width: ${w - 4}mm; margin: 0; color: #000; }
    .c { text-align: center; } .b { font-weight: bold; } .s { font-size: ${w === 58 ? 9 : 10}px; } .big { font-size: ${w === 58 ? 12 : 14}px; }
    .row { display: flex; justify-content: space-between; gap: 6px; } .sub { padding-left: 10px; }
    .key { word-spacing: 2px; letter-spacing: .3px; } .c { overflow-wrap: anywhere; } .qr { width: ${w === 58 ? 30 : 38}mm; height: auto; margin: 4px auto; display: block; }
    hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; } .cut { page-break-after: always; height: 6mm; }
  </style></head><body>${copies}</body></html>`;
}

/** Imprime na térmica pela janela de impressão do navegador (escolha a impressora do caixa uma vez; o navegador lembra). */
export async function printReceipt(r: Receipt) {
  const html = await receiptHtml(r);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  // Espera o QR Code (imagem) carregar antes de imprimir.
  const img = doc.querySelector('img');
  if (img && !img.complete) await new Promise((res) => ((img.onload = res), (img.onerror = res)));
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 50);
}

/** Abre o cupom em PDF numa aba nova (para salvar, mandar por WhatsApp ou imprimir em impressora comum). */
export async function openReceiptPdf(orderId: string, kind?: 'NFCE' | 'NAO_FISCAL') {
  // Abre a aba já no clique (o navegador bloqueia pop-up aberto depois de esperar a rede).
  const tab = window.open('', '_blank');
  try {
    const url = await apiBlobUrl(`/cardapio/pdv/pedidos/${orderId}/cupom.pdf${kind ? `?tipo=${kind}` : ''}`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
