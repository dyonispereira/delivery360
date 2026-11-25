import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { EventsService } from '../core/events.service';
import { normalizePhone } from '../cardapio/order-pricing';
import { isModuleActive } from '../access/access.rules';
import { closeBatchIfDone } from './batch-utils';
import { MAX_CODE_FAILS, checkDeliveryCode, maskPhone } from './delivery-code';
import { DELIVERY_FAIL_LABELS } from '@delivery360/shared';
import { CourierDto, CreateBatchDto, FailDeliveryDto, FixAttemptDto, LocationDto, UpdateCourierDto } from './entregas.dto';

/** Pedidos que podem sair em lote: entrega, já em preparo ou prontos, ainda sem motoboy. */
const DISPATCHABLE: OrderStatus[] = ['IN_PREPARATION', 'READY'];

const token = () => randomBytes(18).toString('base64url');

/** "abc1d23" -> "ABC1D23"; vazio vira null. */
const normalizePlate = (p?: string | null) => {
  const v = p?.toUpperCase().replace(/[^A-Z0-9-]/g, '') ?? '';
  return v || null;
};

/** Posição do motoboy só vale como registro se for recente (até 3 minutos). */
const recentFix = (c: { lastLat: number | null; lastLng: number | null; lastLocationAt: Date | null }) =>
  c.lastLocationAt && Date.now() - c.lastLocationAt.getTime() < 3 * 60 * 1000 && c.lastLat !== null && c.lastLng !== null
    ? { lat: c.lastLat, lng: c.lastLng }
    : { lat: null, lng: null };

const orderSummary = {
  id: true,
  number: true,
  status: true,
  customerName: true,
  addressStreet: true,
  addressNumber: true,
  addressComplement: true,
  addressReference: true,
  deliveryZoneName: true,
  totalCents: true,
  paymentMethod: true,
  changeForCents: true,
  notes: true,
  deliveredAt: true,
  deliveryCodeFails: true,
  deliveryIssue: true,
  deliveryIssueAt: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

@Injectable()
export class EntregasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  // ---------- Motoboys ----------

  listCouriers(tenantId: string) {
    return this.prisma.courier.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  }

  async createCourier(tenantId: string, userId: string, dto: CourierDto) {
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('Informe o telefone do motoboy com DDD.');
    const courier = await this.prisma.courier.create({
      data: { tenantId, name: dto.name.trim(), phone, feeCents: dto.feeCents ?? 0, plate: normalizePlate(dto.plate), accessToken: token() },
    });
    await this.audit.log({ tenantId, userId, action: 'courier.create', entity: 'courier', entityId: courier.id, after: { name: courier.name } });
    return courier;
  }

  async updateCourier(tenantId: string, userId: string, id: string, dto: UpdateCourierDto) {
    const before = await this.ownCourier(tenantId, id);
    let phone: string | undefined;
    if (dto.phone !== undefined) {
      phone = normalizePhone(dto.phone) ?? undefined;
      if (!phone) throw new BadRequestException('Informe o telefone do motoboy com DDD.');
    }
    const after = await this.prisma.courier.update({
      where: { id },
      data: { ...dto, name: dto.name?.trim(), phone, plate: dto.plate === undefined ? undefined : normalizePlate(dto.plate) },
    });
    await this.audit.log({ tenantId, userId, action: 'courier.update', entity: 'courier', entityId: id, before, after });
    return after;
  }

  /** Gera um link novo e invalida o antigo (ex.: celular perdido ou motoboy saiu). */
  async rotateToken(tenantId: string, userId: string, id: string) {
    await this.ownCourier(tenantId, id);
    const after = await this.prisma.courier.update({
      where: { id },
      data: { accessToken: token() } });
    await this.audit.log({ tenantId, userId, action: 'courier.rotate_link', entity: 'courier', entityId: id });
    return after;
  }

  // ---------- Lotes ----------

  /** Fila para despachar + lotes na rua + lotes concluídos nas últimas 12 horas. */
  async overview(tenantId: string) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [queue, batches] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, type: 'DELIVERY', status: { in: DISPATCHABLE }, batchId: null },
        orderBy: { createdAt: 'asc' },
        select: orderSummary,
      }),
      this.prisma.deliveryBatch.findMany({
        where: { tenantId, OR: [{ status: 'OUT' }, { status: 'DONE', finishedAt: { gte: since } }] },
        orderBy: { createdAt: 'desc' },
        include: { courier: { select: { id: true, name: true } }, orders: { select: orderSummary, orderBy: { number: 'asc' } } },
      }),
    ]);
    return { queue, batches };
  }

  async createBatch(tenantId: string, userId: string, dto: CreateBatchDto) {
    const courier = await this.ownCourier(tenantId, dto.courierId);
    if (!courier.active) throw new BadRequestException('Este motoboy está inativo.');
    const ids = [...new Set(dto.orderIds)];

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.deliveryBatch.aggregate({ where: { tenantId }, _max: { number: true } });
          const batch = await tx.deliveryBatch.create({
            data: { tenantId, number: (last._max.number ?? 0) + 1, courierId: courier.id, createdBy: userId },
          });
          const orders = await tx.order.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, status: true, totalCents: true } });
          // Condicional: se outro lote pegou o pedido no meio do caminho, ninguém sai duplicado.
          const { count } = await tx.order.updateMany({
            where: { tenantId, id: { in: ids }, type: 'DELIVERY', status: { in: DISPATCHABLE }, batchId: null },
            // Pedido que voltou com ocorrência sai de novo: a ocorrência fica só no histórico.
            data: { batchId: batch.id, status: 'OUT_FOR_DELIVERY', deliveryIssue: null, deliveryIssueAt: null, deliveryCodeFails: 0 },
          });
          if (count !== ids.length) {
            throw new ConflictException('Algum pedido já saiu em outro lote ou não está pronto para entrega. Atualize a tela.');
          }
          await tx.orderStatusHistory.createMany({
            data: ids.map((orderId) => ({ orderId, status: 'OUT_FOR_DELIVERY' as const, userId, note: `Lote ${batch.number} · ${courier.name}` })),
          });
          for (const o of orders) {
            await this.events.publish(tenantId, 'pedido.status', { orderId: o.id, from: o.status, to: 'OUT_FOR_DELIVERY', totalCents: o.totalCents }, tx);
          }
          await this.audit.log({ tenantId, userId, action: 'batch.create', entity: 'delivery_batch', entityId: batch.id, after: { courierId: courier.id, orderIds: ids } }, tx);
          return batch;
        });
      } catch (err) {
        const retry = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!retry || attempt === 4) throw err;
      }
    }
    throw new ConflictException('Tente novamente.');
  }

  /** Tira um pedido ainda não entregue do lote: volta para "pronto" e pode sair com outro motoboy. */
  async removeFromBatch(tenantId: string, userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order || !order.batchId) throw new NotFoundException('Pedido não está em um lote.');
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'OUT_FOR_DELIVERY', batchId: order.batchId },
        data: { batchId: null, status: 'READY', deliveryCodeFails: 0 },
      });
      if (count === 0) throw new ConflictException('O pedido já foi entregue ou mudou de situação.');
      await tx.orderStatusHistory.create({ data: { orderId, status: 'READY', userId, note: 'Retirado do lote' } });
      await this.audit.log({ tenantId, userId, action: 'batch.remove_order', entity: 'order', entityId: orderId, before: { batchId: order.batchId } }, tx);
      await closeBatchIfDone(tx, order.batchId);
      return { ok: true };
    });
  }

  /** O restaurante libera o código depois de 5 tentativas erradas. */
  async unlockCode(tenantId: string, userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    await this.prisma.order.update({ where: { id: orderId }, data: { deliveryCodeFails: 0 } });
    await this.audit.log({ tenantId, userId, action: 'order.unlock_code', entity: 'order', entityId: orderId });
    return { ok: true };
  }

  // ---------- Tela do entregador (link secreto) ----------

  async courierView(accessToken: string) {
    const courier = await this.courierByToken(accessToken);
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [store, batches] = await Promise.all([
      this.prisma.store.findUnique({ where: { tenantId: courier.tenantId }, select: { displayName: true, whatsapp: true, city: true } }),
      this.prisma.deliveryBatch.findMany({
        where: { courierId: courier.id, OR: [{ status: 'OUT' }, { status: 'DONE', finishedAt: { gte: since } }] },
        orderBy: { createdAt: 'desc' },
        include: { orders: { select: { ...orderSummary, customerPhone: true }, orderBy: { number: 'asc' } } },
      }),
    ]);
    return {
      courier: { name: courier.name },
      store,
      batches: batches.map((b) => ({
        id: b.id,
        number: b.number,
        status: b.status,
        createdAt: b.createdAt,
        orders: b.orders.map(({ customerPhone, deliveryCodeFails, ...o }) => ({
          ...o,
          phoneHint: maskPhone(customerPhone),
          locked: deliveryCodeFails >= MAX_CODE_FAILS,
        })),
      })),
    };
  }

  async deliver(accessToken: string, orderId: string, code: string, receiverName: string) {
    const courier = await this.courierByToken(accessToken);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: courier.tenantId, batch: { courierId: courier.id } },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status === 'COMPLETED') return { ok: true, already: true };
    if (order.status !== 'OUT_FOR_DELIVERY') throw new ConflictException('Este pedido não está mais em entrega. Fale com o restaurante.');
    if (order.deliveryCodeFails >= MAX_CODE_FAILS) {
      throw new HttpException('Código bloqueado depois de 5 tentativas. Peça ao restaurante para liberar.', HttpStatus.LOCKED);
    }

    if (!checkDeliveryCode(order.customerPhone, code)) {
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: { deliveryCodeFails: { increment: 1 } },
        select: { deliveryCodeFails: true },
      });
      const left = MAX_CODE_FAILS - updated.deliveryCodeFails;
      throw new BadRequestException(
        left > 0 ? `Código errado. Confira com o cliente (restam ${left} tentativa${left > 1 ? 's' : ''}).` : 'Código bloqueado. Peça ao restaurante para liberar.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'OUT_FOR_DELIVERY' },
        data: { status: 'COMPLETED', deliveredAt: new Date() },
      });
      if (count === 0) return;
      const receiver = receiverName.trim();
      await tx.orderStatusHistory.create({ data: { orderId, status: 'COMPLETED', note: `Entregue por ${courier.name} a ${receiver} (código conferido)` } });
      const batch = order.batchId ? await tx.deliveryBatch.findUnique({ where: { id: order.batchId }, select: { number: true } }) : null;
      await tx.deliveryAttempt.create({
        data: {
          tenantId: order.tenantId,
          orderId,
          courierId: courier.id,
          batchId: order.batchId,
          batchNumber: batch?.number ?? null,
          outcome: 'DELIVERED',
          receiverName: receiver,
          code: code.replace(/\D/g, ''),
          courierName: courier.name,
          courierPlate: courier.plate,
          ...recentFix(courier),
        },
      });
      await this.events.publish(order.tenantId, 'pedido.status', { orderId, from: 'OUT_FOR_DELIVERY', to: 'COMPLETED', totalCents: order.totalCents }, tx);
      // A Gestão usa este evento para lançar o custo do motoboy por entrega.
      await this.events.publish(
        order.tenantId,
        'entrega.concluida',
        { orderId, courierId: courier.id, batchId: order.batchId, courierFeeCents: courier.feeCents },
        tx,
      );
      await closeBatchIfDone(tx, order.batchId);
    });
    return { ok: true };
  }

  /**
   * O motoboy não conseguiu entregar (endereço não achado, cliente não atende ou recusou).
   * O pedido sai das mãos dele e volta para o restaurante como "Pronto", marcado com a ocorrência:
   * o restaurante decide se manda de novo (novo lote) ou cancela.
   */
  async fail(accessToken: string, orderId: string, dto: FailDeliveryDto) {
    const courier = await this.courierByToken(accessToken);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: courier.tenantId, batch: { courierId: courier.id } },
      include: { batch: { select: { number: true } } },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status !== 'OUT_FOR_DELIVERY') throw new ConflictException('Este pedido não está mais em entrega. Fale com o restaurante.');
    const note = dto.note?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: 'OUT_FOR_DELIVERY', batchId: order.batchId },
        data: { status: 'READY', batchId: null, deliveryCodeFails: 0, deliveryIssue: dto.reason, deliveryIssueAt: new Date() },
      });
      if (count === 0) throw new ConflictException('Este pedido mudou de situação. Atualize a tela.');
      await tx.orderStatusHistory.create({
        data: { orderId, status: 'READY', note: `Não entregue (${DELIVERY_FAIL_LABELS[dto.reason]}) · ${courier.name}${note ? `: ${note}` : ''}` },
      });
      await tx.deliveryAttempt.create({
        data: {
          tenantId: order.tenantId,
          orderId,
          courierId: courier.id,
          batchId: order.batchId,
          batchNumber: order.batch?.number ?? null,
          outcome: 'FAILED',
          failReason: dto.reason,
          note,
          courierName: courier.name,
          courierPlate: courier.plate,
          ...recentFix(courier),
        },
      });
      await this.events.publish(order.tenantId, 'pedido.status', { orderId, from: 'OUT_FOR_DELIVERY', to: 'READY', totalCents: order.totalCents }, tx);
      await this.events.publish(order.tenantId, 'entrega.ocorrencia', { orderId, courierId: courier.id, batchId: order.batchId, reason: dto.reason }, tx);
      await closeBatchIfDone(tx, order.batchId);
    });
    return { ok: true };
  }

  /** Histórico do motoboy (só leitura): entregas e ocorrências dos últimos 30 dias. */
  async courierHistory(accessToken: string) {
    const courier = await this.courierByToken(accessToken);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const attempts = await this.prisma.deliveryAttempt.findMany({
      where: { courierId: courier.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        order: {
          select: { number: true, customerName: true, addressStreet: true, addressNumber: true, deliveryZoneName: true, totalCents: true, paymentMethod: true },
        },
      },
    });
    const tips = await this.prisma.tip.findMany({
      where: { courierId: courier.id, status: 'PAID', paidAt: { gte: since } },
      select: { orderId: true, amountCents: true, paidOutAt: true },
    });
    const tipByOrder = new Map(tips.map((t) => [t.orderId, t]));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = attempts.filter((a) => a.createdAt >= startOfDay);
    return {
      today: {
        delivered: today.filter((a) => a.outcome === 'DELIVERED').length,
        failed: today.filter((a) => a.outcome === 'FAILED').length,
        feeCents: today.filter((a) => a.outcome === 'DELIVERED').length * courier.feeCents,
      },
      tips: {
        pendingCents: tips.filter((t) => !t.paidOutAt).reduce((sum, t) => sum + t.amountCents, 0),
        paidOutCents: tips.filter((t) => t.paidOutAt).reduce((sum, t) => sum + t.amountCents, 0),
      },
      items: attempts.map((a) => ({
        id: a.id,
        outcome: a.outcome,
        failReason: a.failReason,
        note: a.note,
        receiverName: a.receiverName,
        batchNumber: a.batchNumber,
        createdAt: a.createdAt,
        tip: a.outcome === 'DELIVERED' ? (tipByOrder.get(a.orderId) ?? null) : null,
        order: {
          number: a.order.number,
          customerName: a.order.customerName.split(' ')[0],
          address: a.order.addressStreet ? `${a.order.addressStreet}, ${a.order.addressNumber ?? 's/n'}` : null,
          zone: a.order.deliveryZoneName,
          totalCents: a.order.totalCents,
          paymentMethod: a.order.paymentMethod,
        },
      })),
    };
  }

  // ---------- Gorjetas ----------

  /** Gorjetas pagas pelos clientes, por motoboy: o que falta repassar e o que já foi repassado nos últimos 30 dias. */
  async tips(tenantId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const tips = await this.prisma.tip.findMany({
      where: { tenantId, status: 'PAID', OR: [{ paidOutAt: null }, { paidOutAt: { gte: since } }] },
      orderBy: { paidAt: 'desc' },
      include: { courier: { select: { id: true, name: true } }, order: { select: { number: true, ratingDelivery: true } } },
    });
    return tips.map((t) => ({
      id: t.id,
      amountCents: t.amountCents,
      paidAt: t.paidAt,
      paidOutAt: t.paidOutAt,
      courier: t.courier,
      orderNumber: t.order.number,
      ratingDelivery: t.order.ratingDelivery,
    }));
  }

  /** O restaurante entregou as gorjetas ao motoboy (prêmio). */
  async payOutTips(tenantId: string, userId: string, courierId: string) {
    await this.ownCourier(tenantId, courierId);
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.tip.findMany({ where: { tenantId, courierId, status: 'PAID', paidOutAt: null }, select: { id: true, amountCents: true } });
      if (pending.length === 0) throw new ConflictException('Não há gorjetas a repassar para este motoboy.');
      const ids = pending.map((t) => t.id);
      const totalCents = pending.reduce((sum, t) => sum + t.amountCents, 0);
      await tx.tip.updateMany({ where: { id: { in: ids }, paidOutAt: null }, data: { paidOutAt: new Date(), paidOutBy: userId } });
      await this.events.publish(tenantId, 'gorjeta.repassada', { courierId, tipIds: ids, amountCents: totalCents }, tx);
      await this.audit.log({ tenantId, userId, action: 'tips.pay_out', entity: 'courier', entityId: courierId, after: { tipIds: ids, totalCents } }, tx);
      return { count: ids.length, totalCents };
    });
  }

  /** Só o restaurante corrige um registro de entrega (ex.: nome de quem recebeu digitado errado). Fica na auditoria. */
  async fixAttempt(tenantId: string, userId: string, id: string, dto: FixAttemptDto) {
    const before = await this.prisma.deliveryAttempt.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Registro de entrega não encontrado.');
    const after = await this.prisma.deliveryAttempt.update({
      where: { id },
      data: {
        receiverName: dto.receiverName === undefined ? undefined : dto.receiverName.trim(),
        note: dto.note === undefined ? undefined : dto.note.trim() || null,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'delivery_attempt.fix',
      entity: 'delivery_attempt',
      entityId: id,
      before: { receiverName: before.receiverName, note: before.note },
      after: { receiverName: after.receiverName, note: after.note },
    });
    return after;
  }

  /**
   * Posição do celular do motoboy. Só é guardada enquanto ele tem entrega em andamento:
   * fora disso não rastreamos ninguém.
   */
  async updateLocation(accessToken: string, dto: LocationDto) {
    const courier = await this.courierByToken(accessToken);
    const delivering = await this.prisma.order.count({
      where: { tenantId: courier.tenantId, status: 'OUT_FOR_DELIVERY', batch: { courierId: courier.id, status: 'OUT' } },
    });
    if (!delivering) return { tracking: false };
    await this.prisma.courier.update({
      where: { id: courier.id },
      data: { lastLat: dto.lat, lastLng: dto.lng, lastAccuracy: dto.accuracy ?? null, lastLocationAt: new Date() },
    });
    return { tracking: true };
  }

  // ---------- Auxiliares ----------

  private async ownCourier(tenantId: string, id: string) {
    const courier = await this.prisma.courier.findFirst({ where: { id, tenantId } });
    if (!courier) throw new NotFoundException('Motoboy não encontrado.');
    return courier;
  }

  /** Link inválido, motoboy inativo ou restaurante sem o módulo Entregas: mesma resposta (não revela nada). */
  private async courierByToken(accessToken: string) {
    const courier = await this.prisma.courier.findUnique({
      where: { accessToken },
      include: { tenant: { select: { status: true, modules: { where: { moduleCode: 'entregas' } } } } },
    });
    const moduleOn = courier?.tenant.modules.some((m) => isModuleActive(m));
    if (!courier || !courier.active || courier.tenant.status !== 'ACTIVE' || !moduleOn) {
      throw new NotFoundException('Link inválido. Peça um novo link ao restaurante.');
    }
    return courier;
  }
}
