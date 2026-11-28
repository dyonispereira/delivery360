import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Totem } from '@prisma/client';
import {
  PdvPaymentError,
  settlePayments,
  totemModes,
  totemTicket,
  TOTEM_PAY_HINT_LABELS,
  TOTEM_UNPAID_HOURS,
  type PublicTotem,
  type TotemOrderResult,
  type TotemPendingOrder,
  type TotemView,
} from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { EventsService } from '../core/events.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { normalizeDocument } from './document';
import { TotemDto, TotemOrderDto, TotemPayDto, UpdateTotemDto } from './cardapio.dto';
import { OrdersService, trackingCode } from './orders.service';
import { PdvService } from './pdv.service';

const TOTEM_CUSTOMER_KEY = 'totem';
const MAX_TOTEMS = 20;
const HINT_METHOD = { CARD: 'CARD_ON_DELIVERY', PIX: 'PIX', CASH: 'CASH_ON_DELIVERY' } as const;

/**
 * Totem de autoatendimento (modo real).
 *
 * O cliente monta o pedido no totem e recebe uma senha. Sem maquininha integrada: o pedido nasce
 * "aguardando pagamento" e o cliente paga no caixa (maquininha comum, Pix ou dinheiro). O caixa confirma
 * no PDV o que entrou de fato; só aí o pedido vai para o painel e a cozinha e entra no caixa (1.8 Balcão,
 * com "Totem" na descrição). Pedido não pago não entra em nada e some da lista depois de algumas horas.
 *
 * Criar o pedido é idempotente pela chave que a tela manda (requestKey): repetir devolve o mesmo pedido.
 */
@Injectable()
export class TotemService {
  private readonly log = new Logger(TotemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly pdv: PdvService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly fiscal: FiscalService,
  ) {}

  // ---------- Cadastro (painel) ----------

  private view(t: Totem): TotemView {
    return { id: t.id, name: t.name, active: t.active, eatIn: t.eatIn, takeaway: t.takeaway, createdAt: t.createdAt.toISOString() };
  }

  async list(tenantId: string) {
    const list = await this.prisma.totem.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return list.map((t) => this.view(t));
  }

  async create(tenantId: string, userId: string, dto: TotemDto) {
    if ((await this.prisma.totem.count({ where: { tenantId } })) >= MAX_TOTEMS) throw new BadRequestException(`Limite de ${MAX_TOTEMS} totens por loja.`);
    if (dto.eatIn === false && dto.takeaway === false) throw new BadRequestException('Deixe ligado pelo menos "Comer aqui" ou "Levar".');
    const t = await this.prisma.totem.create({ data: { tenantId, name: dto.name.trim(), active: dto.active ?? true, eatIn: dto.eatIn ?? true, takeaway: dto.takeaway ?? true } });
    await this.audit.log({ tenantId, userId, action: 'totem.create', entity: 'totem', entityId: t.id, after: this.view(t) });
    return this.view(t);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateTotemDto) {
    const before = await this.prisma.totem.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Totem não encontrado.');
    const eatIn = dto.eatIn ?? before.eatIn;
    const takeaway = dto.takeaway ?? before.takeaway;
    if (!eatIn && !takeaway) throw new BadRequestException('Deixe ligado pelo menos "Comer aqui" ou "Levar".');
    const t = await this.prisma.totem.update({ where: { id }, data: { name: dto.name?.trim() || before.name, active: dto.active ?? before.active, eatIn, takeaway } });
    await this.audit.log({ tenantId, userId, action: 'totem.update', entity: 'totem', entityId: id, before: this.view(before), after: this.view(t) });
    return this.view(t);
  }

  // ---------- Tela do totem (pública) ----------

  private async findTotem(slug: string, totemId: string) {
    const store = await this.orders.findPublicStore(slug);
    const totem = await this.prisma.totem.findFirst({ where: { id: totemId, tenantId: store.tenantId } });
    if (!totem) throw new NotFoundException('Totem não encontrado. Confira o endereço no painel (PDV > Totens).');
    return { store, totem };
  }

  async publicTotem(slug: string, totemId: string): Promise<PublicTotem> {
    const { totem } = await this.findTotem(slug, totemId);
    return { id: totem.id, name: totem.name, active: totem.active, modes: totemModes(totem) };
  }

  async createOrder(slug: string, totemId: string, dto: TotemOrderDto): Promise<TotemOrderResult> {
    const { store, totem } = await this.findTotem(slug, totemId);
    const tenantId = store.tenantId;
    const key = `totem:${totem.id}:${dto.requestKey}`;
    const existing = await this.findByKey(tenantId, key);
    if (existing) return existing;
    if (!totem.active) throw new BadRequestException('Este totem está desligado. Faça o pedido no caixa.');
    if (!store.isOpen) throw new BadRequestException('A loja está fechada agora.');
    if (!totemModes(totem).includes(dto.consumption)) throw new BadRequestException('Este totem não oferece esta opção de consumo.');

    const { priced, costOf } = await this.orders.priceStaffItems(tenantId, dto.items);
    const name = dto.customerName?.trim() || 'Totem';
    try {
      const order = await this.orders.withOrderNumber(tenantId, async (tx, number) => {
        const customer = await tx.customer.upsert({
          where: { tenantId_phone: { tenantId, phone: TOTEM_CUSTOMER_KEY } },
          update: {},
          create: { tenantId, phone: TOTEM_CUSTOMER_KEY, name: 'Totem' },
        });
        const ticket = totemTicket(number);
        return tx.order.create({
          data: {
            tenantId,
            number,
            trackingCode: trackingCode(),
            customerId: customer.id,
            type: 'COUNTER',
            status: 'AWAITING_PAYMENT',
            channel: 'LOJA',
            totemId: totem.id,
            consumption: dto.consumption,
            ticket,
            payHint: dto.payHint,
            requestKey: key,
            customerName: name,
            customerPhone: '',
            subtotalCents: priced.subtotalCents,
            promoDiscountCents: priced.promoDiscountCents,
            discountCents: 0,
            deliveryFeeCents: 0,
            totalCents: priced.subtotalCents,
            paymentMethod: HINT_METHOD[dto.payHint],
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
            statusHistory: { create: { status: 'AWAITING_PAYMENT', note: `Totem ${totem.name} · senha ${ticket} · vai pagar no caixa (${TOTEM_PAY_HINT_LABELS[dto.payHint]})` } },
          },
        });
      });
      return this.result(order);
    } catch (e) {
      // A mesma chave chegou duas vezes ao mesmo tempo: devolve o pedido que ficou.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.findByKey(tenantId, key);
        if (again) return again;
      }
      throw e;
    }
  }

  private async findByKey(tenantId: string, key: string) {
    const o = await this.prisma.order.findUnique({ where: { tenantId_requestKey: { tenantId, requestKey: key } } });
    return o ? this.result(o) : null;
  }

  private result(o: { number: number; ticket: string | null; totalCents: number; consumption: 'EAT_IN' | 'TAKEAWAY' | null }): TotemOrderResult {
    return { number: o.number, ticket: o.ticket ?? totemTicket(o.number), totalCents: o.totalCents, consumption: o.consumption ?? 'TAKEAWAY' };
  }

  // ---------- Caixa (PDV) ----------

  /** Pedidos do totem esperando o pagamento no caixa (das últimas horas). */
  async pending(tenantId: string): Promise<TotemPendingOrder[]> {
    const since = new Date(Date.now() - TOTEM_UNPAID_HOURS * 3600_000);
    const list = await this.prisma.order.findMany({
      where: { tenantId, totemId: { not: null }, status: 'AWAITING_PAYMENT', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { items: { include: { options: true } }, totem: { select: { name: true } } },
    });
    return list.map((o) => ({
      id: o.id,
      number: o.number,
      ticket: o.ticket ?? totemTicket(o.number),
      consumption: o.consumption,
      payHint: (o.payHint as TotemPendingOrder['payHint']) ?? null,
      totemName: o.totem?.name ?? null,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, options: i.options.map((x) => x.name), notes: i.notes })),
    }));
  }

  /**
   * O caixa recebeu: grava os pagamentos no caixa aberto (podem ser vários, com troco no dinheiro),
   * o pedido vai para a cozinha e o financeiro lança como uma venda de balcão (1.8). Pode emitir NFC-e.
   */
  async pay(tenantId: string, userId: string, orderId: string, dto: TotemPayDto) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId, totemId: { not: null } } });
    if (!order) throw new NotFoundException('Pedido do totem não encontrado.');
    if (order.status !== 'AWAITING_PAYMENT') throw new ConflictException(`O pedido #${order.number} já foi ${order.status === 'CANCELLED' ? 'cancelado' : 'pago'}.`);
    if (dto.receipt === 'NFCE' && !(await this.fiscal.canEmit(tenantId))) {
      throw new BadRequestException('A NFC-e não está configurada. Complete os Dados fiscais ou use o cupom não fiscal.');
    }
    let document: string | null = null;
    if (dto.document?.replace(/\D/g, '')) {
      document = normalizeDocument(dto.document);
      if (!document) throw new BadRequestException('CPF/CNPJ inválido. Confira os números.');
    }
    let settled;
    try {
      settled = settlePayments(order.totalCents, dto.payments);
    } catch (e) {
      if (e instanceof PdvPaymentError) throw new BadRequestException(e.message);
      throw e;
    }
    const byMethod = new Map<string, number>();
    for (const p of settled) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    const main = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0][0] as (typeof settled)[number]['method'];
    const cashier = (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name.trim().split(/\s+/).slice(0, 2).join(' ') || null;

    await this.prisma.$transaction(async (tx) => {
      const session = await this.pdv.lockOpen(tx, tenantId);
      // Condicional: dois caixas confirmando ao mesmo tempo, só um vence.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'AWAITING_PAYMENT' },
        data: { status: 'PAID', paymentMethod: main, waiterName: cashier, customerDocument: document },
      });
      if (!count) throw new ConflictException('Este pedido acabou de ser pago ou cancelado em outra tela.');
      await tx.counterPayment.createMany({
        data: settled.map((p) => ({ tenantId, orderId, sessionId: session.id, method: p.method, cardKind: p.cardKind, amountCents: p.amountCents, receivedCents: p.receivedCents, changeCents: p.changeCents, label: p.label })),
      });
      await tx.orderStatusHistory.create({ data: { orderId, status: 'PAID', userId, note: `Pago no caixa (totem)${cashier ? ` · ${cashier}` : ''}` } });
      await this.orders.publishReceived(tx, orderId, tenantId, order.totalCents, main);
      await this.events.publish(tenantId, 'pdv.venda_paga', { orderId }, tx);
      await this.audit.log({ tenantId, userId, action: 'totem.pay', entity: 'order', entityId: orderId, after: { number: order.number, payments: settled.map((p) => [p.key, p.amountCents, p.changeCents]) } }, tx);
    });

    let fiscalError: string | null = null;
    if (dto.receipt === 'NFCE') {
      try {
        const doc = await this.fiscal.emit(tenantId, userId, orderId, document);
        if (doc.status !== 'AUTHORIZED') fiscalError = doc.message ?? 'A nota ainda não foi autorizada.';
      } catch (e) {
        fiscalError = (e as Error).message;
        this.log.warn(`NFC-e do pedido ${order.number} (totem): ${fiscalError}`);
      }
    }
    const change = settled.reduce((s, p) => s + p.changeCents, 0);
    return { orderId, number: order.number, totalCents: order.totalCents, changeCents: change, fiscalError, receipt: await this.fiscal.receipt(tenantId, orderId) };
  }

  /** O cliente desistiu antes de pagar: o pedido sai da lista (não entrou no caixa nem no financeiro). */
  async cancelPending(tenantId: string, userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId, totemId: { not: null } } });
    if (!order) throw new NotFoundException('Pedido do totem não encontrado.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'AWAITING_PAYMENT' }, data: { status: 'CANCELLED' } });
      if (!count) throw new ConflictException('Só dá para descartar pedido do totem que ainda não foi pago.');
      await tx.orderStatusHistory.create({ data: { orderId, status: 'CANCELLED', userId, note: 'Totem: cliente não pagou' } });
      await this.audit.log({ tenantId, userId, action: 'totem.discard', entity: 'order', entityId: orderId, before: { status: order.status } }, tx);
    });
    return { ok: true };
  }
}
