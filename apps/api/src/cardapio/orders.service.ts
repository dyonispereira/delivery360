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
import { CreateOrderDto, QuoteOrderDto, RateOrderDto, TipDto } from './cardapio.dto';
import { CouponError, couponDiscount, couponLabel } from './coupon-rules';
import { activePromoPrice, effectivePrice, unitCost, type CostItem } from '@delivery360/shared';
import { MenuProduct, OrderValidationError, normalizePhone, priceOrder } from './order-pricing';
import { ACTIVE_STATUSES, canTransition } from './order-status';
import { AuditService } from '../core/audit.service';
import { CampaignsService, campaignRule, fundedByShare, platformPart } from './campaigns.service';
import { closeBatchIfDone } from '../entregas/batch-utils';

/** Pagamentos que dependem de confirmação do gateway antes de o pedido entrar na operação. */
const ONLINE_METHODS: PaymentMethod[] = ['PIX', 'CREDIT_CARD'];

/** Até quantos dias depois de receber o cliente ainda pode avaliar e dar gorjeta. */
const FEEDBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Opção indisponível se ela ou o produto do cardápio que ela representa (no combo) está em falta ou fora do cardápio. */
function optionAvailable(o: { available: boolean; linkedProduct?: { active: boolean; available: boolean } | null }) {
  return o.available && (!o.linkedProduct || (o.linkedProduct.active && o.linkedProduct.available));
}

interface PublicMenuProduct {
  id: string;
  priceCents: number;
  promoPriceCents: number | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
  available: boolean;
  isCombo: boolean;
  costItems: Prisma.JsonValue;
  optionGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: {
      id: string;
      name: string;
      priceCents: number;
      available: boolean;
      linkedProductId: string | null;
      linkedProduct: { active: boolean; available: boolean; priceCents: number; promoPriceCents: number | null; promoStartsAt: Date | null; promoEndsAt: Date | null } | null;
    }[];
  }[];
}

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
    private readonly campaigns: CampaignsService,
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
    const now = new Date();
    const [categories, zones, ratings, top, coupons, banners] = await Promise.all([
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
              promoPriceCents: true,
              promoStartsAt: true,
              promoEndsAt: true,
              imageUrl: true,
              available: true,
              isCombo: true,
              costItems: true,
              optionGroups: {
                orderBy: { position: 'asc' },
                select: {
                  id: true,
                  name: true,
                  minSelect: true,
                  maxSelect: true,
                  options: {
                    orderBy: { position: 'asc' },
                    select: {
                      id: true,
                      name: true,
                      priceCents: true,
                      available: true,
                      linkedProductId: true,
                      linkedProduct: { select: { active: true, available: true, priceCents: true, promoPriceCents: true, promoStartsAt: true, promoEndsAt: true } },
                    },
                  },
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
      // Cupons que a loja mostra na faixa (os outros só funcionam para quem tem o código) e os impulsos Delivery360.
      this.prisma.coupon.findMany({
        where: {
          tenantId,
          active: true,
          OR: [{ public: true, fundedBy: 'RESTAURANT' }, { fundedBy: 'PLATFORM' }],
          AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          _count: {
            select: {
              orders: { where: { status: { not: 'CANCELLED' } } },
              boostedOrders: { where: { status: { not: 'CANCELLED' } } },
            },
          },
        },
      }),
      // Banners das campanhas da rede (criados pela equipe Delivery360).
      this.campaigns.banners(tenantId, now),
    ]);
    const names = new Map(categories.flatMap((c) => c.products.map((p) => [p.id, p.name] as const)));
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
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({ ...c, products: c.products.map((p) => this.publicProduct(p, now)) })),
      upsellProductIds: this.upsell(categories.flatMap((c) => c.products), top.map((t) => t.productId!), now),
      coupons: coupons
        .filter((c) => c.fundedBy === 'RESTAURANT' && (c.maxUses == null || c._count.orders < c.maxUses))
        .slice(0, 6)
        .map((c) => ({
          code: c.code,
          label: couponLabel(c, c.productIds.map((id) => names.get(id)).filter((n): n is string => !!n)),
          productIds: c.productIds,
          description: c.description,
          type: c.type,
          minOrderCents: c.minOrderCents,
          firstOrderOnly: c.firstOrderOnly,
          weekdays: c.weekdays,
          endsAt: c.endsAt,
        })),
      // Desconto especial automático: a loja marca os produtos e o carrinho já desconta, sem código.
      offers: coupons
        .filter((c) => c.fundedBy === 'PLATFORM' && (c.maxUses == null || c._count.boostedOrders < c.maxUses))
        .map((c) => ({
          label: couponLabel(c, c.productIds.map((id) => names.get(id)).filter((n): n is string => !!n)),
          type: c.type,
          productIds: c.productIds,
          minOrderCents: c.minOrderCents,
          firstOrderOnly: c.firstOrderOnly,
          weekdays: c.weekdays,
          endsAt: c.endsAt,
        })),
      topProductIds: top.map((t) => t.productId!).filter((id) => visible.has(id)).slice(0, 8),
      banners,
      zones,
    };
  }

  /** Produto como a loja mostra: preço de hoje e, na promoção, o preço normal riscado e o fim. */
  private publicProduct(p: PublicMenuProduct, now: Date) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { promoPriceCents, promoStartsAt, promoEndsAt, costItems, optionGroups, ...rest } = p;
    const promo = activePromoPrice(p, now);
    const price = promo ?? p.priceCents;
    const groups = optionGroups.map((g) => ({
      ...g,
      options: g.options.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, available: optionAvailable(o), productId: o.linkedProductId })),
    }));
    // Combo: quanto sairiam separados os itens mais baratos de cada etapa (só os que são produtos do cardápio).
    let separate = 0;
    if (p.isCombo) {
      for (const g of optionGroups) {
        const prices = g.options
          .filter((o) => o.linkedProduct && optionAvailable(o))
          .map((o) => effectivePrice(o.linkedProduct!, now) + o.priceCents)
          .sort((a, b) => a - b);
        separate += prices.slice(0, g.minSelect).reduce((s, x) => s + x, 0);
      }
    }
    return {
      ...rest,
      optionGroups: groups,
      priceCents: price,
      listPriceCents: promo != null ? p.priceCents : null,
      promoEndsAt: promo != null ? promoEndsAt : null,
      /** Combo: preço dos itens comprados separados (null se não compensa mostrar). */
      comboSeparateCents: p.isCombo && separate > price ? separate : null,
    };
  }

  /**
   * "Peça também" no carrinho: produtos sem escolha obrigatória, que não são combo, do maior para o
   * menor lucro por real vendido (pela ficha técnica). Sem ficha técnica, entram depois, pelos mais pedidos.
   */
  private upsell(products: PublicMenuProduct[], topIds: string[], now: Date) {
    const rank = (id: string) => (topIds.includes(id) ? topIds.indexOf(id) : 999);
    return products
      .filter((p) => p.available && !p.isCombo && !p.optionGroups.some((g) => g.minSelect > 0))
      .map((p) => {
        const price = effectivePrice(p, now);
        const cost = unitCost((p.costItems as unknown as CostItem[]) ?? []);
        return { id: p.id, margin: cost > 0 && price > 0 ? (price - cost) / price : -1 };
      })
      .sort((a, b) => b.margin - a.margin || rank(a.id) - rank(b.id))
      .slice(0, 8)
      .map((x) => x.id);
  }

  /**
   * Preço do pedido como o servidor calcula (o que vale é isto, nunca o navegador):
   * cardápio de hoje, promoções, taxa do bairro e o cupom, se veio.
   */
  private async quoteFor(
    store: Awaited<ReturnType<OrdersService['findPublicStore']>>,
    input: {
      type: 'DELIVERY' | 'PICKUP';
      zoneId?: string;
      paymentMethod?: PaymentMethod;
      changeForCents?: number;
      items: CreateOrderDto['items'];
      couponCode?: string;
    },
    phone: string | null,
    /** Entrega sem bairro escolhido ainda: calcula sem taxa (só na prévia). */
    zoneless = false,
  ) {
    const tenantId = store.tenantId;
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const [products, zones] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, id: { in: productIds } },
        include: {
          category: { select: { active: true } },
          optionGroups: {
            include: { options: { include: { linkedProduct: { select: { active: true, available: true, costItems: true } } } } },
          },
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
        optionIds.map((id) => {
          const o = options.find((x) => x.id === id);
          if (!o) return 0;
          // Item de combo que é produto do cardápio: custo da ficha técnica dele.
          return o.costCents + (o.linkedProduct ? unitCost((o.linkedProduct.costItems as unknown as CostItem[]) ?? []) : 0);
        }),
      );
    };
    const now = new Date();
    const menu = new Map<string, MenuProduct>(
      products.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          priceCents: effectivePrice(p, now),
          listPriceCents: p.priceCents,
          active: p.active,
          available: p.available,
          categoryActive: p.category.active,
          optionGroups: p.optionGroups.map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, available: optionAvailable(o) })),
          })),
        },
      ]),
    );

    let priced;
    try {
      priced = priceOrder(
        {
          type: zoneless ? 'PICKUP' : input.type,
          zoneId: input.zoneId,
          paymentMethod: input.paymentMethod ?? (store.paymentMethods.find((m) => m !== 'CREDIT_CARD') as PaymentMethod),
          // O troco é conferido depois do cupom, contra o total final.
          items: input.items,
        },
        zoneless ? { ...store, acceptsPickup: true } : store,
        menu,
        zones,
      );
    } catch (err) {
      if (err instanceof OrderValidationError) throw new BadRequestException(err.message);
      throw err;
    }

    const items = priced.items.map((i) => ({ productId: i.productId, totalCents: i.totalCents, promo: i.listUnitPriceCents > i.unitPriceCents }));
    const base = { now, subtotalCents: priced.subtotalCents, items, deliveryFeeCents: priced.deliveryFeeCents, orderType: input.type };

    // Cupom pelo código que o cliente digitou: o da loja ou o de uma campanha da rede de que a loja participa.
    let coupon: {
      id: string | null;
      campaignId: string | null;
      code: string;
      discountCents: number;
      /** Parte do desconto bancada pela Delivery360 (campanha). */
      platformCents: number;
      fundedBy: 'RESTAURANT' | 'PLATFORM' | 'MIXED';
      label: string;
      promoExcluded: boolean;
    } | null = null;
    const code = input.couponCode?.trim().toUpperCase();
    if (code) {
      const c = await this.prisma.coupon.findUnique({ where: { tenantId_code: { tenantId, code } } });
      const campaign = !c ? await this.campaigns.findCoupon(tenantId, code) : null;
      try {
        if (c && c.fundedBy === 'RESTAURANT') {
          const productNames = await this.couponProductNames(tenantId, c.productIds);
          const discountCents = couponDiscount(c, { ...base, productNames, ...(await this.couponUses(tenantId, c, 'couponId', phone)) });
          const counted = c.productIds.length ? items.filter((i) => c.productIds.includes(i.productId)) : items;
          coupon = {
            id: c.id,
            campaignId: null,
            code: c.code,
            discountCents,
            platformCents: 0,
            fundedBy: 'RESTAURANT',
            label: couponLabel(c, productNames),
            promoExcluded: c.type !== 'FREE_DELIVERY' && !c.combinesWithPromo && counted.some((i) => i.promo),
          };
        } else if (campaign) {
          const discountCents = couponDiscount(campaignRule(campaign), { ...base, ...(await this.campaigns.uses(tenantId, campaign, phone)) });
          coupon = {
            id: null,
            campaignId: campaign.id,
            code,
            discountCents,
            platformCents: platformPart(discountCents, campaign.platformShareBps),
            fundedBy: fundedByShare(campaign.platformShareBps),
            label: couponLabel(campaign),
            promoExcluded: campaign.type !== 'FREE_DELIVERY' && !campaign.combinesWithPromo && items.some((i) => i.promo),
          };
        } else {
          throw new BadRequestException('Cupom não encontrado. Confira o código.');
        }
      } catch (err) {
        if (err instanceof CouponError) throw new BadRequestException(err.message);
        throw err;
      }
    }

    // Impulso Delivery360: entra sozinho, o maior que se encaixar, e soma com o cupom do restaurante.
    let boost: { id: string; label: string; discountCents: number } | null = null;
    const boosts = await this.prisma.coupon.findMany({ where: { tenantId, fundedBy: 'PLATFORM', active: true } });
    for (const b of boosts) {
      try {
        const d = couponDiscount(b, { ...base, ...(await this.couponUses(tenantId, b, 'platformCouponId', phone)) });
        if (d > 0 && (!boost || d > boost.discountCents)) {
          boost = { id: b.id, label: couponLabel(b, await this.couponProductNames(tenantId, b.productIds)), discountCents: d };
        }
      } catch (err) {
        if (!(err instanceof CouponError)) throw err;
      }
    }
    // Os dois descontos juntos nunca passam do valor do pedido.
    if (boost) boost.discountCents = Math.min(boost.discountCents, priced.totalCents - (coupon?.discountCents ?? 0));
    if (boost && boost.discountCents <= 0) boost = null;

    const totalCents = priced.totalCents - (coupon?.discountCents ?? 0) - (boost?.discountCents ?? 0);
    if (input.paymentMethod === 'CASH_ON_DELIVERY' && input.changeForCents != null && input.changeForCents < totalCents) {
      throw new BadRequestException(`O troco precisa ser para um valor maior que o total (R$ ${(totalCents / 100).toFixed(2).replace('.', ',')}).`);
    }
    return { priced, costOf, coupon, boost, totalCents };
  }

  /** Usos do cupom (ou do impulso) em pedidos não cancelados: no total, por este telefone e se o cliente já pediu. */
  private async couponUses(tenantId: string, c: { id: string; firstOrderOnly: boolean }, field: 'couponId' | 'platformCouponId', phone: string | null) {
    const used = { tenantId, [field]: c.id, status: { not: 'CANCELLED' as const } };
    const [usesTotal, usesByCustomer, customerOrders] = await Promise.all([
      this.prisma.order.count({ where: used }),
      phone ? this.prisma.order.count({ where: { ...used, customerPhone: phone } }) : null,
      phone && c.firstOrderOnly ? this.prisma.order.count({ where: { tenantId, customerPhone: phone, status: { not: 'CANCELLED' } } }) : null,
    ]);
    return { usesTotal, usesByCustomer, customerHasOrders: customerOrders == null ? null : customerOrders > 0 };
  }

  /** Nomes dos produtos de um cupom de produto (para o rótulo e as mensagens). */
  private async couponProductNames(tenantId: string, ids: string[]) {
    if (!ids.length) return [];
    const products = await this.prisma.product.findMany({ where: { tenantId, id: { in: ids } }, select: { name: true } });
    return products.map((p) => p.name);
  }

  /** Conta do carrinho antes de fechar: subtotal, taxa, promoções e cupom, calculados pelo servidor. */
  async quotePublicOrder(slug: string, dto: QuoteOrderDto) {
    const store = await this.findPublicStore(slug);
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    // Antes de escolher o bairro a taxa ainda não existe: calcula sem ela.
    const zoneless = dto.type === 'DELIVERY' && !dto.zoneId;
    const { priced, coupon, boost, totalCents } = await this.quoteFor(store, dto, phone, zoneless);
    return {
      subtotalCents: priced.subtotalCents,
      promoDiscountCents: priced.promoDiscountCents,
      deliveryFeeCents: priced.deliveryFeeCents,
      discountCents: coupon?.discountCents ?? 0,
      coupon: coupon ? { code: coupon.code, label: coupon.label, discountCents: coupon.discountCents, promoExcluded: coupon.promoExcluded } : null,
      /** Desconto especial automático (impulso Delivery360). */
      platformDiscountCents: boost?.discountCents ?? 0,
      totalCents,
      zonePending: zoneless,
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

    const { priced, costOf, coupon, boost, totalCents } = await this.quoteFor(store, { ...dto, zoneId: dto.address?.zoneId }, phone);

    const online = ONLINE_METHODS.includes(dto.paymentMethod);
    const charge = online
      ? await this.gateway.createCharge({
          paymentId: 'pending',
          amountCents: totalCents,
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
          promoDiscountCents: priced.promoDiscountCents,
          discountCents: coupon?.discountCents ?? 0,
          couponId: coupon?.id ?? null,
          couponCode: coupon?.code ?? null,
          couponFundedBy: coupon?.fundedBy ?? null,
          campaignId: coupon?.campaignId ?? null,
          couponPlatformCents: coupon?.platformCents ?? 0,
          platformDiscountCents: boost?.discountCents ?? 0,
          platformCouponId: boost?.id ?? null,
          deliveryFeeCents: priced.deliveryFeeCents,
          totalCents: totalCents,
          paymentMethod: dto.paymentMethod,
          changeForCents: dto.paymentMethod === 'CASH_ON_DELIVERY' ? (dto.changeForCents ?? null) : null,
          utmSource: dto.utmSource || null,
          utmCampaign: dto.utmCampaign || null,
          items: {
            create: priced.items.map((i) => ({
              productId: i.productId,
              name: i.name,
              unitPriceCents: i.unitPriceCents,
              listUnitPriceCents: i.listUnitPriceCents,
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
              amountCents: totalCents,
              externalId: charge?.externalId ?? null,
              pixCopyPaste: charge?.pixCopyPaste ?? null,
              expiresAt: charge?.expiresAt ?? null,
            },
          },
        },
      });
      if (!online) await this.publishReceived(tx, created.id, tenantId, totalCents, dto.paymentMethod);
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
      promoDiscountCents: order.promoDiscountCents,
      discountCents: order.discountCents,
      couponCode: order.couponCode,
      platformDiscountCents: order.platformDiscountCents,
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
