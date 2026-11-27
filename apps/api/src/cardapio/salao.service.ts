import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { serviceFee, type SalaoTable, type TabDetail } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { EventsService } from '../core/events.service';
import { BulkTablesDto, CloseTabDto, TableDto, TableOrderDto, UpdateTableDto } from './cardapio.dto';
import { OrdersService, trackingCode } from './orders.service';

/** Cliente único do salão: o pedido de mesa não tem telefone (o "cliente" é a mesa). */
const SALAO_CUSTOMER_KEY = 'salao';
const KITCHEN: OrderStatus[] = ['PAID', 'IN_PREPARATION'];

/**
 * Salão: o garçom lança os itens da mesa pelo celular, cada envio vira um pedido (rodada) que cai
 * na cozinha e na impressora como qualquer outro, e a conta da mesa soma as rodadas até o fechamento.
 *
 * A venda entra no financeiro só no fechamento (conta 1.1 Salão), já paga, com a forma de pagamento
 * escolhida. A taxa de serviço é da equipe: entra e sai do caixa fora da DRE (11.3 / 11.4).
 */
@Injectable()
export class SalaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Mesas ----------

  async listTables(tenantId: string, includeInactive = false): Promise<{ tables: SalaoTable[]; serviceFeeBps: number }> {
    const [tables, store] = await Promise.all([
      this.prisma.diningTable.findMany({
        where: { tenantId, ...(includeInactive ? {} : { active: true }) },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: {
          tabs: {
            where: { status: 'OPEN' },
            take: 1,
            include: { orders: { select: { status: true, totalCents: true } } },
          },
        },
      }),
      this.prisma.store.findUnique({ where: { tenantId }, select: { serviceFeeBps: true } }),
    ]);
    return {
      serviceFeeBps: store?.serviceFeeBps ?? 0,
      tables: tables.map((t) => {
        const tab = t.tabs[0];
        const live = tab?.orders.filter((o) => o.status !== 'CANCELLED') ?? [];
        return {
          id: t.id,
          name: t.name,
          position: t.position,
          active: t.active,
          tab: tab
            ? {
                id: tab.id,
                openedAt: tab.openedAt.toISOString(),
                people: tab.people,
                subtotalCents: live.reduce((s, o) => s + o.totalCents, 0),
                rounds: live.length,
                readyCount: live.filter((o) => o.status === 'READY').length,
                kitchenCount: live.filter((o) => KITCHEN.includes(o.status)).length,
              }
            : null,
        };
      }),
    };
  }

  async createTable(tenantId: string, dto: TableDto) {
    const name = dto.name.trim();
    const last = await this.prisma.diningTable.aggregate({ where: { tenantId }, _max: { position: true } });
    try {
      return await this.prisma.diningTable.create({ data: { tenantId, name, position: dto.position ?? (last._max.position ?? -1) + 1 } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe a mesa "${name}".`);
      throw e;
    }
  }

  /** "Mesa 1" até "Mesa N", em ordem; as que já existem ficam como estão. */
  async createTables(tenantId: string, dto: BulkTablesDto) {
    const prefix = (dto.prefix ?? 'Mesa').trim();
    const last = await this.prisma.diningTable.aggregate({ where: { tenantId }, _max: { position: true } });
    const start = (last._max.position ?? -1) + 1;
    await this.prisma.diningTable.createMany({
      data: Array.from({ length: dto.count }, (_, i) => ({ tenantId, name: `${prefix} ${i + 1}`, position: start + i })),
      skipDuplicates: true,
    });
    return this.listTables(tenantId, true);
  }

  async updateTable(tenantId: string, id: string, dto: UpdateTableDto) {
    const table = await this.prisma.diningTable.findFirst({ where: { id, tenantId }, include: { tabs: { where: { status: 'OPEN' }, take: 1 } } });
    if (!table) throw new NotFoundException('Mesa não encontrada.');
    if (dto.active === false && table.tabs.length) throw new ConflictException(`A ${table.name} está com a conta aberta. Feche a conta antes.`);
    try {
      return await this.prisma.diningTable.update({
        where: { id },
        data: { name: dto.name?.trim(), position: dto.position, active: dto.active },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe a mesa "${dto.name?.trim()}".`);
      throw e;
    }
  }

  /** Mesa sem histórico é apagada; com contas antigas só sai da tela (o histórico fica). */
  async deleteTable(tenantId: string, id: string) {
    const table = await this.prisma.diningTable.findFirst({ where: { id, tenantId }, include: { _count: { select: { tabs: true } }, tabs: { where: { status: 'OPEN' }, take: 1 } } });
    if (!table) throw new NotFoundException('Mesa não encontrada.');
    if (table.tabs.length) throw new ConflictException(`A ${table.name} está com a conta aberta. Feche a conta antes.`);
    if (table._count.tabs > 0) {
      await this.prisma.diningTable.update({ where: { id }, data: { active: false } });
      return { deleted: false, archived: true };
    }
    await this.prisma.diningTable.delete({ where: { id } });
    return { deleted: true, archived: false };
  }

  async setServiceFee(tenantId: string, bps: number) {
    await this.prisma.store.update({ where: { tenantId }, data: { serviceFeeBps: bps } });
    return { serviceFeeBps: bps };
  }

  // ---------- Pedido da mesa (rodada) ----------

  /** Lança uma rodada na mesa: abre a conta se for a primeira e manda o pedido para a cozinha. */
  async addOrder(tenantId: string, userId: string, tableId: string, dto: TableOrderDto) {
    if (!dto.items.length) throw new BadRequestException('Escolha pelo menos um item.');
    const table = await this.prisma.diningTable.findFirst({ where: { id: tableId, tenantId, active: true } });
    if (!table) throw new NotFoundException('Mesa não encontrada.');
    const store = await this.prisma.store.findUnique({ where: { tenantId }, select: { tenantId: true } });
    if (!store) throw new BadRequestException('Configure a loja em Cardápio e pedidos antes de usar o salão.');

    const { priced, costOf } = await this.orders.priceStaffItems(tenantId, dto.items);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const waiterName = user?.name.trim().split(/\s+/).slice(0, 2).join(' ') || null;

    const order = await this.orders.withOrderNumber(tenantId, async (tx, number) => {
      // Uma conta aberta por mesa (open_key único): dois garçons ao mesmo tempo caem na mesma conta.
      let tab = await tx.tableTab.findUnique({ where: { openKey: table.id } });
      if (!tab) {
        tab = await tx.tableTab.create({
          data: { tenantId, tableId: table.id, tableName: table.name, openKey: table.id, people: dto.people ?? null, openedById: userId },
        });
      } else if (dto.people && dto.people !== tab.people) {
        tab = await tx.tableTab.update({ where: { id: tab.id }, data: { people: dto.people } });
      }
      const customer = await tx.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: SALAO_CUSTOMER_KEY } },
        update: {},
        create: { tenantId, phone: SALAO_CUSTOMER_KEY, name: 'Salão' },
      });
      return tx.order.create({
        data: {
          tenantId,
          number,
          trackingCode: trackingCode(),
          customerId: customer.id,
          type: 'DINE_IN',
          status: 'PAID',
          channel: 'LOJA',
          customerName: tab.tableName,
          customerPhone: '',
          tabId: tab.id,
          tableName: tab.tableName,
          waiterName,
          notes: dto.notes?.trim() || null,
          subtotalCents: priced.subtotalCents,
          promoDiscountCents: priced.promoDiscountCents,
          deliveryFeeCents: 0,
          totalCents: priced.subtotalCents,
          // Provisório: a forma de pagamento de verdade é gravada no fechamento da conta.
          paymentMethod: 'CASH_ON_DELIVERY',
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
          statusHistory: { create: { status: 'PAID', userId, note: `${tab.tableName}${waiterName ? ` · ${waiterName}` : ''}` } },
        },
      });
    });
    return { orderId: order.id, number: order.number, tab: await this.tabDetail(tenantId, order.tabId!) };
  }

  /** O garçom levou à mesa: a rodada sai da tela (pronto → servido). */
  async markServed(tenantId: string, userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId, type: 'DINE_IN' }, select: { status: true } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status !== 'READY') throw new ConflictException('Só dá para marcar como servido quando a cozinha deixar pronto.');
    await this.orders.updateStatus(tenantId, userId, orderId, 'COMPLETED', 'Servido na mesa');
    return { ok: true };
  }

  // ---------- Conta ----------

  async openTabOf(tenantId: string, tableId: string) {
    const tab = await this.prisma.tableTab.findFirst({ where: { tenantId, openKey: tableId }, select: { id: true } });
    return tab ? this.tabDetail(tenantId, tab.id) : null;
  }

  async tabDetail(tenantId: string, tabId: string): Promise<TabDetail> {
    const [tab, store] = await Promise.all([
      this.prisma.tableTab.findFirst({
        where: { id: tabId, tenantId },
        include: { orders: { orderBy: { createdAt: 'asc' }, include: { items: { include: { options: true } } } } },
      }),
      this.prisma.store.findUnique({ where: { tenantId }, select: { serviceFeeBps: true } }),
    ]);
    if (!tab) throw new NotFoundException('Conta não encontrada.');
    const subtotalCents = tab.orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.totalCents, 0);
    const open = tab.status === 'OPEN';
    return {
      id: tab.id,
      tableId: tab.tableId,
      tableName: tab.tableName,
      status: tab.status,
      people: tab.people,
      openedAt: tab.openedAt.toISOString(),
      closedAt: tab.closedAt?.toISOString() ?? null,
      rounds: tab.orders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        waiterName: o.waiterName,
        createdAt: o.createdAt.toISOString(),
        notes: o.notes,
        totalCents: o.totalCents,
        items: o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, totalCents: i.totalCents, notes: i.notes, options: i.options.map((x) => ({ name: x.name })) })),
      })),
      subtotalCents: open ? subtotalCents : tab.subtotalCents,
      serviceFeeBps: store?.serviceFeeBps ?? 0,
      serviceFeeCents: open ? 0 : tab.serviceFeeCents,
      totalCents: open ? subtotalCents : tab.totalCents,
      paymentMethod: tab.paymentMethod,
    };
  }

  /**
   * Fecha a conta: grava a forma de pagamento em cada rodada, finaliza o que ainda estava aberto
   * (o cliente já está indo embora) e manda a venda para o financeiro. A mesa fica livre.
   */
  async closeTab(tenantId: string, userId: string, tabId: string, dto: CloseTabDto) {
    const tab = await this.prisma.tableTab.findFirst({ where: { id: tabId, tenantId }, include: { orders: true } });
    if (!tab) throw new NotFoundException('Conta não encontrada.');
    if (tab.status !== 'OPEN') throw new ConflictException('Esta conta já foi fechada.');
    const live = tab.orders.filter((o) => o.status !== 'CANCELLED');
    const subtotalCents = live.reduce((s, o) => s + o.totalCents, 0);
    if (subtotalCents > 0 && !dto.paymentMethod) throw new BadRequestException('Escolha a forma de pagamento.');
    const store = await this.prisma.store.findUnique({ where: { tenantId }, select: { serviceFeeBps: true } });
    const serviceFeeCents = dto.serviceFee ? serviceFee(subtotalCents, store?.serviceFeeBps ?? 0) : 0;
    const method = dto.paymentMethod ?? 'CASH_ON_DELIVERY';
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Condicional: se outro celular fechou a mesma conta antes, este para aqui.
      const { count } = await tx.tableTab.updateMany({
        where: { id: tabId, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          openKey: null,
          closedAt: now,
          closedById: userId,
          paymentMethod: subtotalCents > 0 ? method : null,
          subtotalCents,
          serviceFeeCents,
          totalCents: subtotalCents + serviceFeeCents,
        },
      });
      if (count === 0) throw new ConflictException('Esta conta acabou de ser fechada em outro aparelho.');
      for (const o of live) {
        await tx.order.update({ where: { id: o.id }, data: { paymentMethod: method, status: 'COMPLETED', deliveredAt: o.deliveredAt ?? now } });
        if (o.status !== 'COMPLETED') {
          await tx.orderStatusHistory.create({ data: { orderId: o.id, status: 'COMPLETED', userId, note: 'Conta da mesa fechada' } });
          await this.events.publish(tenantId, 'pedido.status', { orderId: o.id, from: o.status, to: 'COMPLETED', totalCents: o.totalCents }, tx);
        }
        await tx.payment.create({ data: { tenantId, orderId: o.id, provider: 'offline', method, status: 'PAID', amountCents: o.totalCents, paidAt: now } });
        await this.orders.publishReceived(tx, o.id, tenantId, o.totalCents, method);
      }
      if (serviceFeeCents > 0) {
        await this.events.publish(tenantId, 'salao.taxa_servico', { tabId, tableName: tab.tableName, amountCents: serviceFeeCents, paymentMethod: method }, tx);
      }
      await this.audit.log(
        { tenantId, userId, action: 'tab.close', entity: 'table_tab', entityId: tabId, after: { subtotalCents, serviceFeeCents, paymentMethod: method } },
        tx,
      );
    });
    return this.tabDetail(tenantId, tabId);
  }

  /** Contas fechadas hoje (para o caixa conferir). */
  async closedToday(tenantId: string) {
    const start = new Date();
    start.setHours(start.getHours() - 16);
    const tabs = await this.prisma.tableTab.findMany({
      where: { tenantId, status: 'CLOSED', closedAt: { gte: start } },
      orderBy: { closedAt: 'desc' },
      take: 100,
      select: { id: true, tableName: true, closedAt: true, totalCents: true, serviceFeeCents: true, paymentMethod: true, people: true },
    });
    return tabs.map((t) => ({ ...t, closedAt: t.closedAt?.toISOString() ?? null }));
  }
}
