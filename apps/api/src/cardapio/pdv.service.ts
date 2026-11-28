import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type CashSession } from '@prisma/client';
import { pdvPayLabel, PdvPaymentError, settlePayments, type CashSessionView, type CashSummary, type PdvSaleRow } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { EventsService } from '../core/events.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { normalizeDocument } from './document';
import { CashMovementDto, CloseCashDto, OpenCashDto, PdvSaleDto } from './cardapio.dto';
import { OrdersService, trackingCode } from './orders.service';
import { refundOrderPoints } from './loyalty.service';

type Db = Prisma.TransactionClient | PrismaService;
const BALCAO_CUSTOMER_KEY = 'balcao';
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const CASH = 'CASH_ON_DELIVERY';

/**
 * PDV (venda de balcão) e caixa.
 *
 * O caixa abre com o fundo de troco; cada venda do balcão é um pedido COUNTER pago na hora (pode dividir
 * em várias formas, com troco no dinheiro). Vai para a cozinha ou sai entregue na hora. O cupom pode ser
 * não fiscal ou NFC-e. No fechamento o caixa conta a gaveta e o sistema mostra a diferença.
 *
 * Financeiro: cada pagamento entra no caixa (1.8 Balcão) com a sua forma, pelo valor que entrou de fato.
 */
@Injectable()
export class PdvService {
  private readonly log = new Logger(PdvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalService,
  ) {}

  private async userName(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return u?.name.trim().split(/\s+/).slice(0, 2).join(' ') || null;
  }

  // ---------- Caixa ----------

  async current(tenantId: string): Promise<CashSessionView | null> {
    const s = await this.prisma.cashSession.findUnique({ where: { openKey: tenantId } });
    return s ? this.view(this.prisma, s) : null;
  }

  async open(tenantId: string, userId: string, dto: OpenCashDto) {
    const name = await this.userName(userId);
    try {
      const s = await this.prisma.cashSession.create({
        data: { tenantId, openKey: tenantId, openingCents: dto.openingCents, openedById: userId, openedByName: name },
      });
      await this.audit.log({ tenantId, userId, action: 'cash.open', entity: 'cash_session', entityId: s.id, after: { openingCents: dto.openingCents } });
      return this.view(this.prisma, s);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('O caixa já está aberto.');
      throw e;
    }
  }

  private async lockOpen(tx: Prisma.TransactionClient, tenantId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cash_sessions WHERE open_key = ${tenantId}::uuid FOR UPDATE`;
    if (!rows.length) throw new ConflictException('Abra o caixa antes.');
    return tx.cashSession.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  /** Sangria (tirar dinheiro da gaveta) ou suprimento (colocar troco). */
  async movement(tenantId: string, userId: string, dto: CashMovementDto) {
    const name = await this.userName(userId);
    const session = await this.prisma.$transaction(async (tx) => {
      const s = await this.lockOpen(tx, tenantId);
      if (dto.kind === 'SANGRIA') {
        const sum = await this.summary(tx, s);
        if (dto.amountCents > sum.expectedCashCents) {
          throw new BadRequestException(`A gaveta deveria ter ${brl(sum.expectedCashCents)} em dinheiro. Não dá para tirar ${brl(dto.amountCents)}.`);
        }
      }
      await tx.cashMovement.create({ data: { tenantId, sessionId: s.id, kind: dto.kind, amountCents: dto.amountCents, reason: dto.reason?.trim() || null, userId, userName: name } });
      await this.audit.log({ tenantId, userId, action: `cash.${dto.kind.toLowerCase()}`, entity: 'cash_session', entityId: s.id, after: { amountCents: dto.amountCents, reason: dto.reason } }, tx);
      return s;
    });
    return this.view(this.prisma, session);
  }

  /** Fecha o caixa: grava a contagem, o esperado e a diferença, e congela o resumo. */
  async close(tenantId: string, userId: string, dto: CloseCashDto) {
    const name = await this.userName(userId);
    const closed = await this.prisma.$transaction(async (tx) => {
      const s = await this.lockOpen(tx, tenantId);
      const now = new Date();
      const summary = await this.summary(tx, s, now);
      const difference = dto.countedCents - summary.expectedCashCents;
      const done = await tx.cashSession.update({
        where: { id: s.id },
        data: {
          status: 'CLOSED',
          openKey: null,
          closedAt: now,
          closedById: userId,
          closedByName: name,
          countedCents: dto.countedCents,
          expectedCents: summary.expectedCashCents,
          differenceCents: difference,
          notes: dto.notes?.trim() || null,
          summary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.log({ tenantId, userId, action: 'cash.close', entity: 'cash_session', entityId: s.id, after: { countedCents: dto.countedCents, expectedCents: summary.expectedCashCents, differenceCents: difference } }, tx);
      return done;
    });
    return this.view(this.prisma, closed);
  }

  async history(tenantId: string) {
    const list = await this.prisma.cashSession.findMany({ where: { tenantId }, orderBy: { openedAt: 'desc' }, take: 30 });
    return Promise.all(list.map((s) => this.view(this.prisma, s)));
  }

  async session(tenantId: string, id: string) {
    const s = await this.prisma.cashSession.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Caixa não encontrado.');
    return this.view(this.prisma, s);
  }

  private async view(db: Db, s: CashSession): Promise<CashSessionView> {
    const [movements, summary] = await Promise.all([
      db.cashMovement.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } }),
      s.status === 'CLOSED' && s.summary ? Promise.resolve(s.summary as unknown as CashSummary) : this.summary(db, s),
    ]);
    return {
      id: s.id,
      status: s.status,
      openedAt: s.openedAt.toISOString(),
      openedByName: s.openedByName,
      closedAt: s.closedAt?.toISOString() ?? null,
      closedByName: s.closedByName,
      countedCents: s.countedCents,
      expectedCents: s.expectedCents,
      differenceCents: s.differenceCents,
      notes: s.notes,
      summary,
      movements: movements.map((m) => ({ id: m.id, kind: m.kind, amountCents: m.amountCents, reason: m.reason, userName: m.userName, createdAt: m.createdAt.toISOString() })),
    };
  }

  /** Vendas do balcão e pagamentos do salão no período do caixa, por forma de pagamento. */
  private async summary(db: Db, s: CashSession, until = new Date()): Promise<CashSummary> {
    const [pdv, tabPays, movements, cancelled] = await Promise.all([
      db.counterPayment.findMany({ where: { sessionId: s.id, order: { status: { not: 'CANCELLED' } } }, select: { orderId: true, method: true, cardKind: true, amountCents: true, changeCents: true } }),
      db.tabPayment.findMany({ where: { tenantId: s.tenantId, createdAt: { gte: s.openedAt, lte: s.closedAt ?? until } }, select: { method: true, amountCents: true } }),
      db.cashMovement.findMany({ where: { sessionId: s.id }, select: { kind: true, amountCents: true } }),
      db.order.count({ where: { tenantId: s.tenantId, type: 'COUNTER', status: 'CANCELLED', counterPayments: { some: { sessionId: s.id } } } }),
    ]);
    const rows = new Map<string, { label: string; pdvCents: number; salaoCents: number; totalCents: number }>();
    const add = (label: string, pdvCents: number, salaoCents: number) => {
      const r = rows.get(label) ?? { label, pdvCents: 0, salaoCents: 0, totalCents: 0 };
      r.pdvCents += pdvCents;
      r.salaoCents += salaoCents;
      r.totalCents += pdvCents + salaoCents;
      rows.set(label, r);
    };
    for (const p of pdv) add(pdvPayLabel(p.method, p.cardKind), p.amountCents, 0);
    for (const p of tabPays) add(p.method === CASH ? 'Dinheiro' : p.method === 'PIX' ? 'Pix' : 'Cartão (salão)', 0, p.amountCents);
    const order = ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Cartão (salão)'];
    const byMethod = [...rows.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    const cashSalesCents = pdv.filter((p) => p.method === CASH).reduce((t, p) => t + p.amountCents, 0) + tabPays.filter((p) => p.method === CASH).reduce((t, p) => t + p.amountCents, 0);
    const suprimentoCents = movements.filter((m) => m.kind === 'SUPRIMENTO').reduce((t, m) => t + m.amountCents, 0);
    const sangriaCents = movements.filter((m) => m.kind === 'SANGRIA').reduce((t, m) => t + m.amountCents, 0);
    const salesCents = pdv.reduce((t, p) => t + p.amountCents, 0);
    return {
      openingCents: s.openingCents,
      byMethod,
      salesCount: new Set(pdv.map((p) => p.orderId)).size,
      salesCents,
      cancelledCount: cancelled,
      cashSalesCents,
      changeCents: pdv.reduce((t, p) => t + p.changeCents, 0),
      suprimentoCents,
      sangriaCents,
      expectedCashCents: s.openingCents + cashSalesCents + suprimentoCents - sangriaCents,
    };
  }

  // ---------- Venda ----------

  /**
   * Fecha uma venda de balcão: confere preço (o do servidor) e pagamentos, grava o pedido já pago e,
   * se pedido, emite a NFC-e. A venda vale mesmo se a nota falhar (o caixa emite de novo depois).
   */
  async sale(tenantId: string, userId: string, dto: PdvSaleDto) {
    if (!dto.items.length) throw new BadRequestException('Adicione pelo menos um item.');
    const store = await this.prisma.store.findUnique({ where: { tenantId }, select: { tenantId: true } });
    if (!store) throw new BadRequestException('Configure a loja em Cardápio e pedidos antes de usar o PDV.');
    if (dto.receipt === 'NFCE' && !(await this.fiscal.canEmit(tenantId))) {
      throw new BadRequestException('A NFC-e não está configurada. Complete os Dados fiscais ou use o cupom não fiscal.');
    }
    let document: string | null = null;
    if (dto.document?.replace(/\D/g, '')) {
      document = normalizeDocument(dto.document);
      if (!document) throw new BadRequestException('CPF/CNPJ inválido. Confira os números.');
    }
    const { priced, costOf } = await this.orders.priceStaffItems(tenantId, dto.items);
    const discountCents = dto.discountCents ?? 0;
    if (discountCents > priced.subtotalCents) throw new BadRequestException('O desconto passa do valor dos itens.');
    const totalCents = priced.subtotalCents - discountCents;
    let settled;
    try {
      settled = settlePayments(totalCents, dto.payments);
    } catch (e) {
      if (e instanceof PdvPaymentError) throw new BadRequestException(e.message);
      throw e;
    }
    const byMethod = new Map<string, number>();
    for (const p of settled) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    const main = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0][0] as (typeof settled)[number]['method'];
    const cashier = await this.userName(userId);
    const status = dto.kitchen ? 'PAID' : 'COMPLETED';
    const now = new Date();

    const order = await this.orders.withOrderNumber(tenantId, async (tx, number) => {
      const session = await this.lockOpen(tx, tenantId);
      const customer = await tx.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: BALCAO_CUSTOMER_KEY } },
        update: {},
        create: { tenantId, phone: BALCAO_CUSTOMER_KEY, name: 'Balcão' },
      });
      const created = await tx.order.create({
        data: {
          tenantId,
          number,
          trackingCode: trackingCode(),
          customerId: customer.id,
          type: 'COUNTER',
          status,
          channel: 'LOJA',
          customerName: dto.customerName?.trim() || 'Balcão',
          customerPhone: '',
          customerDocument: document,
          waiterName: cashier,
          notes: dto.notes?.trim() || null,
          subtotalCents: priced.subtotalCents,
          promoDiscountCents: priced.promoDiscountCents,
          discountCents,
          deliveryFeeCents: 0,
          totalCents,
          paymentMethod: main,
          deliveredAt: dto.kitchen ? null : now,
          items: {
            create: priced.items.map((i) => ({
              productId: i.productId,
              name: i.name,
              unitPriceCents: i.unitPriceCents,
              listUnitPriceCents: i.listUnitPriceCents,
              unitCostCents: costOf(i.productId, i.options.map((o) => o.optionId)),
              quantity: i.quantity,
              notes: i.notes,
              totalCents: i.totalCents,
              options: { create: i.options.map((o) => ({ optionId: o.optionId, groupName: o.groupName, name: o.name, priceCents: o.priceCents })) },
            })),
          },
          counterPayments: {
            create: settled.map((p) => ({ tenantId, sessionId: session.id, method: p.method, cardKind: p.cardKind, amountCents: p.amountCents, receivedCents: p.receivedCents, changeCents: p.changeCents, label: p.label })),
          },
          statusHistory: {
            create: [
              { status: 'PAID', userId, note: `Balcão${cashier ? ` · ${cashier}` : ''}` },
              ...(dto.kitchen ? [] : [{ status: 'COMPLETED' as const, userId, note: 'Entregue no balcão' }]),
            ],
          },
        },
      });
      await this.orders.publishReceived(tx, created.id, tenantId, totalCents, main);
      await this.events.publish(tenantId, 'pdv.venda_paga', { orderId: created.id }, tx);
      if (!dto.kitchen) await this.events.publish(tenantId, 'pedido.status', { orderId: created.id, from: 'PAID', to: 'COMPLETED', totalCents }, tx);
      await this.audit.log({ tenantId, userId, action: 'pdv.sale', entity: 'order', entityId: created.id, after: { number, totalCents, discountCents, payments: settled.map((p) => [p.key, p.amountCents, p.changeCents]) } }, tx);
      return created;
    });

    let fiscalError: string | null = null;
    if (dto.receipt === 'NFCE') {
      try {
        const doc = await this.fiscal.emit(tenantId, userId, order.id, document);
        if (doc.status !== 'AUTHORIZED') fiscalError = doc.message ?? 'A nota ainda não foi autorizada.';
      } catch (e) {
        fiscalError = (e as Error).message;
        this.log.warn(`NFC-e do pedido ${order.number}: ${fiscalError}`);
      }
    }
    const change = settled.reduce((s, p) => s + p.changeCents, 0);
    return { orderId: order.id, number: order.number, totalCents, changeCents: change, fiscalError, receipt: await this.fiscal.receipt(tenantId, order.id) };
  }

  /** Vendas do caixa aberto (ou das últimas 16 horas). */
  async sales(tenantId: string, sessionId?: string): Promise<PdvSaleRow[]> {
    const session = sessionId
      ? await this.prisma.cashSession.findFirst({ where: { id: sessionId, tenantId } })
      : await this.prisma.cashSession.findUnique({ where: { openKey: tenantId } });
    const since = new Date(Date.now() - 16 * 3600_000);
    const orders = await this.prisma.order.findMany({
      where: { tenantId, type: 'COUNTER', ...(session ? { counterPayments: { some: { sessionId: session.id } } } : { createdAt: { gte: since } }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { counterPayments: true, fiscalDocuments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      totalCents: o.totalCents,
      customerName: o.customerName,
      payments: o.counterPayments.map((p) => `${pdvPayLabel(p.method, p.cardKind)}${p.label ? ` (${p.label})` : ''}`).join(' + '),
      receipt: o.fiscalDocuments[0] && o.fiscalDocuments[0].status !== 'REJECTED' ? 'NFCE' : 'NAO_FISCAL',
      fiscalStatus: o.fiscalDocuments[0]?.status ?? null,
    }));
  }

  /**
   * Cancela a venda de balcão (o dinheiro volta ao cliente na hora): cancela a NFC-e se tiver
   * (até 30 min), tira a venda do caixa e do financeiro.
   */
  async cancelSale(tenantId: string, userId: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId, type: 'COUNTER' } });
    if (!order) throw new NotFoundException('Venda não encontrada.');
    if (order.status === 'CANCELLED') throw new ConflictException('Esta venda já foi cancelada.');
    // A nota primeiro: se a SEFAZ não deixar (passou de 30 min), a venda continua de pé.
    await this.fiscal.cancel(tenantId, userId, orderId, reason);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: 'CANCELLED' } });
      if (!count) throw new ConflictException('A venda acabou de mudar em outra tela. Confira e tente de novo.');
      await tx.orderStatusHistory.create({ data: { orderId, status: 'CANCELLED', userId, note: reason.trim() } });
      await this.events.publish(tenantId, 'pedido.cancelado', { orderId, from: order.status, to: 'CANCELLED', totalCents: order.totalCents }, tx);
      await refundOrderPoints(tx, orderId);
      await this.audit.log({ tenantId, userId, action: 'pdv.cancel', entity: 'order', entityId: orderId, before: { status: order.status }, after: { reason } }, tx);
    });
    return { ok: true };
  }
}
