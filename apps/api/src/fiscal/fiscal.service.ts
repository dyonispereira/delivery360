import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type FiscalSettings } from '@prisma/client';
import { orderOrigin, pdvPayLabel, type Receipt } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { normalizeDocument } from '../cardapio/document';
import { open, seal } from '../payments/secret-box';
import type { FiscalSettingsDto } from '../cardapio/cardapio.dto';
import { buildNfcePayload, FiscalError, TPAG, UF_CODES } from './nfce';
import { providerFor } from './nfce-provider';

type Db = Prisma.TransactionClient | PrismaService;

/** A SEFAZ só aceita cancelar a NFC-e até 30 minutos depois da autorização (na maioria dos estados). */
export const CANCEL_WINDOW_MIN = 30;

const ORDER_INCLUDE = {
  items: { include: { options: true } },
  counterPayments: { orderBy: { createdAt: 'asc' } },
  fiscalDocuments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

type OrderBase = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type ProductFiscal = { ncm: string | null; cfop: string | null; pdvCode: string | null } | null;
type OrderFull = Omit<OrderBase, 'items'> & { items: (OrderBase['items'][number] & { product: ProductFiscal })[] };

/**
 * NFC-e e cupom: dados fiscais da loja, emissão e cancelamento da nota, e o cupom (não fiscal ou NFC-e)
 * no formato que a impressora térmica e o PDF usam.
 */
@Injectable()
export class FiscalService {
  private readonly log = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Dados fiscais ----------

  async settings(tenantId: string) {
    const [s, tenant] = await Promise.all([
      this.prisma.fiscalSettings.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { cnpj: true, legalName: true, name: true } }),
    ]);
    const base = s ?? ({ ...defaults(), tenantId } as FiscalSettings);
    const { cscTokenEncrypted, ...rest } = base;
    return {
      ...rest,
      cnpj: base.cnpj ?? tenant?.cnpj ?? null,
      legalName: base.legalName ?? tenant?.legalName ?? tenant?.name ?? null,
      hasCscToken: !!cscTokenEncrypted,
      missing: missingFields({ ...base, cnpj: base.cnpj ?? tenant?.cnpj ?? null }),
      providerLabel: base.provider === 'simulado' ? 'Simulado (sem envio à SEFAZ)' : base.provider,
    };
  }

  async updateSettings(tenantId: string, userId: string, dto: FiscalSettingsDto) {
    const current = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
    const provider = current?.provider ?? 'simulado';
    if (dto.environment === 'PRODUCAO' && provider === 'simulado') {
      throw new BadRequestException('Para emitir em produção (nota com valor fiscal), é preciso ligar o emissor de NFC-e. Por enquanto use homologação.');
    }
    const { cscToken, ...data } = dto;
    const saved = await this.prisma.fiscalSettings.upsert({
      where: { tenantId },
      update: { ...data, ...(cscToken ? { cscTokenEncrypted: seal(cscToken) } : {}) },
      create: { tenantId, ...data, ...(cscToken ? { cscTokenEncrypted: seal(cscToken) } : {}) },
    });
    const { cscTokenEncrypted: _hidden, ...after } = saved;
    await this.audit.log({ tenantId, userId, action: 'fiscal.settings', entity: 'fiscal_settings', entityId: tenantId, after });
    return this.settings(tenantId);
  }

  /** A loja pode emitir NFC-e agora? (dados fiscais ligados e completos). */
  async canEmit(tenantId: string) {
    const s = await this.settings(tenantId);
    return s.enabled && s.missing.length === 0;
  }

  // ---------- Emissão ----------

  private async loadOrder(db: Db, tenantId: string, orderId: string): Promise<OrderFull> {
    const order = await db.order.findFirst({ where: { id: orderId, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const ids = order.items.map((i) => i.productId).filter((x): x is string => !!x);
    const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, ncm: true, cfop: true, pdvCode: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    return { ...order, items: order.items.map((i) => ({ ...i, product: (i.productId && byId.get(i.productId)) || null })) };
  }

  /**
   * Emite a NFC-e do pedido. Idempotente: se já tem nota autorizada (ou em processamento), devolve a mesma.
   * Nota recusada pela SEFAZ: emite de novo com o mesmo número (depois de corrigir o NCM, por exemplo).
   */
  async emit(tenantId: string, userId: string | null, orderId: string, documentRaw?: string | null) {
    const settings = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
    if (!settings?.enabled) throw new BadRequestException('Ligue a NFC-e em Dados fiscais antes de emitir.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { cnpj: true } });
    const cnpj = settings.cnpj ?? tenant?.cnpj ?? null;
    const missing = missingFields({ ...settings, cnpj });
    if (missing.length) throw new BadRequestException(`Complete os dados fiscais: ${missing.join(', ')}.`);

    const order = await this.loadOrder(this.prisma, tenantId, orderId);
    if (order.status === 'CANCELLED') throw new ConflictException('Pedido cancelado não tem nota.');
    if (order.status === 'AWAITING_PAYMENT') throw new ConflictException('O pedido ainda não foi pago.');
    if (order.type === 'DINE_IN') throw new ConflictException('A nota do salão sai pela conta da mesa (em breve).');
    if (order.channel !== 'LOJA') throw new ConflictException('Pedido de app: a nota é emitida pelo próprio app ou pelo restaurante no sistema do app.');
    const existing = order.fiscalDocuments.find((d) => d.status === 'AUTHORIZED' || d.status === 'PROCESSING');
    if (existing) return existing;

    let document: string | null = null;
    const rawDoc = documentRaw ?? order.customerDocument;
    if (rawDoc && rawDoc.replace(/\D/g, '')) {
      document = normalizeDocument(rawDoc);
      if (!document) throw new BadRequestException('CPF/CNPJ na nota inválido. Confira os números.');
    }

    const environment = settings.environment as 'HOMOLOGACAO' | 'PRODUCAO';
    const rejected = order.fiscalDocuments.find((d) => d.status === 'REJECTED' && d.environment === environment && d.series === settings.series);
    const issuedAt = new Date();
    let payload: ReturnType<typeof buildNfcePayload>;
    try {
      payload = buildNfcePayload({
        environment,
        cnpj: cnpj!,
        uf: settings.uf!,
        taxRegime: settings.taxRegime,
        csosn: settings.defaultCsosn,
        series: settings.series,
        number: rejected?.number ?? settings.nextNumber,
        issuedAt,
        presence: order.type === 'DELIVERY' ? 4 : 1,
        items: order.items.map((i) => ({
          code: i.product?.pdvCode || i.productId?.slice(0, 8) || 'ITEM',
          name: [i.name, ...i.options.map((o) => o.name)].join(' + '),
          ncm: i.product?.ncm || settings.defaultNcm,
          cfop: i.product?.cfop || settings.defaultCfop,
          quantity: i.quantity,
          totalCents: i.totalCents,
        })),
        discountCents: order.subtotalCents + order.deliveryFeeCents - order.totalCents,
        freightCents: order.deliveryFeeCents,
        payments: paymentsOf(order),
        changeCents: order.counterPayments.reduce((s, p) => s + p.changeCents, 0),
        document,
        customerName: order.customerName,
        origin: orderOrigin(order.type, order.channel),
      });
    } catch (e) {
      if (e instanceof FiscalError) throw new BadRequestException(e.message);
      throw e;
    }

    // Reserva o número (trava os dados fiscais: duas vendas ao mesmo tempo não pegam o mesmo número).
    const doc = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ next_number: number }[]>`SELECT next_number FROM fiscal_settings WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const again = await tx.fiscalDocument.findFirst({ where: { orderId, status: { in: ['AUTHORIZED', 'PROCESSING'] } } });
      if (again) return again;
      const data = {
        status: 'PROCESSING' as const,
        document,
        totalCents: payload.totalCents,
        payload: payload.body as unknown as Prisma.InputJsonValue,
        message: null,
      };
      if (rejected) return tx.fiscalDocument.update({ where: { id: rejected.id }, data });
      const number = row.next_number;
      (payload.body as { numero: number }).numero = number;
      await tx.fiscalSettings.update({ where: { tenantId }, data: { nextNumber: number + 1 } });
      return tx.fiscalDocument.create({
        data: {
          ...data,
          payload: payload.body as unknown as Prisma.InputJsonValue,
          tenantId,
          orderId,
          ref: `${tenantId.slice(0, 8)}-${environment[0]}${settings.series}-${number}`,
          provider: settings.provider,
          environment,
          series: settings.series,
          number,
        },
      });
    });
    if (doc.status !== 'PROCESSING') return doc;

    const provider = providerFor(settings.provider);
    let result;
    try {
      result = await provider.emit({
        ref: doc.ref,
        environment,
        uf: settings.uf!,
        cnpj: cnpj!,
        series: doc.series,
        number: doc.number,
        issuedAt,
        cscId: settings.cscId ?? '1',
        csc: settings.cscTokenEncrypted ? open(settings.cscTokenEncrypted) : '',
        body: doc.payload as Record<string, unknown>,
      });
    } catch (e) {
      // Sem resposta do emissor: fica "processando" e o caixa pode consultar/emitir de novo depois.
      this.log.warn(`NFC-e ${doc.ref}: emissor não respondeu (${(e as Error).message})`);
      return this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { message: 'O emissor não respondeu. Tente de novo em instantes.' } });
    }
    const saved = await this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        status: result.status,
        accessKey: result.accessKey ?? null,
        protocol: result.protocol ?? null,
        qrCodeUrl: result.qrCodeUrl ?? null,
        consultUrl: result.consultUrl ?? null,
        message: result.message ?? null,
        authorizedAt: result.authorizedAt ?? null,
      },
    });
    await this.audit.log({ tenantId, userId, action: 'fiscal.nfce_emit', entity: 'order', entityId: orderId, after: { ref: saved.ref, number: saved.number, status: saved.status, accessKey: saved.accessKey } });
    return saved;
  }

  /** Cancela a NFC-e autorizada (até 30 minutos depois, com justificativa de 15 a 255 letras). */
  async cancel(tenantId: string, userId: string, orderId: string, reason: string, db: Db = this.prisma) {
    const doc = await db.fiscalDocument.findFirst({ where: { tenantId, orderId, status: 'AUTHORIZED' } });
    if (!doc) return null;
    const minutes = (Date.now() - (doc.authorizedAt ?? doc.createdAt).getTime()) / 60_000;
    if (minutes > CANCEL_WINDOW_MIN) {
      throw new ConflictException(`A NFC-e só pode ser cancelada até ${CANCEL_WINDOW_MIN} minutos depois de emitida. Fale com o contador para fazer a devolução.`);
    }
    if (reason.trim().length < 15) throw new BadRequestException('Explique o motivo do cancelamento com pelo menos 15 letras.');
    const r = await providerFor(doc.provider).cancel({ ref: doc.ref, accessKey: doc.accessKey ?? '', reason: reason.trim() });
    if (!r.ok) throw new ConflictException(r.message ?? 'A SEFAZ não aceitou o cancelamento.');
    const saved = await db.fiscalDocument.update({ where: { id: doc.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim(), message: r.message ?? null } });
    await this.audit.log({ tenantId, userId, action: 'fiscal.nfce_cancel', entity: 'order', entityId: orderId, after: { ref: doc.ref, reason } }, db);
    return saved;
  }

  /** Notas emitidas (mais novas primeiro). */
  async list(tenantId: string, limit = 100) {
    const docs = await this.prisma.fiscalDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { order: { select: { number: true, type: true, customerName: true } } },
    });
    return docs.map(({ payload: _p, ...d }) => d);
  }

  // ---------- Cupom ----------

  /** Cupom do pedido: NFC-e se tiver nota (autorizada ou cancelada), senão cupom não fiscal. */
  async receipt(tenantId: string, orderId: string, kind?: 'NAO_FISCAL' | 'NFCE'): Promise<Receipt> {
    const [order, store, settings, tenant] = await Promise.all([
      this.loadOrder(this.prisma, tenantId, orderId),
      this.prisma.store.findUnique({ where: { tenantId } }),
      this.prisma.fiscalSettings.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, legalName: true, cnpj: true, phone: true } }),
    ]);
    const doc = order.fiscalDocuments.find((d) => d.status !== 'REJECTED') ?? null;
    const useFiscal = kind ? kind === 'NFCE' && !!doc : !!doc;
    const payments = order.counterPayments.length
      ? order.counterPayments.map((p) => ({ label: `${pdvPayLabel(p.method, p.cardKind)}${p.label ? ` (${p.label})` : ''}`, amountCents: p.amountCents + p.changeCents }))
      : order.type === 'DINE_IN'
        ? []
        : [{ label: pdvPayLabel(order.paymentMethod), amountCents: order.totalCents }];
    return {
      kind: useFiscal ? 'NFCE' : 'NAO_FISCAL',
      orderId: order.id,
      origin: orderOrigin(order.type, order.channel),
      number: order.number,
      test: useFiscal ? doc!.environment !== 'PRODUCAO' : false,
      store: {
        name: store?.displayName ?? tenant?.name ?? '',
        legalName: settings?.legalName ?? tenant?.legalName ?? null,
        cnpj: settings?.cnpj ?? tenant?.cnpj ?? null,
        stateRegistration: settings?.stateRegistration ?? null,
        address: store?.city ?? null,
        phone: store?.whatsapp ?? tenant?.phone ?? null,
      },
      issuedAt: (useFiscal ? doc!.authorizedAt ?? doc!.createdAt : order.createdAt).toISOString(),
      customer: { name: order.type === 'COUNTER' && order.customerName === 'Balcão' ? null : order.customerName, document: (useFiscal ? doc!.document : null) ?? order.customerDocument },
      items: order.items.map((i) => ({
        code: i.product?.pdvCode || '',
        name: i.name,
        quantity: i.quantity,
        unitCents: Math.round(i.totalCents / i.quantity),
        totalCents: i.totalCents,
        options: i.options.map((o) => o.name),
      })),
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      discountCents: order.subtotalCents + order.deliveryFeeCents - order.totalCents,
      totalCents: order.totalCents,
      payments,
      changeCents: order.counterPayments.reduce((s, p) => s + p.changeCents, 0),
      fiscal:
        useFiscal && doc
          ? {
              status: doc.status,
              series: doc.series,
              number: doc.number,
              accessKey: doc.accessKey,
              protocol: doc.protocol,
              authorizedAt: doc.authorizedAt?.toISOString() ?? null,
              qrCodeUrl: doc.qrCodeUrl,
              consultUrl: doc.consultUrl,
              message: doc.message,
            }
          : null,
      footer: store?.receiptFooter || null,
      widthMm: store?.receiptWidthMm ?? 80,
      copies: store?.receiptCopies ?? 1,
    };
  }
}

function defaults() {
  return {
    enabled: false,
    provider: 'simulado',
    environment: 'HOMOLOGACAO',
    cnpj: null,
    stateRegistration: null,
    legalName: null,
    uf: null,
    taxRegime: 1,
    cscId: null,
    cscTokenEncrypted: null,
    series: 1,
    nextNumber: 1,
    defaultNcm: '21069090',
    defaultCfop: '5102',
    defaultCsosn: '102',
    pdvReceipt: 'NAO_FISCAL',
    updatedAt: new Date(0),
  };
}

/** O que falta preencher para emitir (nomes como aparecem na tela). */
export function missingFields(s: { cnpj: string | null; uf: string | null; stateRegistration: string | null; cscId: string | null; cscTokenEncrypted: string | null; provider: string }) {
  const out: string[] = [];
  if (!s.cnpj || s.cnpj.replace(/\D/g, '').length !== 14) out.push('CNPJ');
  if (!s.stateRegistration) out.push('inscrição estadual');
  if (!s.uf || !UF_CODES[s.uf]) out.push('UF');
  // No simulado o CSC é opcional (o QR Code sai com um CSC de teste).
  if (s.provider !== 'simulado' && (!s.cscId || !s.cscTokenEncrypted)) out.push('CSC (ID e código)');
  return out;
}

function paymentsOf(order: OrderFull) {
  if (order.counterPayments.length) {
    return order.counterPayments.map((p) => ({
      tPag: p.method === 'CASH_ON_DELIVERY' ? TPAG.CASH : p.method === 'PIX' ? TPAG.PIX : p.cardKind === 'DEBIT' ? TPAG.DEBIT : TPAG.CREDIT,
      amountCents: p.amountCents,
    }));
  }
  const tPag = { PIX: TPAG.PIX, CREDIT_CARD: TPAG.CREDIT, CASH_ON_DELIVERY: TPAG.CASH, CARD_ON_DELIVERY: TPAG.CREDIT, APP_ONLINE: TPAG.OTHER }[order.paymentMethod];
  return [{ tPag, amountCents: order.totalCents }];
}
