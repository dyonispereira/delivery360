import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../access/access.types';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { CouponDto, UpdateCouponDto } from './cardapio.dto';
import { couponLabel } from './coupon-rules';

const date = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);

/** Cupons do restaurante (loja própria). Sempre filtrando pelo restaurante atual. */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista com o resultado de cada cupom: usos, desconto dado e vendas que trouxe. */
  async list(tenantId: string) {
    const [coupons, stats, boosts, products] = await Promise.all([
      this.prisma.coupon.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.order.groupBy({
        by: ['couponId'],
        where: { tenantId, couponId: { not: null }, status: { notIn: ['CANCELLED', 'AWAITING_PAYMENT'] } },
        _count: { _all: true },
        _sum: { discountCents: true, totalCents: true },
      }),
      this.prisma.order.groupBy({
        by: ['platformCouponId'],
        where: { tenantId, platformCouponId: { not: null }, status: { notIn: ['CANCELLED', 'AWAITING_PAYMENT'] } },
        _count: { _all: true },
        _sum: { platformDiscountCents: true, totalCents: true },
      }),
      this.prisma.product.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(products.map((p) => [p.id, p.name]));
    const byId = new Map(stats.map((s) => [s.couponId, { uses: s._count._all, discount: s._sum.discountCents ?? 0, sales: s._sum.totalCents ?? 0 }]));
    const byBoost = new Map(boosts.map((s) => [s.platformCouponId, { uses: s._count._all, discount: s._sum.platformDiscountCents ?? 0, sales: s._sum.totalCents ?? 0 }]));
    return coupons.map((c) => {
      const s = (c.fundedBy === 'PLATFORM' ? byBoost : byId).get(c.id);
      return {
        ...c,
        label: couponLabel(c, c.productIds.map((id) => names.get(id)).filter((n): n is string => !!n)),
        uses: s?.uses ?? 0,
        discountGivenCents: s?.discount ?? 0,
        salesCents: s?.sales ?? 0,
      };
    });
  }

  /**
   * Criado pela equipe Delivery360 = impulso Delivery360: bancado por nós, entra sozinho nos pedidos (sem código)
   * e soma com o cupom do restaurante. O restaurante vê, mas não altera nem apaga.
   */
  private guard(user: AuthUser, coupon: { fundedBy: string }) {
    if (coupon.fundedBy === 'PLATFORM' && !user.staffRole) {
      throw new ForbiddenException('Este cupom é bancado pela Delivery360. Para mudar, fale com a gente.');
    }
  }

  async create(tenantId: string, user: AuthUser, dto: CouponDto) {
    const userId = user.id;
    const platform = !!user.staffRole;
    // O impulso não tem código para o cliente: geramos um interno só para identificar.
    if (platform) dto = { ...dto, code: `IMPULSO-${randomBytes(4).toString('hex').toUpperCase()}`, public: false };
    if (!dto.code) throw new BadRequestException('Informe o código do cupom.');
    await this.checkProducts(tenantId, dto.productIds);
    const data = this.check({ ...dto, code: dto.code.toUpperCase() });
    try {
      const c = await this.prisma.coupon.create({
        data: {
          tenantId,
          ...data,
          code: dto.code.toUpperCase(),
          type: dto.type,
          value: dto.value,
          fundedBy: platform ? 'PLATFORM' : 'RESTAURANT',
        } as Prisma.CouponUncheckedCreateInput,
      });
      await this.audit.log({ tenantId, userId, action: 'coupon.create', entity: 'coupon', entityId: c.id, after: c });
      return c;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  async update(tenantId: string, user: AuthUser, id: string, dto: UpdateCouponDto) {
    const userId = user.id;
    const before = await this.prisma.coupon.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Cupom não encontrado.');
    this.guard(user, before);
    // Valida o cupom como ficará depois da alteração.
    this.check({
      type: dto.type ?? before.type,
      value: dto.value ?? before.value,
      startsAt: dto.startsAt === undefined ? before.startsAt?.toISOString() : dto.startsAt,
      endsAt: dto.endsAt === undefined ? before.endsAt?.toISOString() : dto.endsAt,
    });
    await this.checkProducts(tenantId, dto.productIds);
    const data = this.check({ ...dto, code: dto.code?.toUpperCase() });
    try {
      const after = await this.prisma.coupon.update({ where: { id }, data });
      await this.audit.log({ tenantId, userId, action: 'coupon.update', entity: 'coupon', entityId: id, before, after });
      return after;
    } catch (e) {
      throw this.duplicate(e);
    }
  }

  /** Cupom já usado não some: só desativa, para o histórico dos pedidos continuar fazendo sentido. */
  async remove(tenantId: string, user: AuthUser, id: string) {
    const userId = user.id;
    const before = await this.prisma.coupon.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Cupom não encontrado.');
    this.guard(user, before);
    const used = await this.prisma.order.count({ where: { tenantId, OR: [{ couponId: id }, { platformCouponId: id }] } });
    if (used > 0) {
      await this.prisma.coupon.update({ where: { id }, data: { active: false } });
      await this.audit.log({ tenantId, userId, action: 'coupon.deactivate', entity: 'coupon', entityId: id, before });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.coupon.delete({ where: { id } });
    await this.audit.log({ tenantId, userId, action: 'coupon.delete', entity: 'coupon', entityId: id, before });
    return { deleted: true, deactivated: false };
  }

  /** Regras de cadastro. Devolve os campos prontos para o banco. */
  private check(dto: Partial<CouponDto>) {
    if (dto.type === 'PERCENT' && dto.value != null && (dto.value < 100 || dto.value > 10_000)) {
      throw new BadRequestException('O percentual precisa ser de 1% a 100%.');
    }
    if (dto.type === 'FIXED' && dto.value != null && dto.value < 1) throw new BadRequestException('Informe o valor do desconto.');
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new BadRequestException('O fim precisa ser depois do início.');
    }
    const data: Prisma.CouponUpdateInput = {
      code: dto.code,
      description: dto.description === undefined ? undefined : dto.description.trim() || null,
      type: dto.type,
      value: dto.type === 'FREE_DELIVERY' ? 0 : dto.value,
      maxDiscountCents: dto.type && dto.type !== 'PERCENT' ? null : dto.maxDiscountCents,
      minOrderCents: dto.minOrderCents,
      startsAt: date(dto.startsAt),
      endsAt: date(dto.endsAt),
      weekdays: dto.weekdays ? [...new Set(dto.weekdays)].sort((a, b) => a - b) : undefined,
      maxUses: dto.maxUses,
      maxUsesPerCustomer: dto.maxUsesPerCustomer,
      firstOrderOnly: dto.firstOrderOnly,
      combinesWithPromo: dto.combinesWithPromo,
      productIds: dto.productIds ? [...new Set(dto.productIds)] : undefined,
      public: dto.public,
      active: dto.active,
    };
    return data;
  }

  /** Produto do cupom precisa ser deste restaurante. */
  private async checkProducts(tenantId: string, ids: string[] | undefined) {
    if (!ids?.length) return;
    const found = await this.prisma.product.count({ where: { tenantId, id: { in: [...new Set(ids)] } } });
    if (found !== new Set(ids).size) throw new BadRequestException('Um dos produtos do cupom não existe neste cardápio.');
  }

  private duplicate(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('Já existe um cupom com esse código.');
    }
    return e;
  }
}
