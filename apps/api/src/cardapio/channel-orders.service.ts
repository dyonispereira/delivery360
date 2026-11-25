import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesChannel } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { CHANNEL_LABELS, MARKETPLACES, unitCost, type CostItem } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';
import { ChannelOrderDto, ChannelSettingDto, MarketplaceCode } from './cardapio.dto';
import { normalizePhone } from './order-pricing';
import { OrdersService } from './orders.service';

const code = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
};

/**
 * Pedidos que chegam dos apps de delivery (iFood, 99Food, Keeta).
 *
 * Cada integração converte o pedido do app para o formato único `ChannelOrderDto` e chama `importOrder`.
 * O item é reconhecido pelo código PDV (o mesmo em todos os canais), então a ficha técnica,
 * a cozinha, as entregas e a Gestão tratam o pedido do app igual ao da loja própria,
 * mas a receita fica separada por canal (contas 1.3 iFood, 1.6 99Food, 1.7 Keeta).
 */
@Injectable()
export class ChannelOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly catalog: CatalogService,
  ) {}

  listSettings(tenantId: string) {
    return this.catalog.channelConfigs(tenantId);
  }

  async updateSetting(tenantId: string, channel: MarketplaceCode, dto: ChannelSettingDto) {
    const data = { ...dto, merchantId: dto.merchantId === undefined ? undefined : dto.merchantId.trim() || null };
    await this.prisma.channelSetting.upsert({
      where: { tenantId_channel: { tenantId, channel } },
      update: data,
      create: { tenantId, channel, ...data },
    });
    return this.catalog.channelConfigs(tenantId);
  }

  /** Importa o pedido do app. Idempotente: o mesmo pedido (canal + id no app) entra uma vez só. */
  async importOrder(tenantId: string, dto: ChannelOrderDto) {
    const existing = await this.prisma.order.findUnique({
      where: { tenantId_channel_externalId: { tenantId, channel: dto.channel, externalId: dto.externalId } },
      select: { id: true, number: true },
    });
    if (existing) return { ...existing, duplicated: true, unmatched: [] as string[] };
    if (dto.items.length === 0) throw new BadRequestException('O pedido não tem itens.');
    if (dto.type === 'DELIVERY' && !dto.address) throw new BadRequestException('Informe o endereço de entrega.');

    const codes = [...new Set(dto.items.map((i) => i.pdvCode?.trim()).filter((c): c is string => !!c))];
    const products = await this.prisma.product.findMany({
      where: { tenantId, pdvCode: { in: codes } },
      include: { optionGroups: { include: { options: true } } },
    });

    const unmatched: string[] = [];
    const items = dto.items.map((i) => {
      const product = i.pdvCode ? products.find((p) => p.pdvCode === i.pdvCode!.trim()) : undefined;
      if (!product) unmatched.push(i.pdvCode ? `${i.name} (código ${i.pdvCode})` : `${i.name} (sem código PDV)`);
      const productOptions = product?.optionGroups.flatMap((g) => g.options) ?? [];
      const options = (i.options ?? []).map((o) => {
        const match =
          (o.pdvCode && productOptions.find((x) => x.pdvCode === o.pdvCode!.trim())) ||
          productOptions.find((x) => x.name.trim().toLowerCase() === o.name.trim().toLowerCase());
        const qty = o.quantity ?? 1;
        return {
          optionId: match ? match.id : null,
          groupName: o.groupName?.trim() || (match ? (product!.optionGroups.find((g) => g.id === match.groupId)?.name ?? 'Adicionais') : 'Adicionais'),
          name: qty > 1 ? `${qty}x ${o.name.trim()}` : o.name.trim(),
          priceCents: o.priceCents * qty,
          costCents: (match?.costCents ?? 0) * qty,
        };
      });
      const unitPriceCents = i.unitPriceCents + options.reduce((s, o) => s + o.priceCents, 0);
      return {
        productId: product?.id ?? null,
        // Nome do nosso cardápio: a cozinha vê o mesmo item, venha de onde vier.
        name: product?.name ?? i.name.trim(),
        unitPriceCents,
        unitCostCents: product ? unitCost((product.costItems as unknown as CostItem[]) ?? [], options.map((o) => o.costCents)) : 0,
        quantity: i.quantity,
        notes: i.notes?.trim() || null,
        totalCents: unitPriceCents * i.quantity,
        options: options.map(({ costCents: _c, ...o }) => o),
      };
    });

    const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
    const deliveryFeeCents = dto.type === 'DELIVERY' ? (dto.deliveryFeeCents ?? 0) : 0;
    const discountCents = Math.min(dto.discountCents ?? 0, subtotalCents + deliveryFeeCents);
    const totalCents = subtotalCents + deliveryFeeCents - discountCents;

    // Os apps às vezes mascaram o telefone (0800 + localizador): aí cada pedido vira um cliente à parte.
    const phone = normalizePhone(dto.customer.phone);
    const realPhone = phone && !phone.startsWith('0800') && !phone.startsWith('550800') ? phone : null;
    const customerKey = realPhone ?? `${dto.channel.toLowerCase()}-${dto.externalId}`.slice(0, 60);
    const label = CHANNEL_LABELS[dto.channel];

    try {
      const order = await this.orders.withOrderNumber(tenantId, async (tx, number) => {
        const customer = await tx.customer.upsert({
          where: { tenantId_phone: { tenantId, phone: customerKey } },
          update: { name: dto.customer.name.trim() },
          create: { tenantId, phone: customerKey, name: dto.customer.name.trim() },
        });
        const created = await tx.order.create({
          data: {
            tenantId,
            number,
            trackingCode: code(),
            customerId: customer.id,
            type: dto.type,
            status: 'PAID',
            channel: dto.channel,
            externalId: dto.externalId,
            externalCode: dto.externalCode?.trim() || null,
            deliveryCode: dto.deliveryCode ?? null,
            customerName: dto.customer.name.trim(),
            customerPhone: phone ?? '',
            addressStreet: dto.type === 'DELIVERY' ? dto.address!.street.trim() : null,
            addressNumber: dto.type === 'DELIVERY' ? dto.address!.number.trim() : null,
            addressComplement: dto.type === 'DELIVERY' ? dto.address!.complement?.trim() || null : null,
            addressReference: dto.type === 'DELIVERY' ? dto.address!.reference?.trim() || null : null,
            deliveryZoneName: dto.type === 'DELIVERY' ? dto.address!.neighborhood?.trim() || null : null,
            notes: dto.notes?.trim() || null,
            subtotalCents,
            deliveryFeeCents,
            discountCents,
            totalCents,
            paymentMethod: dto.paymentMethod,
            changeForCents: dto.paymentMethod === 'CASH_ON_DELIVERY' ? (dto.changeForCents ?? null) : null,
            items: {
              create: items.map(({ options, ...i }) => ({ ...i, options: { create: options } })),
            },
            statusHistory: {
              create: { status: 'PAID', note: `Pedido do ${label}${dto.externalCode ? ` ${dto.externalCode}` : ''}` },
            },
            payments: {
              create: {
                tenantId,
                provider: dto.paymentMethod === 'APP_ONLINE' ? dto.channel.toLowerCase() : 'offline',
                method: dto.paymentMethod,
                amountCents: totalCents,
                status: dto.paymentMethod === 'APP_ONLINE' ? 'PAID' : 'PENDING',
                paidAt: dto.paymentMethod === 'APP_ONLINE' ? new Date() : null,
                externalId: dto.externalId,
              },
            },
          },
        });
        await this.orders.publishReceived(tx, created.id, tenantId, totalCents, dto.paymentMethod);
        return created;
      });
      return { id: order.id, number: order.number, duplicated: false, unmatched };
    } catch (err) {
      // Duas entregas do mesmo pedido ao mesmo tempo: a segunda devolve o que já entrou.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.order.findUnique({
          where: { tenantId_channel_externalId: { tenantId, channel: dto.channel, externalId: dto.externalId } },
          select: { id: true, number: true },
        });
        if (again) return { ...again, duplicated: true, unmatched: [] as string[] };
      }
      throw err;
    }
  }

  /**
   * Pedido de teste de um app (só com PAYMENTS_FAKE_ENABLED=true): usa produtos que já têm código PDV,
   * com o preço cadastrado para o app. Serve para ver o caminho completo antes da integração real.
   */
  async simulate(tenantId: string, channel: MarketplaceCode) {
    if (process.env.PAYMENTS_FAKE_ENABLED !== 'true') throw new ForbiddenException('Simulação desligada neste ambiente.');
    const products = await this.prisma.product.findMany({
      where: { tenantId, pdvCode: { not: null }, active: true },
      include: { optionGroups: { include: { options: true }, orderBy: { position: 'asc' } } },
      take: 20,
    });
    if (products.length === 0) throw new NotFoundException('Cadastre o código PDV em pelo menos um produto para simular.');
    const pick = products.sort(() => Math.random() - 0.5).slice(0, Math.min(2, products.length));
    const n = Math.floor(1000 + Math.random() * 9000);
    const prices = (p: (typeof products)[number]) => ((p.channelPrices ?? {}) as Partial<Record<SalesChannel, number>>)[channel] ?? p.priceCents;
    return this.importOrder(tenantId, {
      channel,
      externalId: `teste-${code()}`,
      externalCode: `#${n}`,
      type: 'DELIVERY',
      customer: { name: 'Cliente de teste', phone: '0800 000 0000' },
      address: { street: 'Rua de Teste', number: String(n % 500), neighborhood: 'Centro' },
      items: pick.map((p) => {
        // Grupos obrigatórios: escolhe a primeira opção, como faria o cliente no app.
        const required = p.optionGroups.filter((g) => g.minSelect > 0 && g.options.length > 0);
        return {
          pdvCode: p.pdvCode!,
          name: p.name,
          quantity: 1,
          unitPriceCents: prices(p),
          options: required.map((g) => ({ pdvCode: g.options[0].pdvCode ?? undefined, name: g.options[0].name, groupName: g.name, priceCents: g.options[0].priceCents })),
        };
      }),
      deliveryFeeCents: 0,
      paymentMethod: 'APP_ONLINE',
      deliveryCode: String(n),
      notes: 'Pedido de teste (simulado)',
    });
  }

  isMarketplace(c: string): c is MarketplaceCode {
    return (MARKETPLACES as string[]).includes(c);
  }
}
