import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campaign, Prisma } from '@prisma/client';
import type { AuthUser } from '../access/access.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CampaignDto } from './cardapio.dto';
import { CouponRule, couponLabel } from './coupon-rules';

const date = (v: string | null | undefined) => (v ? new Date(v) : null);

/** Lojas da campanha: todas (lista vazia) ou as escolhidas; e que não saíram dela. */
export const campaignForTenant = (tenantId: string): Prisma.CampaignWhereInput => ({
  OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }],
  NOT: { optedOutTenantIds: { has: tenantId } },
});

/** A campanha vista como regra de cupom (vale para o pedido inteiro). */
export const campaignRule = (c: Campaign): CouponRule => ({ ...c, code: c.couponCode ?? '', productIds: [] });

/**
 * Só a Delivery360 cria e altera banners. O restaurante pode sair apenas das campanhas cujo cupom custa algo
 * para ele (100% dele ou misto); banner de divulgação e cupom 100% Delivery360 ficam sempre.
 */
export const canOptOut = (c: Pick<Campaign, 'couponCode' | 'platformShareBps'>) => !!c.couponCode && c.platformShareBps < 10_000;

/** Parte do desconto bancada pela Delivery360 (o restante é do restaurante). */
export const platformPart = (discountCents: number, shareBps: number) => Math.round((discountCents * shareBps) / 10_000);

export const fundedByShare = (shareBps: number) => (shareBps >= 10_000 ? 'PLATFORM' : shareBps <= 0 ? 'RESTAURANT' : 'MIXED');

/**
 * Campanhas da rede: a equipe Delivery360 cria o banner (e, se quiser, um cupom) e escolhe as lojas.
 * O custo do cupom se divide entre a Delivery360 e o restaurante conforme platformShareBps.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista da equipe, com o resultado de cada campanha somando todas as lojas. */
  async list() {
    const [campaigns, stats, tenants] = await Promise.all([
      this.prisma.campaign.findMany({ orderBy: [{ active: 'desc' }, { position: 'asc' }, { createdAt: 'desc' }] }),
      this.prisma.order.groupBy({
        by: ['campaignId'],
        where: { campaignId: { not: null }, status: { notIn: ['CANCELLED', 'AWAITING_PAYMENT'] } },
        _count: { _all: true },
        _sum: { discountCents: true, couponPlatformCents: true, totalCents: true },
      }),
      this.prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const byId = new Map(stats.map((s) => [s.campaignId, s]));
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      tenants,
      campaigns: campaigns.map((c) => {
        const s = byId.get(c.id);
        return {
          ...c,
          label: c.couponCode ? couponLabel(c) : null,
          optedOut: c.optedOutTenantIds.map((id) => ({ id, name: names.get(id) ?? 'Loja removida' })),
          uses: s?._count._all ?? 0,
          discountGivenCents: s?._sum.discountCents ?? 0,
          platformCostCents: s?._sum.couponPlatformCents ?? 0,
          salesCents: s?._sum.totalCents ?? 0,
        };
      }),
    };
  }

  async create(user: AuthUser, dto: CampaignDto) {
    const data = await this.check(dto);
    try {
      const c = await this.prisma.campaign.create({ data });
      await this.audit.log({ userId: user.id, action: 'campaign.create', entity: 'campaign', entityId: c.id, after: c });
      return c;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  async update(user: AuthUser, id: string, dto: CampaignDto) {
    const before = await this.prisma.campaign.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Campanha não encontrada.');
    const data = await this.check(dto);
    try {
      const after = await this.prisma.campaign.update({ where: { id }, data });
      await this.audit.log({ userId: user.id, action: 'campaign.update', entity: 'campaign', entityId: id, before, after });
      return after;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  /** Campanha já usada em pedido não some: só desativa. */
  async remove(user: AuthUser, id: string) {
    const before = await this.prisma.campaign.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Campanha não encontrada.');
    if ((await this.prisma.order.count({ where: { campaignId: id } })) > 0) {
      await this.prisma.campaign.update({ where: { id }, data: { active: false } });
      await this.audit.log({ userId: user.id, action: 'campaign.deactivate', entity: 'campaign', entityId: id, before });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.campaign.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'campaign.delete', entity: 'campaign', entityId: id, before });
    return { deleted: true, deactivated: false };
  }

  /** Campanhas em que o restaurante está (ou de que saiu), para o painel dele. */
  async forTenant(tenantId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { active: true, OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }] },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    return campaigns
      .filter((c) => !c.endsAt || c.endsAt > now)
      .map((c) => ({
        id: c.id,
        title: c.title,
        subtitle: c.subtitle,
        imageUrl: c.imageUrl,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        couponCode: c.couponCode,
        label: c.couponCode ? couponLabel(c) : null,
        platformShareBps: c.platformShareBps,
        participating: !c.optedOutTenantIds.includes(tenantId),
        canOptOut: canOptOut(c),
      }));
  }

  /** O restaurante entra ou sai de uma campanha (sair só quando o cupom tem custo para ele). */
  async setParticipation(tenantId: string, user: AuthUser, id: string, participating: boolean) {
    const c = await this.prisma.campaign.findFirst({
      where: { id, active: true, OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenantId } }] },
    });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    if (!participating && !canOptOut(c)) {
      throw new ForbiddenException('Esta campanha não tem custo para você: a Delivery360 banca tudo, por isso ela fica na sua loja.');
    }
    const out = new Set(c.optedOutTenantIds);
    if (participating) out.delete(tenantId);
    else out.add(tenantId);
    await this.prisma.campaign.update({ where: { id }, data: { optedOutTenantIds: [...out] } });
    await this.audit.log({
      tenantId,
      userId: user.id,
      action: participating ? 'campaign.join' : 'campaign.leave',
      entity: 'campaign',
      entityId: id,
    });
    return { participating };
  }

  /** Banners ativos agora na loja: os de divulgação da rede intercalados com os de oferta da própria loja. */
  async banners(tenantId: string, now = new Date()) {
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        active: true,
        AND: [
          campaignForTenant(tenantId),
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      take: 12,
    });
    const network = campaigns.filter((c) => c.tenantIds.length === 0);
    const store = campaigns.filter((c) => c.tenantIds.length > 0);
    const mixed: Campaign[] = [];
    for (let i = 0; i < Math.max(network.length, store.length); i++) {
      if (network[i]) mixed.push(network[i]);
      if (store[i]) mixed.push(store[i]);
    }
    return mixed.slice(0, 8).map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      imageUrl: c.imageUrl,
      couponCode: c.couponCode,
      label: c.couponCode ? couponLabel(c) : null,
      network: c.tenantIds.length === 0,
      fullArt: c.fullArt,
    }));
  }

  /** Cupom de campanha que vale nesta loja (ou null). As datas e limites são conferidos depois, com mensagem. */
  findCoupon(tenantId: string, code: string) {
    return this.prisma.campaign.findFirst({ where: { couponCode: code, AND: [campaignForTenant(tenantId)] } });
  }

  /** Usos do cupom da campanha: no total e por telefone, somando a rede; primeiro pedido = primeiro nesta loja. */
  async uses(tenantId: string, c: Campaign, phone: string | null) {
    const used = { campaignId: c.id, status: { not: 'CANCELLED' as const } };
    const [usesTotal, usesByCustomer, customerOrders] = await Promise.all([
      this.prisma.order.count({ where: used }),
      phone ? this.prisma.order.count({ where: { ...used, customerPhone: phone } }) : null,
      phone && c.firstOrderOnly ? this.prisma.order.count({ where: { tenantId, customerPhone: phone, status: { not: 'CANCELLED' } } }) : null,
    ]);
    return { usesTotal, usesByCustomer, customerHasOrders: customerOrders == null ? null : customerOrders > 0 };
  }

  private async check(dto: CampaignDto): Promise<Prisma.CampaignCreateInput> {
    const code = dto.couponCode?.trim().toUpperCase() || null;
    const type = dto.type ?? 'PERCENT';
    const value = type === 'FREE_DELIVERY' ? 0 : (dto.value ?? 0);
    if (code) {
      if (type === 'PERCENT' && (value < 100 || value > 10_000)) throw new BadRequestException('O percentual precisa ser de 1% a 100%.');
      if (type === 'FIXED' && value < 1) throw new BadRequestException('Informe o valor do desconto.');
    }
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new BadRequestException('O fim precisa ser depois do início.');
    }
    const tenantIds = [...new Set(dto.tenantIds ?? [])];
    if (tenantIds.length && (await this.prisma.tenant.count({ where: { id: { in: tenantIds } } })) !== tenantIds.length) {
      throw new BadRequestException('Uma das lojas escolhidas não existe.');
    }
    // O código da campanha não pode bater com o cupom próprio de uma loja participante.
    if (code) {
      const clash = await this.prisma.coupon.findFirst({
        where: { code, ...(tenantIds.length ? { tenantId: { in: tenantIds } } : {}) },
        select: { tenant: { select: { name: true } } },
      });
      if (clash) throw new ConflictException(`A loja ${clash.tenant.name} já tem um cupom com esse código. Escolha outro.`);
    }
    return {
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || null,
      imageUrl: dto.imageUrl.trim(),
      tenantIds,
      startsAt: date(dto.startsAt),
      endsAt: date(dto.endsAt),
      active: dto.active ?? true,
      position: dto.position ?? 0,
      fullArt: dto.fullArt ?? false,
      couponCode: code,
      type,
      value,
      maxDiscountCents: type === 'PERCENT' ? (dto.maxDiscountCents ?? null) : null,
      minOrderCents: dto.minOrderCents ?? 0,
      weekdays: [...new Set(dto.weekdays ?? [])].sort((a, b) => a - b),
      maxUses: dto.maxUses ?? null,
      maxUsesPerCustomer: dto.maxUsesPerCustomer === undefined ? 1 : dto.maxUsesPerCustomer,
      firstOrderOnly: dto.firstOrderOnly ?? false,
      combinesWithPromo: dto.combinesWithPromo ?? false,
      // Só banner: nada a dividir.
      platformShareBps: code ? (dto.platformShareBps ?? 10_000) : 10_000,
    };
  }

  private duplicate(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('Já existe uma campanha com esse código.');
    }
    return e;
  }
}
