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
import { CourierDto, CreateBatchDto, LocationDto, UpdateCourierDto } from './entregas.dto';

/** Pedidos que podem sair em lote: entrega, já em preparo ou prontos, ainda sem motoboy. */
const DISPATCHABLE: OrderStatus[] = ['IN_PREPARATION', 'READY'];

const token = () => randomBytes(18).toString('base64url');

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
      data: { tenantId, name: dto.name.trim(), phone, feeCents: dto.feeCents ?? 0, accessToken: token() },
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
    const after = await this.prisma.courier.update({ where: { id }, data: { ...dto, name: dto.name?.trim(), phone } });
    await this.audit.log({ tenantId, userId, action: 'courier.update', entity: 'courier', entityId: id, before, after });
    return after;
  }

  /** Gera um link novo e invalida o antigo (ex.: celular perdido ou motoboy saiu). */
  async rotateToken(tenantId: string, userId: string, id: string) {
    await this.ownCourier(tenantId, id);
    const after = await this.prisma.courier.update({ where: { id }, data: { accessToken: token() } });
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
            data: { batchId: batch.id, status: 'OUT_FOR_DELIVERY' },
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

  async deliver(accessToken: string, orderId: string, code: string) {
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
      await tx.orderStatusHistory.create({ data: { orderId, status: 'COMPLETED', note: `Entregue por ${courier.name} (código conferido)` } });
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
