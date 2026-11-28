import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatAccessKey, formatBRL, formatDocument, type Receipt } from '@delivery360/shared';

const MM = 72 / 25.4;
const brDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Cupom em PDF, na largura do papel da térmica (58 ou 80 mm), com o mesmo conteúdo da impressão.
 * NFC-e: segue o leiaute do DANFE NFC-e (emitente, itens, totais, pagamentos, consulta, chave, QR Code, consumidor, protocolo).
 */
export async function receiptPdf(r: Receipt): Promise<Buffer> {
  const width = r.widthMm * MM;
  const margin = 3 * MM;
  const inner = width - margin * 2;
  const small = r.widthMm === 58 ? 6.5 : 7.5;
  const normal = r.widthMm === 58 ? 7.5 : 8.5;
  const qr = r.fiscal?.qrCodeUrl ? await QRCode.toBuffer(r.fiscal.qrCodeUrl, { margin: 0, width: 300, errorCorrectionLevel: 'M' }) : null;

  // O papel da térmica é contínuo: desenha uma vez numa folha comprida para medir e depois na altura exata.
  const measure = new PDFDocument({ size: [width, 20_000], margin, autoFirstPage: true });
  draw(measure);
  const height = Math.ceil(measure.y + margin);
  measure.end();

  const doc = new PDFDocument({ size: [width, height], margin, info: { Title: `${r.kind === 'NFCE' ? 'NFC-e' : 'Cupom'} ${r.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;

  function draw(doc: PDFKit.PDFDocument) {

  const center = (t: string, size = normal, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(t, { width: inner, align: 'center' });
  const row = (left: string, right: string, size = normal, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const y = doc.y;
    doc.text(left, margin, y, { width: inner * 0.7 });
    const after = doc.y;
    doc.text(right, margin, y, { width: inner, align: 'right' });
    doc.y = Math.max(after, doc.y);
  };
  const hr = () => {
    doc.moveDown(0.2);
    doc.moveTo(margin, doc.y).lineTo(width - margin, doc.y).dash(1.5, { space: 1.5 }).lineWidth(0.5).stroke().undash();
    doc.moveDown(0.3);
  };

  center(r.store.name, normal + 2, true);
  if (r.store.legalName && r.store.legalName !== r.store.name) center(r.store.legalName, small);
  if (r.store.cnpj) center(`CNPJ ${formatDocument(r.store.cnpj)}${r.store.stateRegistration ? `  IE ${r.store.stateRegistration}` : ''}`, small);
  if (r.store.address) center(r.store.address, small);
  hr();
  if (r.kind === 'NFCE') {
    center('Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', small, true);
    if (r.test) center('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL', small, true);
    if (r.fiscal?.status === 'CANCELLED') center('NFC-e CANCELADA', normal + 2, true);
  } else {
    center('CUPOM NÃO FISCAL', normal + 1, true);
    center('Não é documento fiscal', small);
  }
  center(`Pedido #${r.number} · ${brDateTime(r.issuedAt)}`, small);
  center(`Origem: ${r.origin}`, normal, true);
  hr();

  doc.font('Helvetica-Bold').fontSize(small).text('Item', margin, doc.y, { continued: false });
  for (const i of r.items) {
    row(`${i.quantity}x ${i.name}`, formatBRL(i.totalCents), normal);
    for (const o of i.options) doc.font('Helvetica').fontSize(small).text(`   + ${o}`, margin, doc.y, { width: inner });
  }
  hr();
  row(`Qtde. total de itens`, String(r.items.reduce((s, i) => s + i.quantity, 0)), small);
  row('Subtotal', formatBRL(r.subtotalCents), normal);
  if (r.deliveryFeeCents > 0) row('Entrega', formatBRL(r.deliveryFeeCents), normal);
  if (r.discountCents > 0) row('Descontos', `-${formatBRL(r.discountCents)}`, normal);
  row('VALOR A PAGAR', formatBRL(r.totalCents), normal + 2, true);
  doc.moveDown(0.2);
  row('FORMA DE PAGAMENTO', 'VALOR PAGO', small, true);
  for (const p of r.payments) row(p.label, formatBRL(p.amountCents), normal);
  if (r.changeCents > 0) row('Troco', formatBRL(r.changeCents), normal, true);
  hr();

  if (r.kind === 'NFCE' && r.fiscal) {
    const f = r.fiscal;
    if (f.consultUrl) {
      center('Consulte pela chave de acesso em', small);
      center(f.consultUrl, small);
    }
    if (f.accessKey) center(formatAccessKey(f.accessKey), small, true);
    doc.moveDown(0.3);
    center(r.customer.document ? `CONSUMIDOR - ${r.customer.document.length === 14 ? 'CNPJ' : 'CPF'} ${formatDocument(r.customer.document)}` : 'CONSUMIDOR NÃO IDENTIFICADO', small, true);
    doc.moveDown(0.3);
    center(`NFC-e nº ${String(f.number).padStart(9, '0')}  Série ${String(f.series).padStart(3, '0')}  ${brDateTime(f.authorizedAt ?? r.issuedAt)}`, small, true);
    if (f.protocol) center(`Protocolo de autorização: ${f.protocol}`, small);
    if (f.authorizedAt) center(`Data de autorização: ${brDateTime(f.authorizedAt)}`, small);
    if (qr) {
      const size = Math.min(inner * 0.6, 38 * MM);
      doc.moveDown(0.4);
      doc.image(qr, margin + (inner - size) / 2, doc.y, { width: size, height: size });
      doc.y += size + 4;
    }
    hr();
  } else if (r.customer.name || r.customer.document) {
    if (r.customer.name) center(`Cliente: ${r.customer.name}`, small);
    if (r.customer.document) center(`CPF/CNPJ: ${formatDocument(r.customer.document)}`, small);
    hr();
  }
  if (r.footer) center(r.footer, small);
  center('Delivery360', small);
  }
}
