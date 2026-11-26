import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { ComboDto } from './cardapio.dto';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Combos do restaurante. Um combo é um produto (com preço, foto e categoria) cujas etapas são
 * grupos de opções. Cada opção pode ser um produto do cardápio (segue a disponibilidade e o custo
 * dele) ou um item que só existe no combo. Assim o combo passa pelo mesmo carrinho, cozinha,
 * "pedir de novo" e financeiro dos outros produtos.
 */
@Injectable()
export class CombosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: ComboDto) {
    const steps = await this.check(tenantId, dto);
    const combo = await this.prisma.$transaction(async (tx) => {
      const position = await tx.product.count({ where: { categoryId: dto.categoryId } });
      const p = await tx.product.create({
        data: {
          tenantId,
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl || null,
          priceCents: dto.priceCents,
          active: dto.active ?? true,
          isCombo: true,
          position,
        },
      });
      await this.saveSteps(tx, tenantId, p.id, steps);
      return p;
    });
    await this.audit.log({ tenantId, userId, action: 'combo.create', entity: 'product', entityId: combo.id, after: dto });
    return this.get(tenantId, combo.id);
  }

  /** Edita o combo. Etapas e opções com id são atualizadas (os pedidos antigos continuam reconhecendo); as que sumiram são apagadas. */
  async update(tenantId: string, userId: string, id: string, dto: ComboDto) {
    const before = await this.prisma.product.findFirst({ where: { id, tenantId, isCombo: true } });
    if (!before) throw new NotFoundException('Combo não encontrado.');
    const steps = await this.check(tenantId, dto, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl || null,
          priceCents: dto.priceCents,
          active: dto.active ?? before.active,
        },
      });
      await this.saveSteps(tx, tenantId, id, steps);
    });
    await this.audit.log({ tenantId, userId, action: 'combo.update', entity: 'product', entityId: id, before, after: dto });
    return this.get(tenantId, id);
  }

  private get(tenantId: string, id: string) {
    return this.prisma.product.findFirstOrThrow({
      where: { id, tenantId },
      include: { optionGroups: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } },
    });
  }

  /** Regras do combo; devolve as etapas prontas, com o nome de cada opção resolvido. */
  private async check(tenantId: string, dto: ComboDto, comboId?: string) {
    const category = await this.prisma.menuCategory.findFirst({ where: { id: dto.categoryId, tenantId }, select: { id: true } });
    if (!category) throw new NotFoundException('Categoria não encontrada.');
    if (!dto.steps.length) throw new BadRequestException('Monte pelo menos uma etapa no combo.');
    const ids = [...new Set(dto.steps.flatMap((s) => s.options.map((o) => o.productId).filter((x): x is string => !!x)))];
    const products = await this.prisma.product.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true, isCombo: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    if (comboId) {
      const existing = await this.prisma.optionGroup.findMany({ where: { productId: comboId }, select: { id: true, options: { select: { id: true } } } });
      const groupIds = new Set(existing.map((g) => g.id));
      const optionIds = new Set(existing.flatMap((g) => g.options.map((o) => o.id)));
      for (const s of dto.steps) {
        if (s.id && !groupIds.has(s.id)) throw new BadRequestException('Etapa não pertence a este combo.');
        for (const o of s.options) if (o.id && !optionIds.has(o.id)) throw new BadRequestException('Opção não pertence a este combo.');
      }
    }
    return dto.steps.map((s, i) => {
      const name = s.name.trim();
      if (!s.options.length) throw new BadRequestException(`A etapa "${name}" está sem itens.`);
      if (s.minSelect > s.maxSelect) throw new BadRequestException(`Em "${name}", o mínimo não pode ser maior que o máximo.`);
      if (s.minSelect > s.options.length) throw new BadRequestException(`Em "${name}", o cliente precisa escolher ${s.minSelect}, mas só há ${s.options.length} opção(ões).`);
      const options = s.options.map((o, j) => {
        if (o.productId) {
          const p = byId.get(o.productId);
          if (!p) throw new BadRequestException('Um dos produtos do combo não existe neste cardápio.');
          if (p.isCombo || p.id === comboId) throw new BadRequestException('Um combo não pode ter outro combo dentro.');
          return { id: o.id, name: o.name?.trim() || p.name, linkedProductId: p.id, priceCents: o.priceCents ?? 0, costCents: 0, position: j };
        }
        if (!o.name?.trim()) throw new BadRequestException(`Dê um nome ao item novo em "${name}".`);
        return { id: o.id, name: o.name.trim(), linkedProductId: null, priceCents: o.priceCents ?? 0, costCents: o.costCents ?? 0, position: j };
      });
      return { id: s.id, name, minSelect: s.minSelect, maxSelect: Math.min(s.maxSelect, s.options.length), position: i, options };
    });
  }

  private async saveSteps(tx: Tx, tenantId: string, productId: string, steps: Awaited<ReturnType<CombosService['check']>>) {
    const keepGroups = steps.map((s) => s.id).filter((x): x is string => !!x);
    await tx.optionGroup.deleteMany({ where: { productId, id: { notIn: keepGroups } } });
    for (const s of steps) {
      const data = { name: s.name, minSelect: s.minSelect, maxSelect: s.maxSelect, position: s.position };
      const group = s.id ? await tx.optionGroup.update({ where: { id: s.id }, data }) : await tx.optionGroup.create({ data: { ...data, tenantId, productId } });
      const keep = s.options.map((o) => o.id).filter((x): x is string => !!x);
      await tx.option.deleteMany({ where: { groupId: group.id, id: { notIn: keep } } });
      for (const o of s.options) {
        const od = { name: o.name, priceCents: o.priceCents, costCents: o.costCents, position: o.position, linkedProductId: o.linkedProductId };
        if (o.id) await tx.option.update({ where: { id: o.id }, data: od });
        else await tx.option.create({ data: { ...od, tenantId, groupId: group.id } });
      }
    }
  }
}
