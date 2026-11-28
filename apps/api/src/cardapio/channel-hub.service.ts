import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ChannelEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelOrdersService } from './channel-orders.service';
import { FINAL_STATUSES, IfoodPayloadError, ifoodOrderToDto, parseIfoodEvent, validIfoodSignature, type IfoodOrder } from './ifood';
import { OrdersService } from './orders.service';

/** Erro esperado (dado do pedido): o evento fica FAILED com a mensagem para o dono corrigir e reprocessar. */
class HubError extends Error {}

/**
 * Hub dos apps de delivery (por enquanto o iFood, simulado).
 *
 * Todo evento é gravado como chegou (canal + id do evento: entra uma vez só), o restaurante é achado
 * pelo código da loja (merchantId) e só então o evento é processado:
 * - PLACED: cria o pedido na fila de sempre (painel, cozinha, entregas, financeiro) e o vínculo com o pedido do iFood;
 * - CANCELLED: cancela o pedido interno (o financeiro desfaz a venda); se o pedido ainda não chegou, fica anotado;
 * - outros (CONFIRMED, DISPATCHED, CONCLUDED...): só atualizam a situação no iFood, sem mexer no nosso status.
 */
@Injectable()
export class ChannelHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelOrdersService,
    private readonly orders: OrdersService,
  ) {}

  /** Webhook do iFood. Responde rápido: o iFood só precisa saber que o evento foi recebido. */
  async receiveIfood(body: unknown, rawBody: string, signature: string | undefined) {
    const secret = process.env.IFOOD_WEBHOOK_SECRET;
    if (!secret) throw new UnauthorizedException('Integração com o iFood desligada neste ambiente.');
    if (!validIfoodSignature(secret, rawBody, signature)) throw new UnauthorizedException('Assinatura do iFood inválida.');
    let parsed;
    try {
      parsed = parseIfoodEvent(body);
    } catch (err) {
      if (err instanceof IfoodPayloadError) throw new BadRequestException(err.message);
      throw err;
    }

    const merchant = parsed.merchantId
      ? await this.prisma.channelMerchant.findUnique({ where: { channel_merchantId: { channel: 'IFOOD', merchantId: parsed.merchantId } } })
      : null;
    let event: ChannelEvent;
    try {
      event = await this.prisma.channelEvent.create({
        data: {
          channel: 'IFOOD',
          eventId: parsed.id,
          type: parsed.fullCode,
          merchantId: parsed.merchantId ?? null,
          orderExternalId: parsed.orderId ?? null,
          tenantId: merchant?.tenantId ?? null,
          payload: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
          status: merchant ? 'RECEIVED' : 'IGNORED',
          error: merchant ? null : 'Código da loja (merchantId) não ligado a nenhum restaurante.',
        },
      });
    } catch (err) {
      // O iFood reenvia o mesmo evento: devolve o que já foi feito, sem processar de novo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.channelEvent.findUniqueOrThrow({ where: { channel_eventId: { channel: 'IFOOD', eventId: parsed.id } } });
        return { id: again.id, status: again.status, duplicated: true };
      }
      throw err;
    }
    if (!merchant) return { id: event.id, status: event.status, duplicated: false };
    const done = await this.process(event);
    return { id: done.id, status: done.status, error: done.error, duplicated: false };
  }

  /** Reprocessa um evento que deu erro (ex.: item sem código PDV, já corrigido no cardápio). */
  async reprocess(tenantId: string, id: string) {
    const event = await this.prisma.channelEvent.findFirst({ where: { id, tenantId } });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    if (event.status !== 'FAILED') throw new ConflictException('Só dá para reprocessar evento com erro.');
    const done = await this.process(event);
    return { id: done.id, status: done.status, error: done.error };
  }

  /** Últimos eventos recebidos do app, para o dono acompanhar a integração. */
  listEvents(tenantId: string, status?: string) {
    const valid = ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'];
    return this.prisma.channelEvent.findMany({
      where: { tenantId, channel: 'IFOOD', ...(status && valid.includes(status) ? { status: status as ChannelEvent['status'] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, eventId: true, type: true, orderExternalId: true, status: true, attempts: true, error: true, processedAt: true, createdAt: true },
    });
  }

  private async process(event: ChannelEvent) {
    const tenantId = event.tenantId!;
    try {
      const result = await this.handle(tenantId, event);
      return this.prisma.channelEvent.update({
        where: { id: event.id },
        data: { status: result.ignored ? 'IGNORED' : 'PROCESSED', error: result.note ?? null, attempts: { increment: 1 }, processedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof HubError || err instanceof IfoodPayloadError ? err.message : `Erro ao processar: ${(err as Error).message}`.slice(0, 500);
      return this.prisma.channelEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: message, attempts: { increment: 1 } } });
    }
  }

  private async handle(tenantId: string, event: ChannelEvent): Promise<{ ignored?: boolean; note?: string }> {
    const externalId = event.orderExternalId;
    if (!externalId) return { ignored: true, note: 'Evento sem pedido.' };
    const where = { tenantId_channel_externalId: { tenantId, channel: 'IFOOD' as const, externalId } };
    const link = await this.prisma.channelOrderLink.findUnique({ where });

    if (event.type === 'PLACED') {
      if (link?.externalStatus === 'CANCELLED' && !link.orderId) return { ignored: true, note: 'O iFood cancelou o pedido antes de ele chegar.' };
      if (link?.orderId) return { ignored: true, note: 'Pedido já recebido.' };
      const order = (event.payload as { order?: IfoodOrder }).order;
      if (!order) throw new HubError('Evento PLACED sem os dados do pedido.');
      const { dto, amounts } = ifoodOrderToDto({ ...order, id: externalId });
      // Item sem código PDV ligado ao cardápio: não entra pela metade. O dono corrige e reprocessa.
      const codes = dto.items.flatMap((i) => (i.pdvCode ? [i.pdvCode] : []));
      const found = await this.prisma.product.findMany({ where: { tenantId, pdvCode: { in: codes } }, select: { pdvCode: true } });
      const missing = dto.items.filter((i) => !i.pdvCode || !found.some((p) => p.pdvCode === i.pdvCode)).map((i) => (i.pdvCode ? `${i.name} (código ${i.pdvCode})` : `${i.name} (sem código PDV)`));
      if (missing.length) throw new HubError(`Itens sem código PDV no cardápio: ${missing.join(', ')}. Cadastre o código e reprocesse.`);
      const created = await this.channels.importOrder(tenantId, dto, { externalStatus: 'PLACED', externalAmounts: amounts });
      return created.duplicated ? { ignored: true, note: 'Pedido já recebido.' } : {};
    }

    if (event.type === 'CANCELLED') {
      const reason = (event.payload as { metadata?: { reason?: string }; reason?: string }).reason ?? (event.payload as { metadata?: { reason?: string } }).metadata?.reason;
      await this.prisma.$transaction(async (tx) => {
        await tx.channelOrderLink.upsert({
          where,
          update: { externalStatus: 'CANCELLED' },
          create: { tenantId, channel: 'IFOOD', externalId, externalStatus: 'CANCELLED' },
        });
        const orderId = link?.orderId;
        if (orderId) await this.orders.cancelFromChannel(tx, tenantId, orderId, `Cancelado pelo iFood${reason ? `: ${String(reason).slice(0, 200)}` : ''}`);
      });
      return link?.orderId ? {} : { note: 'Cancelamento anotado: o pedido ainda não tinha chegado.' };
    }

    // Demais eventos: só a situação no iFood (o nosso status segue o painel e a cozinha).
    if (!link) return { ignored: true, note: 'Pedido ainda não recebido.' };
    if (FINAL_STATUSES.includes(link.externalStatus)) return { ignored: true, note: `Pedido já ${link.externalStatus === 'CANCELLED' ? 'cancelado' : 'concluído'} no iFood.` };
    await this.prisma.channelOrderLink.update({ where: { id: link.id }, data: { externalStatus: event.type } });
    return {};
  }
}
