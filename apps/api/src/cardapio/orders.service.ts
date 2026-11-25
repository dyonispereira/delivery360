import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../core/events.service';
import { activeModuleCodes } from '../access/access.rules';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway';
import { CreateOrderDto, RateOrderDto, TipDto } from './cardapio.dto';
import { unitCost, type CostItem } from '@delivery360/shared';
import { MenuProduct, OrderValidationError, normalizePhone, priceOrder } from './order-pricing';
import { ACTIVE_STATUSES, canTransition } from './order-status';
import { AuditService } from '../core/audit.service';
import { closeBatchIfDone } from '../entregas/batch-utils';

/** Pagamentos que dependem de confirmação do gateway antes de o pedido entrar na operação. */
const ONLINE_METHODS: PaymentMethod[] = ['PIX', 'CREDIT_CARD'];

/** Até quantos dias depois de receber o cliente ainda pode avaliar e dar gorjeta. */
const FEEDBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function trackingCode(): string {
  // 12 caracteres sem ambiguidade (sem 0/O/1/l): difícil de adivinhar, fácil de ditar.
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrdersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    // Expira PIX não pagos a cada minuto.
    this.timer = setInterval(() => void this.expireStale().catch((e) => this.log.error(e)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Loja pública ----------

  /** Loja só aparece se o restaurante está ativo e com o módulo Cardápio ligado. */
  async findPublicStore(slug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
      include: {
        tenant: {
          select: {
            id: true,
            status: true,
            modules: { select: { moduleCode: true, active: true, startsAt: true, endsAt: true } },
          },
        },
      },
    });
    if (!store || store.tenant.status !== 'ACTIVE' || !activeModuleCodes(store.tenant.modules).includes('cardapio')) {
      throw new NotFoundException('Loja não encontrada.');
    }
    return store;
  }

  async getPublicMenu(slug: string) {
    const store = await this.findPublicStore(slug);
    const tenantId = store.tenantId;
    const [categories, zones, ratings, top] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { tenantId, active: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          products: {
            where: { active: true },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              name: true,
              description: true,
              priceCents: true,
              imageUrl: true,
              available: true,
              optionGroups: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  name: true,
                  minSelect: true,
                  maxSelect: true,
                  options: { orderBy: { position: 'asc' }, select: { id: true, name: true, priceCents: true, available: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.deliveryZone.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, feeCents: true } }),
      // Nota média das avaliações dos últimos 180 dias.
      this.prisma.order.aggregate({
        where: { tenantId, ratedAt: { gte: new Date(Date.now() - 180 * DAY_MS) }, ratingStore: { not: null } },
        _avg: { ratingStore: true },
        _count: { ratingStore: true },
      }),
      // Mais pedidos dos últimos 30 dias (só pedidos que não foram cancelados).
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { productId: { not: null }, order: { tenantId, status: { not: 'CANCELLED' }, createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 12,
      }),
    ]);
    const visible = new Set(categories.flatMap((c) => c.products.filter((p) => p.available).map((p) => p.id)));
    return {
      store: {
        slug: store.slug,
        displayName: store.displayName,
        description: store.description,
        logoUrl: store.logoUrl,
        coverUrl: store.coverUrl,
        whatsapp: store.whatsapp,
        isOpen: store.isOpen,
        acceptsDelivery: store.acceptsDelivery,
        acceptsPickup: store.acceptsPickup,
        minOrderCents: store.minOrderCents,
        paymentMethods: store.paymentMethods.filter((m) => m !== 'CREDIT_CARD'),
        estimatedMinutes: store.estimatedMinutes,
        rating: ratings._count.ratingStore >= 3 ? { average: Math.round((ratings._avg.ratingStore ?? 0) * 10) / 10, count: ratings._count.ratingStore } : null,
      },
      categories: categories.filter((c) => c.products.length > 0),
      topProductIds: top.map((t) => t.productId!).filter((id) => visible.has(id)).slice(0, 8),
      zones,
    };
  }

  async createPublicOrder(slug: string, dto: CreateOrderDto) {
    const store = await this.findPublicStore(slug);
    const tenantId = store.tenantId;

    // Cartão online depende do SDK do gateway no navegador (tokenização): entra junto com o gateway real.
    if (dto.paymentMethod === 'CREDIT_CARD') {
      throw new BadRequestException('Pagamento com cartão pela loja ainda não está disponível. Use PIX ou pague na entrega.');
    }
    const phone = normalizePhone(dto.customer.phone);
    if (!phone) throw new BadRequestException('Informe um telefone com DDD.');
    if (dto.type === 'DELIVERY' && !dto.address) throw new BadRequestException('Informe o endereço de entrega.');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const [products, zones] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, id: { in: productIds } },
        include: {
          category: { select: { active: true } },
          optionGroups: { include: { options: true } },
        },
      }),
      this.prisma.deliveryZone.findMany({ where: { tenantId } }),
    ]);
    const costOf = (productId: string, optionIds: string[]) => {
      const p = products.find((x) => x.id === productId);
      if (!p) return 0;
      const options = p.optionGroups.flatMap((g) => g.options);
      return unitCost(
        (p.costItems as unknown as CostItem[]) ?? [],
        optionIds.map((id) => options.find((o) => o.id === id)?.costCents ?? 0),
      );
    };
    const menu = new Map<string, MenuProduct>(
      products.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          active: p.active,
          available: p.available,
          categoryActive: p.category.active,
          optionGroups: p.optionGroups.map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, available: o.available })),
          })),
        },
      ]),
    );

    let priced;
    try {
      priced = priceOrder(
        {
          type: dto.type,
          zoneId: dto.address?.zoneId,
          paymentMethod: dto.paymentMethod,
          changeForCents: dto.changeForCents,
          items: dto.items,
        },
        store,
        menu,
        zones,
      );
    } catch (err) {
      if (err instanceof OrderValidationError) throw new BadRequestException(err.message);
      throw err;
    }

    const online = ONLINE_METHODS.includes(dto.paymentMethod);
    const charge = online
      ? await this.gateway.createCharge({
          paymentId: 'pending',
          amountCents: priced.totalCents,
          method: dto.paymentMethod as 'PIX',
          description: `Pedido ${store.displayName}`,
          customer: { name: dto.customer.name, phone },
        })
      : null;

    const order = await this.withOrderNumber(tenantId, async (tx, number) => {
      const customer = await tx.customer.upsert({
        where: { tenantId_phone: { tenantId, phone } },
        update: { name: dto.customer.name.trim() },
        create: { tenantId, phone, name: dto.customer.name.trim() },
      });
      const status: OrderStatus = online ? 'AWAITING_PAYMENT' : 'PAID';
      const created = await tx.order.create({
        data: {
          tenantId,
          number,
          trackingCode: trackingCode(),
          customerId: customer.id,
          type: dto.type,
          status,
          customerName: dto.customer.name.trim(),
          customerPhone: phone,
          addressStreet: dto.type === 'DELIVERY' ? dto.address!.street.trim() : null,
          addressNumber: dto.type === 'DELIVERY' ? dto.address!.number.trim() : null,
          addressComplement: dto.type === 'DELIVERY' ? dto.address!.complement?.trim() || null : null,
          addressReference: dto.type === 'DELIVERY' ? dto.address!.reference?.trim() || null : null,
          deliveryZoneId: priced.zone?.id ?? null,
          deliveryZoneName: priced.zone?.name ?? null,
          notes: dto.notes?.trim() || null,
          subtotalCents: priced.subtotalCents,
          deliveryFeeCents: priced.deliveryFeeCents,
          totalCents: priced.totalCents,
          paymentMethod: dto.paymentMethod,
          changeForCents: dto.paymentMethod === 'CASH_ON_DELIVERY' ? (dto.changeForCents ?? null) : null,
          utmSource: dto.utmSource || null,
          utmCampaign: dto.utmCampaign || null,
          items: {
            create: priced.items.map((i) => ({
              productId: i.productId,
              name: i.name,
              unitPriceCents: i.unitPriceCents,
              // CMV teórico pela ficha técnica (produto + adicionais), congelado no momento da venda.
              unitCostCents: costOf(i.productId, i.options.map((o) => o.optionId)),
              quantity: i.quantity,
              notes: i.notes,
              totalCents: i.totalCents,
              options: { create: i.options.map((o) => ({ optionId: o.optionId, groupName: o.groupName, name: o.name, priceCents: o.priceCents })) },
            })),
          },
          statusHistory: { create: { status, note: online ? 'Aguardando pagamento' : 'Pagamento na entrega' } },
          payments: {
            create: {
              tenantId,
              provider: online ? this.gateway.name : 'offline',
              method: dto.paymentMethod,
              amountCents: priced.totalCents,
              externalId: charge?.externalId ?? null,
              pixCopyPaste: charge?.pixCopyPaste ?? null,
              expiresAt: charge?.expiresAt ?? null,
            },
          },
        },
      });
      if (!online) await this.publishReceived(tx, created.id, tenantId, priced.totalCents, dto.paymentMethod);
      return created;
    });

    return this.getTracking(order.trackingCode);
  }

  /** Página de acompanhamento: só quem tem o código vê. Não expõe dados de outros pedidos. */
  async getTracking(code: string) {
    await this.expireStale();
    const order = await this.prisma.order.findUnique({
      where: { trackingCode: code },
      include: {
        items: { include: { options: true } },
        statusHistory: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        tenant: { select: { store: { select: { slug: true, displayName: true, whatsapp: true, estimatedMinutes: true } } } },
        batch: { select: { courier: { select: { name: true, lastLat: true, lastLng: true, lastLocationAt: true } } } },
        tip: true,
        deliveryAttempts: { where: { outcome: 'DELIVERED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { courierName: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const payment = order.payments[0];
    const delivered = order.deliveryAttempts[0];
    const feedbackOpen = this.feedbackOpen(order);
    const tip = order.tip;
    const tipExpired = tip?.status === 'PENDING' && !!tip.expiresAt && tip.expiresAt < new Date();
    return {
      trackingCode: order.trackingCode,
      number: order.number,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      customerName: order.customerName,
      address:
        order.type === 'DELIVERY'
          ? { street: order.addressStreet, number: order.addressNumber, complement: order.addressComplement, zone: order.deliveryZoneName }
          : null,
      items: order.items.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
        notes: i.notes,
        options: i.options.map((o) => ({ optionId: o.optionId, groupName: o.groupName, name: o.name, priceCents: o.priceCents })),
      })),
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      payment: payment
        ? {
            status: payment.status,
            pixCopyPaste: payment.status === 'PENDING' ? payment.pixCopyPaste : null,
            expiresAt: payment.expiresAt,
            canSimulate: payment.provider === 'fake' && payment.status === 'PENDING' && this.fakeEnabled(),
          }
        : null,
      history: order.statusHistory,
      store: order.tenant.store,
      // Só o primeiro nome do motoboy, enquanto o pedido está com ele.
      courierName: order.status === 'OUT_FOR_DELIVERY' && order.batch ? order.batch.courier.name.split(' ')[0] : null,
      courierLocation: this.liveLocation(order.status, order.batch?.courier),
      deliveryIssue: order.status === 'READY' && !!order.deliveryIssue,
      rating: order.ratedAt
        ? { store: order.ratingStore!, delivery: order.ratingDelivery, comment: order.ratingComment, at: order.ratedAt }
        : null,
      canRate: feedbackOpen && !order.ratedAt,
      // Gorjeta só quando um motoboy da plataforma entregou (é para ele que o restaurante repassa).
      tipCourierName: delivered ? delivered.courierName.split(' ')[0] : null,
      canTip: feedbackOpen && !!delivered && tip?.status !== 'PAID',
      tip:
        tip && !tipExpired
          ? {
              status: tip.status,
              amountCents: tip.amountCents,
              pixCopyPaste: tip.status === 'PENDING' ? tip.pixCopyPaste : null,
              expiresAt: tip.expiresAt,
              canSimulate: tip.provider === 'fake' && tip.status === 'PENDING' && this.fakeEnabled(),
            }
          : null,
    };
  }

  // ---------- Avaliação e gorjeta (depois de receber) ----------

  private feedbackOpen(order: { status: OrderStatus; deliveredAt: Date | null; updatedAt: Date }) {
    if (order.status !== 'COMPLETED') return false;
    const at = order.deliveredAt ?? order.updatedAt;
    return Date.now() - at.getTime() < FEEDBACK_DAYS * 24 * 60 * 60 * 1000;
  }

  /** O cliente avalia uma vez: restaurante (sempre) e entrega (só pedidos de entrega), de 1 a 5 estrelas. */
  async rate(code: string, dto: RateOrderDto) {
    const order = await this.prisma.order.findUnique({ where: { trackingCode: code } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (!this.feedbackOpen(order)) throw new ConflictException('A avaliação abre quando o pedido é entregue.');
    if (order.type === 'DELIVERY' && !dto.delivery) throw new BadRequestException('Dê as estrelas da entrega também.');
    const { count } = await this.prisma.order.updateMany({
      where: { id: order.id, ratedAt: null },
      data: {
        ratingStore: dto.store,
        ratingDelivery: order.type === 'DELIVERY' ? dto.delivery : null,
        ratingComment: dto.comment?.trim() || null,
        ratedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('Este pedido já foi avaliado. Obrigado!');
    await this.events.publish(order.tenantId, 'pedido.avaliado', {
      orderId: order.id,
      store: dto.store,
      delivery: order.type === 'DELIVERY' ? dto.delivery : null,
    });
    return this.getTracking(code);
  }

  /** Gera o PIX da gorjeta. O dinheiro entra no caixa do restaurante, que repassa ao motoboy. */
  async createTip(code: string, dto: TipDto) {
    const order = await this.prisma.order.findUnique({
      where: { trackingCode: code },
      include: {
        tip: true,
        deliveryAttempts: { where: { outcome: 'DELIVERED' }, orderBy: { createdAt: 'desc' }, take: 1 },
        tenant: { select: { store: { select: { displayName: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const delivered = order.deliveryAttempts[0];
    if (!this.feedbackOpen(order) || !delivered) throw new ConflictException('A gorjeta abre quando o motoboy entrega o pedido.');
    if (order.tip?.status === 'PAID') throw new ConflictException('A gorjeta deste pedido já foi paga. Obrigado!');

    const charge = await this.gateway.createCharge({
      paymentId: order.tip?.id ?? 'pending',
      amountCents: dto.amountCents,
      method: 'PIX',
      description: `Gorjeta para o entregador · ${order.tenant.store?.displayName ?? ''}`.trim(),
      customer: { name: order.customerName, phone: order.customerPhone },
    });
    const data = {
      courierId: delivered.courierId,
      amountCents: dto.amountCents,
      provider: this.gateway.name,
      status: 'PENDING' as const,
      externalId: charge.externalId,
      pixCopyPaste: charge.pixCopyPaste ?? null,
      expiresAt: charge.expiresAt ?? null,
    };
    // Um registro por pedido: trocar o valor ou gerar de novo depois de vencer reaproveita o mesmo.
    await this.prisma.tip.upsert({
      where: { orderId: order.id },
      create: { tenantId: order.tenantId, orderId: order.id, ...data },
      update: data,
    });
    return this.getTracking(code);
  }

  /** Confirmação do PIX da gorjeta (webhook do gateway). Idempotente. */
  async markTipPaid(provider: string, externalId: string) {
    await this.prisma.$transaction(async (tx) => {
      const tip = await tx.tip.findUnique({ where: { provider_externalId: { provider, externalId } } });
      if (!tip) throw new NotFoundException('Gorjeta não encontrada.');
      const { count } = await tx.tip.updateMany({ where: { id: tip.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date() } });
      if (count === 0) return;
      // Na Gestão entra como valor a repassar ao motoboy (não é receita do restaurante).
      await this.events.publish(tip.tenantId, 'gorjeta.recebida', { tipId: tip.id, orderId: tip.orderId, courierId: tip.courierId, amountCents: tip.amountCents }, tx);
    });
  }

  async simulateTip(code: string) {
    if (!this.fakeEnabled()) throw new ForbiddenException('Simulação de pagamento desligada.');
    const order = await this.prisma.order.findUnique({ where: { trackingCode: code }, include: { tip: true } });
    const tip = order?.tip;
    if (!tip || tip.provider !== 'fake' || tip.status !== 'PENDING' || !tip.externalId) throw new NotFoundException('Nenhuma gorjeta pendente para simular.');
    await this.markTipPaid('fake', tip.externalId);
    return this.getTracking(code);
  }

  /** Posição do motoboy só enquanto o pedido está com ele e se foi enviada nos últimos 3 minutos. */
  private liveLocation(
    status: OrderStatus,
    courier?: { lastLat: number | null; lastLng: number | null; lastLocationAt: Date | null },
  ) {
    if (status !== 'OUT_FOR_DELIVERY' || !courier?.lastLocationAt || courier.lastLat === null || courier.lastLng === null) return null;
    if (Date.now() - courier.lastLocationAt.getTime() > 3 * 60 * 1000) return null;
    return { lat: courier.lastLat, lng: courier.lastLng, at: courier.lastLocationAt };
  }

  // ---------- Pagamentos ----------

  /**
   * Confirma um pagamento vindo do gateway (webhook). Idempotente: chamar de novo não duplica nada.
   * Só aqui o pedido PIX passa a "Pago" e entra na operação.
   */
  async markPaid(provider: string, externalId: string) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { provider_externalId: { provider, externalId } }, include: { order: true } });
      if (!payment) throw new NotFoundException('Pagamento não encontrado.');
      if (payment.status === 'PAID') return;
      if (payment.status !== 'PENDING' || payment.order.status !== 'AWAITING_PAYMENT') {
        throw new ConflictException('Este pagamento não pode mais ser confirmado.');
      }
      // Atualização condicional: se dois webhooks chegarem juntos, só um vence.
      const updated = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date() } });
      if (updated.count === 0) return;
      await tx.order.update({ where: { id: payment.orderId }, data: { status: 'PAID' } });
      await tx.orderStatusHistory.create({ data: { orderId: payment.orderId, status: 'PAID', note: 'Pagamento confirmado' } });
      await this.publishReceived(tx, payment.orderId, payment.tenantId, payment.amountCents, payment.method);
    });
  }

  /** Só em desenvolvimento: simula o webhook do gateway de teste. */
  async simulatePayment(code: string) {
    if (!this.fakeEnabled()) throw new ForbiddenException('Simulação de pagamento desligada.');
    const order = await this.prisma.order.findUnique({ where: { trackingCode: code }, include: { payments: true } });
    const payment = order?.payments.find((p) => p.provider === 'fake' && p.status === 'PENDING');
    if (!order || !payment?.externalId) throw new NotFoundException('Nenhum pagamento pendente para simular.');
    await this.markPaid('fake', payment.externalId);
    return this.getTracking(code);
  }

  /** PIX vencido: cancela o pedido que nunca foi pago. */
  async expireStale(now = new Date()) {
    const stale = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now }, order: { status: 'AWAITING_PAYMENT' } },
      select: { id: true, orderId: true },
      take: 200,
    });
    for (const p of stale) {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
        if (res.count === 0) return;
        await tx.order.updateMany({ where: { id: p.orderId, status: 'AWAITING_PAYMENT' }, data: { status: 'CANCELLED' } });
        await tx.orderStatusHistory.create({ data: { orderId: p.orderId, status: 'CANCELLED', note: 'PIX não pago no prazo' } });
      });
    }
    return stale.length;
  }

  // ---------- Restaurante ----------

  listOrders(tenantId: string, status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: { tenantId, ...(status ? { status } : { status: { not: 'AWAITING_PAYMENT' } }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: { include: { options: true } } },
    });
  }

  // ---------- Painel e cozinha ----------

  /** Pedidos em andamento + os finalizados/cancelados das últimas 12 horas, do mais antigo ao mais novo. */
  listBoard(tenantId: string) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    return this.prisma.order.findMany({
      where: {
        tenantId,
        OR: [{ status: { in: ACTIVE_STATUSES } }, { status: { in: ['COMPLETED', 'CANCELLED'] }, updatedAt: { gte: since } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 300,
      include: {
        items: { include: { options: true } },
        statusHistory: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true } },
      },
    });
  }

  /** Muda o status seguindo o fluxo permitido; grava histórico, auditoria e evento. */
  async updateStatus(tenantId: string, userId: string, orderId: string, to: OrderStatus, note?: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status === to) return order;
    if (!canTransition(order.type, order.status, to)) {
      throw new ConflictException(`Não é possível passar o pedido #${order.number} para este status agora.`);
    }
    return this.prisma.$transaction(async (tx) => {
      // Condicional no status atual: se outra tela mudou antes, ninguém sobrescreve.
      const { count } = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: to } });
      if (count === 0) throw new ConflictException('O pedido acabou de ser atualizado em outra tela. Confira e tente de novo.');
      await tx.orderStatusHistory.create({ data: { orderId, status: to, userId, note: note?.trim() || null } });
      await this.audit.log(
        { tenantId, userId, action: 'order.status', entity: 'order', entityId: orderId, before: { status: order.status }, after: { status: to, note } },
        tx,
      );
      await this.events.publish(tenantId, to === 'CANCELLED' ? 'pedido.cancelado' : 'pedido.status', { orderId, from: order.status, to, totalCents: order.totalCents }, tx);
      if (to === 'COMPLETED') await tx.order.update({ where: { id: orderId }, data: { deliveredAt: new Date() } });
      await closeBatchIfDone(tx, order.batchId);
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  /** Ficha completa do pedido para o painel: histórico, entregas (motoboy, placa, quem recebeu), avaliação e gorjeta. */
  async orderDetail(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { include: { options: true } },
        statusHistory: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true, note: true } },
        deliveryAttempts: { orderBy: { createdAt: 'asc' } },
        tip: { select: { status: true, amountCents: true, paidAt: true, paidOutAt: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const { deliveryAttempts, tip, ...rest } = order;
    return {
      ...rest,
      attempts: deliveryAttempts,
      tip: tip && tip.status === 'PAID' ? tip : null,
    };
  }

  /** Marca a primeira impressão; devolve se esta tela foi a primeira (para a impressão automática não duplicar). */
  async markPrinted(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const { count } = await this.prisma.order.updateMany({ where: { id: orderId, printedAt: null }, data: { printedAt: new Date() } });
    return { first: count === 1 };
  }

  // ---------- Auxiliares ----------

  private fakeEnabled() {
    return process.env.PAYMENTS_FAKE_ENABLED === 'true';
  }

  publishReceived(tx: Prisma.TransactionClient, orderId: string, tenantId: string, totalCents: number, method: PaymentMethod) {
    // A Gestão vai consumir este evento para lançar a receita (conta 1.2) e a taxa (2.3).
    return this.events.publish(tenantId, 'pedido.recebido', { orderId, totalCents, paymentMethod: method }, tx);
  }

  /** Número sequencial por restaurante; tenta de novo se dois pedidos pegarem o mesmo número. */
  async withOrderNumber<T>(tenantId: string, fn: (tx: Prisma.TransactionClient, n: number) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.order.aggregate({ where: { tenantId }, _max: { number: true } });
          return fn(tx, (last._max.number ?? 0) + 1);
        });
      } catch (err) {
        const retry = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!retry || attempt === 4) throw err;
      }
    }
    throw new ConflictException('Tente novamente.');
  }
}
