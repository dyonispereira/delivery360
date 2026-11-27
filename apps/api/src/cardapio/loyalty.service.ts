import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { levelFor, makeReferralCode, nextLevel, pointsFor } from './loyalty-rules';
import type { ClubLevelDto, LoyaltyAdjustDto, LoyaltyProgramDto, LoyaltyRewardDto } from './cardapio.dto';

type Db = Prisma.TransactionClient | PrismaService;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PROGRAM_DEFAULTS = {
  enabled: false,
  pointsPerReal: 1,
  expireDays: 0,
  clubEnabled: false,
  referralEnabled: false,
  referralFriendCents: 1000,
  referralMinOrderCents: 3000,
  referralReferrerPoints: 100,
};

export async function loyaltyProgram(db: Db, tenantId: string) {
  return (await db.loyaltyProgram.findUnique({ where: { tenantId } })) ?? { tenantId, ...PROGRAM_DEFAULTS };
}

/**
 * Saldo de pontos. Se os pontos vencem e o cliente ficou mais tempo que o prazo sem pedir,
 * grava o vencimento (só quando `db` pode escrever, ou seja, sempre: é idempotente).
 */
export async function pointsBalance(db: Db, tenantId: string, customerId: string, expireDays = 0, now = new Date()) {
  const sum = await db.loyaltyTransaction.aggregate({ where: { tenantId, customerId }, _sum: { points: true } });
  const balance = sum._sum.points ?? 0;
  if (balance <= 0 || expireDays <= 0) return Math.max(0, balance);
  const last = await db.loyaltyTransaction.findFirst({
    where: { tenantId, customerId, kind: { in: ['EARN', 'REDEEM', 'REFERRAL'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (last && now.getTime() - last.createdAt.getTime() > expireDays * 24 * 60 * 60 * 1000) {
    await db.loyaltyTransaction.create({
      data: { tenantId, customerId, points: -balance, kind: 'EXPIRE', note: `Venceram: ${expireDays} dias sem pedir` },
    });
    return 0;
  }
  return balance;
}

/** Pontos ganhos nos últimos 12 meses (pedidos + indicações): é o que define o nível do clube. */
export async function earnedLastYear(db: Db, tenantId: string, customerId: string, now = new Date()) {
  const sum = await db.loyaltyTransaction.aggregate({
    where: { tenantId, customerId, kind: { in: ['EARN', 'REFERRAL'] }, createdAt: { gte: new Date(now.getTime() - YEAR_MS) } },
    _sum: { points: true },
  });
  return sum._sum.points ?? 0;
}

/** Garante o código de indicação do cliente (criado no primeiro pedido). */
export async function ensureReferralCode(db: Db, tenantId: string, customer: { id: string; name: string; referralCode: string | null }) {
  if (customer.referralCode) return customer.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = makeReferralCode(customer.name);
    try {
      await db.customer.update({ where: { id: customer.id }, data: { referralCode: code } });
      return code;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }
  return null;
}

/**
 * Pedido entregue/retirado: o cliente ganha os pontos e, se foi o primeiro pedido de um amigo indicado,
 * quem indicou ganha os pontos da indicação. Chamado dentro da transação que finaliza o pedido.
 */
export async function awardOrderPoints(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, tenantId: true, customerId: true, channel: true, type: true, totalCents: true, deliveryFeeCents: true, customer: { select: { referredById: true, name: true } } },
  });
  // Só pedidos da loja própria (delivery e retirada). App de delivery e salão não têm o cliente identificado.
  if (!order || order.channel !== 'LOJA' || order.type === 'DINE_IN' || order.type === 'COUNTER') return;
  const program = await loyaltyProgram(tx, order.tenantId);
  if (program.enabled) {
    const points = pointsFor(order.totalCents, order.deliveryFeeCents, program.pointsPerReal);
    if (points > 0) {
      await tx.loyaltyTransaction.upsert({
        where: { orderId_kind: { orderId, kind: 'EARN' } },
        update: {},
        create: { tenantId: order.tenantId, customerId: order.customerId, points, kind: 'EARN', orderId, note: `Pedido #${order.number}` },
      });
    }
  }
  const referrerId = order.customer.referredById;
  if (program.referralEnabled && referrerId && program.referralReferrerPoints > 0) {
    const completed = await tx.order.count({ where: { customerId: order.customerId, status: 'COMPLETED' } });
    if (completed === 1) {
      await tx.loyaltyTransaction.upsert({
        where: { orderId_kind: { orderId, kind: 'REFERRAL' } },
        update: {},
        create: {
          tenantId: order.tenantId,
          customerId: referrerId,
          points: program.referralReferrerPoints,
          kind: 'REFERRAL',
          orderId,
          note: `Indicação: primeiro pedido de ${order.customer.name.split(' ')[0]}`,
        },
      });
    }
  }
}

/** Pedido cancelado: devolve os pontos trocados por prêmio. */
export async function refundOrderPoints(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { tenantId: true, customerId: true, number: true, pointsSpent: true } });
  if (!order || order.pointsSpent <= 0) return;
  await tx.loyaltyTransaction.upsert({
    where: { orderId_kind: { orderId, kind: 'REFUND' } },
    update: {},
    create: { tenantId: order.tenantId, customerId: order.customerId, points: order.pointsSpent, kind: 'REFUND', orderId, note: `Pedido #${order.number} cancelado` },
  });
}

/** Painel do restaurante (Cardápio > Fidelidade) e a parte pública da loja. */
@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Loja (cliente) ----------

  /** O que a loja mostra sobre o programa: regras, prêmios e níveis. */
  async publicProgram(tenantId: string) {
    const program = await loyaltyProgram(this.prisma, tenantId);
    if (!program.enabled && !program.referralEnabled) return null;
    const [rewards, levels] = await Promise.all([
      program.enabled ? this.activeRewards(tenantId) : [],
      program.clubEnabled ? this.prisma.clubLevel.findMany({ where: { tenantId }, orderBy: { minPoints: 'asc' } }) : [],
    ]);
    return {
      pointsEnabled: program.enabled,
      pointsPerReal: program.pointsPerReal,
      expireDays: program.expireDays,
      rewards: rewards.map((r) => ({ id: r.id, name: r.name, pointsCost: r.pointsCost, type: r.type, valueCents: r.valueCents, productId: r.productId, minOrderCents: r.minOrderCents })),
      levels: levels.map((l) => ({ name: l.name, minPoints: l.minPoints, discountBps: l.discountBps, freeDelivery: l.freeDelivery })),
      referral: program.referralEnabled
        ? { friendCents: program.referralFriendCents, minOrderCents: program.referralMinOrderCents, referrerPoints: program.referralReferrerPoints }
        : null,
    };
  }

  /** Situação de um cliente pelo telefone: saldo, nível e quanto falta para o próximo. Não mostra nome nem dados pessoais. */
  async customerStatus(tenantId: string, phone: string) {
    const program = await loyaltyProgram(this.prisma, tenantId);
    const customer = await this.prisma.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } }, select: { id: true } });
    if (!customer) return { points: 0, level: null, next: null, known: false };
    const [points, earned, levels] = await Promise.all([
      pointsBalance(this.prisma, tenantId, customer.id, program.expireDays),
      earnedLastYear(this.prisma, tenantId, customer.id),
      program.clubEnabled ? this.prisma.clubLevel.findMany({ where: { tenantId } }) : Promise.resolve([]),
    ]);
    const level = levelFor(levels, earned);
    const next = nextLevel(levels, earned);
    return {
      points: program.enabled ? points : 0,
      earned12m: earned,
      level: level ? { name: level.name, discountBps: level.discountBps, freeDelivery: level.freeDelivery } : null,
      next: next ? { name: next.name, missing: next.missing } : null,
      known: true,
    };
  }

  private activeRewards(tenantId: string) {
    return this.prisma.loyaltyReward.findMany({ where: { tenantId, active: true }, orderBy: [{ pointsCost: 'asc' }, { position: 'asc' }] });
  }

  // ---------- Painel ----------

  async overview(tenantId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [program, rewards, levels, issued, redeemed, discounts, referrals] = await Promise.all([
      loyaltyProgram(this.prisma, tenantId),
      this.prisma.loyaltyReward.findMany({ where: { tenantId }, orderBy: [{ pointsCost: 'asc' }, { position: 'asc' }] }),
      this.prisma.clubLevel.findMany({ where: { tenantId }, orderBy: { minPoints: 'asc' } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId, kind: { in: ['EARN', 'REFERRAL'] }, createdAt: { gte: monthStart } }, _sum: { points: true } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId, kind: 'REDEEM', createdAt: { gte: monthStart } }, _sum: { points: true }, _count: true }),
      this.prisma.order.aggregate({
        where: { tenantId, status: { not: 'CANCELLED' }, createdAt: { gte: monthStart }, loyaltyDiscountCents: { gt: 0 } },
        _sum: { loyaltyDiscountCents: true, totalCents: true, rewardDiscountCents: true, clubDiscountCents: true, referralDiscountCents: true },
        _count: true,
      }),
      this.prisma.customer.count({ where: { tenantId, referredById: { not: null }, createdAt: { gte: monthStart } } }),
    ]);
    return {
      program,
      rewards,
      levels,
      month: {
        pointsIssued: issued._sum.points ?? 0,
        pointsRedeemed: -(redeemed._sum.points ?? 0),
        redemptions: redeemed._count,
        orders: discounts._count,
        salesCents: discounts._sum.totalCents ?? 0,
        discountCents: discounts._sum.loyaltyDiscountCents ?? 0,
        rewardCents: discounts._sum.rewardDiscountCents ?? 0,
        clubCents: discounts._sum.clubDiscountCents ?? 0,
        referralCents: discounts._sum.referralDiscountCents ?? 0,
        newReferred: referrals,
      },
    };
  }

  async saveProgram(tenantId: string, dto: LoyaltyProgramDto) {
    const data = { ...dto };
    return this.prisma.loyaltyProgram.upsert({ where: { tenantId }, update: data, create: { tenantId, ...PROGRAM_DEFAULTS, ...data } });
  }

  private async checkReward(tenantId: string, dto: LoyaltyRewardDto) {
    if (dto.type === 'FIXED' && !(dto.valueCents && dto.valueCents > 0)) throw new BadRequestException('Informe o valor do desconto do prêmio.');
    if (dto.type === 'PRODUCT') {
      if (!dto.productId) throw new BadRequestException('Escolha o produto que sai de graça.');
      const p = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId } });
      if (!p) throw new BadRequestException('Produto não encontrado no cardápio.');
    }
    return {
      name: dto.name.trim(),
      pointsCost: dto.pointsCost,
      type: dto.type,
      valueCents: dto.type === 'FIXED' ? dto.valueCents! : 0,
      productId: dto.type === 'PRODUCT' ? dto.productId! : null,
      minOrderCents: dto.minOrderCents ?? 0,
      active: dto.active ?? true,
    };
  }

  async createReward(tenantId: string, dto: LoyaltyRewardDto) {
    return this.prisma.loyaltyReward.create({ data: { tenantId, ...(await this.checkReward(tenantId, dto)) } });
  }

  async updateReward(tenantId: string, id: string, dto: LoyaltyRewardDto) {
    const r = await this.prisma.loyaltyReward.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Prêmio não encontrado.');
    return this.prisma.loyaltyReward.update({ where: { id }, data: await this.checkReward(tenantId, dto) });
  }

  async deleteReward(tenantId: string, id: string) {
    const { count } = await this.prisma.loyaltyReward.deleteMany({ where: { id, tenantId } });
    if (!count) throw new NotFoundException('Prêmio não encontrado.');
    return { ok: true };
  }

  private levelData(dto: ClubLevelDto) {
    if (!dto.discountBps && !dto.freeDelivery) throw new BadRequestException('Dê pelo menos um benefício ao nível: desconto ou entrega grátis.');
    return { name: dto.name.trim(), minPoints: dto.minPoints, discountBps: dto.discountBps ?? 0, freeDelivery: dto.freeDelivery ?? false };
  }

  async createLevel(tenantId: string, dto: ClubLevelDto) {
    try {
      return await this.prisma.clubLevel.create({ data: { tenantId, ...this.levelData(dto) } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new BadRequestException('Já existe um nível com esse nome.');
      throw err;
    }
  }

  async updateLevel(tenantId: string, id: string, dto: ClubLevelDto) {
    const l = await this.prisma.clubLevel.findFirst({ where: { id, tenantId } });
    if (!l) throw new NotFoundException('Nível não encontrado.');
    try {
      return await this.prisma.clubLevel.update({ where: { id }, data: this.levelData(dto) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new BadRequestException('Já existe um nível com esse nome.');
      throw err;
    }
  }

  async deleteLevel(tenantId: string, id: string) {
    const { count } = await this.prisma.clubLevel.deleteMany({ where: { id, tenantId } });
    if (!count) throw new NotFoundException('Nível não encontrado.');
    return { ok: true };
  }

  /** Clientes com pontos: saldo, nível, pedidos e quantos amigos indicaram. */
  async customers(tenantId: string, search?: string) {
    const q = search?.trim();
    const digits = q?.replace(/\D/g, '');
    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, ...(digits ? [{ phone: { contains: digits } }] : [])] } : {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        referralCode: true,
        referredBy: { select: { name: true } },
        _count: { select: { orders: { where: { status: 'COMPLETED' } }, referrals: true } },
      },
      take: 500,
    });
    const ids = customers.map((c) => c.id);
    const since = new Date(Date.now() - YEAR_MS);
    const [balances, earned, levels] = await Promise.all([
      this.prisma.loyaltyTransaction.groupBy({ by: ['customerId'], where: { tenantId, customerId: { in: ids } }, _sum: { points: true } }),
      this.prisma.loyaltyTransaction.groupBy({
        by: ['customerId'],
        where: { tenantId, customerId: { in: ids }, kind: { in: ['EARN', 'REFERRAL'] }, createdAt: { gte: since } },
        _sum: { points: true },
      }),
      this.prisma.clubLevel.findMany({ where: { tenantId } }),
    ]);
    const bal = new Map(balances.map((b) => [b.customerId, b._sum.points ?? 0]));
    const earn = new Map(earned.map((b) => [b.customerId, b._sum.points ?? 0]));
    return customers
      .map((c) => {
        const e = earn.get(c.id) ?? 0;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          referralCode: c.referralCode,
          referredBy: c.referredBy?.name ?? null,
          orders: c._count.orders,
          referrals: c._count.referrals,
          points: Math.max(0, bal.get(c.id) ?? 0),
          earned12m: e,
          level: levelFor(levels, e)?.name ?? null,
        };
      })
      .sort((a, b) => b.points - a.points || b.orders - a.orders)
      .slice(0, 200);
  }

  async history(tenantId: string, customerId: string) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    return this.prisma.loyaltyTransaction.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** Ajuste manual (ex.: brinde, correção). Não deixa o saldo negativo. */
  async adjust(tenantId: string, customerId: string, dto: LoyaltyAdjustDto) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
      if (!c) throw new NotFoundException('Cliente não encontrado.');
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
      const balance = await pointsBalance(tx, tenantId, customerId);
      if (balance + dto.points < 0) throw new BadRequestException(`O cliente tem só ${balance} pontos.`);
      await tx.loyaltyTransaction.create({ data: { tenantId, customerId, points: dto.points, kind: 'ADJUST', note: dto.note.trim() } });
      return { points: balance + dto.points };
    });
  }
}
