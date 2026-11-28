import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MARKETPLACES } from '@delivery360/shared';
import { AuditService } from '../core/audit.service';
import {
  CategoryDto,
  OptionDto,
  OptionGroupDto,
  ProductDto,
  UpdateCategoryDto,
  UpdateOptionDto,
  UpdateOptionGroupDto,
  UpdateProductDto,
  UpdateStoreDto,
  UpdateZoneDto,
  ZoneDto,
} from './cardapio.dto';

/** Gera um endereço de loja a partir do nome: "Pizzaria do Zé" -> "pizzaria-do-ze". */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'loja'
  );
}

/**
 * Cadastro do cardápio e configuração da loja, sempre dentro do restaurante atual.
 * Toda busca por id filtra também por tenantId: um restaurante nunca mexe no cardápio de outro.
 */

/** Ficha técnica vai para o banco como JSON simples (sem as classes do validador). */
/** "" vira null (sem código PDV). */
const pdv = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
const prices = (v: object | undefined) => (v === undefined ? undefined : (Object.fromEntries(Object.entries(v).filter(([, c]) => typeof c === 'number')) as Prisma.InputJsonValue));
const PDV_TAKEN = 'Já existe outro produto com este código PDV.';

const toJson = (items: { name: string; kind: string; costCents: number }[]) =>
  items.map((i) => ({ name: i.name.trim(), kind: i.kind, costCents: i.costCents })) as Prisma.InputJsonValue;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Loja ----------

  /** Devolve a configuração da loja, criando uma padrão (fechada) na primeira vez. */
  async getStore(tenantId: string) {
    const existing = await this.prisma.store.findUnique({ where: { tenantId } });
    if (existing) return existing;
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    const base = slugify(tenant.name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      try {
        return await this.prisma.store.create({ data: { tenantId, slug, displayName: tenant.name } });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        const again = await this.prisma.store.findUnique({ where: { tenantId } });
        if (again) return again;
      }
    }
    throw new ConflictException('Não foi possível gerar o endereço da loja.');
  }

  async updateStore(tenantId: string, userId: string, dto: UpdateStoreDto) {
    const before = await this.getStore(tenantId);
    if (dto.paymentMethods && dto.paymentMethods.length === 0) {
      throw new BadRequestException('Escolha pelo menos uma forma de pagamento.');
    }
    if (dto.acceptsDelivery === false && dto.acceptsPickup === false) {
      throw new BadRequestException('A loja precisa aceitar entrega ou retirada.');
    }
    try {
      const after = await this.prisma.store.update({ where: { tenantId }, data: dto });
      await this.audit.log({ tenantId, userId, action: 'store.update', entity: 'store', entityId: tenantId, before, after });
      return after;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este endereço de loja já está em uso.');
      }
      throw err;
    }
  }

  // ---------- Bairros ----------

  listZones(tenantId: string) {
    return this.prisma.deliveryZone.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async createZone(tenantId: string, dto: ZoneDto) {
    try {
      return await this.prisma.deliveryZone.create({ data: { tenantId, ...dto, name: dto.name.trim() } });
    } catch (err) {
      throw this.unique(err, 'Já existe um bairro com este nome.');
    }
  }

  async updateZone(tenantId: string, id: string, dto: UpdateZoneDto) {
    await this.own('deliveryZone', tenantId, id);
    try {
      return await this.prisma.deliveryZone.update({ where: { id }, data: { ...dto, name: dto.name?.trim() } });
    } catch (err) {
      throw this.unique(err, 'Já existe um bairro com este nome.');
    }
  }

  async deleteZone(tenantId: string, id: string) {
    await this.own('deliveryZone', tenantId, id);
    await this.prisma.deliveryZone.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Cardápio ----------

  /** Cardápio completo do restaurante (inclusive itens inativos), na ordem de exibição. */
  getMenu(tenantId: string) {
    return this.prisma.menuCategory.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        products: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: {
            optionGroups: {
              orderBy: { position: 'asc' },
              include: { options: { orderBy: { position: 'asc' } } },
            },
          },
        },
      },
    });
  }

  async createCategory(tenantId: string, dto: CategoryDto) {
    const position = dto.position ?? (await this.prisma.menuCategory.count({ where: { tenantId } }));
    return this.prisma.menuCategory.create({ data: { tenantId, name: dto.name.trim(), position, active: dto.active ?? true } });
  }

  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.own('menuCategory', tenantId, id);
    return this.prisma.menuCategory.update({ where: { id }, data: { ...dto, name: dto.name?.trim() } });
  }

  async deleteCategory(tenantId: string, id: string) {
    await this.own('menuCategory', tenantId, id);
    const count = await this.prisma.product.count({ where: { categoryId: id } });
    if (count > 0) throw new ConflictException('Mova ou apague os produtos desta categoria antes.');
    await this.prisma.menuCategory.delete({ where: { id } });
    return { ok: true };
  }

  async costRates(tenantId: string) {
    const s = await this.prisma.financeSettings.findUnique({ where: { tenantId } });
    return {
      salesTaxBps: s?.salesTaxBps ?? 0,
      pixFeeBps: s?.pixFeeBps ?? 0,
      creditFeeBps: s?.creditFeeBps ?? 0,
      cardOnDeliveryFeeBps: s?.cardOnDeliveryFeeBps ?? 0,
      targetMarginBps: s?.targetMarginBps ?? 2000,
      configured: !!s,
      channels: await this.channelConfigs(tenantId),
    };
  }

  /** Apps de delivery do restaurante (os que não foram configurados vêm desligados). */
  async channelConfigs(tenantId: string) {
    const rows = await this.prisma.channelSetting.findMany({ where: { tenantId } });
    return MARKETPLACES.map((channel) => {
      const r = rows.find((x) => x.channel === channel);
      return {
        channel,
        active: r?.active ?? false,
        merchantId: r?.merchantId ?? null,
        commissionBps: r?.commissionBps ?? 0,
        paymentFeeBps: r?.paymentFeeBps ?? 0,
        payoutDays: r?.payoutDays ?? 30,
      };
    });
  }

  /** Regras do preço de/por; devolve os campos já no formato do banco. */
  private promo(
    dto: { priceCents?: number; promoPriceCents?: number | null; promoStartsAt?: string | null; promoEndsAt?: string | null },
    current?: { priceCents: number; promoPriceCents: number | null; promoStartsAt: Date | null; promoEndsAt: Date | null },
  ) {
    const date = (v: string | null | undefined, old: Date | null | undefined) => (v === undefined ? (old ?? null) : v ? new Date(v) : null);
    const price = dto.priceCents ?? current?.priceCents ?? 0;
    const promoPriceCents = dto.promoPriceCents !== undefined ? dto.promoPriceCents : (current?.promoPriceCents ?? null);
    const promoStartsAt = date(dto.promoStartsAt, current?.promoStartsAt);
    const promoEndsAt = date(dto.promoEndsAt, current?.promoEndsAt);
    if (promoPriceCents != null && promoPriceCents >= price) {
      throw new BadRequestException('O preço promocional precisa ser menor que o preço normal.');
    }
    if (promoStartsAt && promoEndsAt && promoEndsAt <= promoStartsAt) {
      throw new BadRequestException('O fim da promoção precisa ser depois do início.');
    }
    return { promoPriceCents, promoStartsAt, promoEndsAt };
  }

  async createProduct(tenantId: string, dto: ProductDto) {
    await this.own('menuCategory', tenantId, dto.categoryId);
    const promo = this.promo(dto);
    const position = dto.position ?? (await this.prisma.product.count({ where: { categoryId: dto.categoryId } }));
    return this.prisma.product
      .create({ data: { ...dto, ...promo, costItems: toJson(dto.costItems ?? []), pdvCode: pdv(dto.pdvCode), ncm: dto.ncm || null, cfop: dto.cfop || null, channelPrices: prices(dto.channelPrices), tenantId, name: dto.name.trim(), position } })
      .catch((e) => {
        throw this.unique(e, PDV_TAKEN);
      });
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.own('product', tenantId, id);
    if (dto.categoryId) await this.own('menuCategory', tenantId, dto.categoryId);
    const current = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      select: { priceCents: true, promoPriceCents: true, promoStartsAt: true, promoEndsAt: true },
    });
    const promo = this.promo(dto, current);
    return this.prisma.product
      .update({
        where: { id },
        data: { ...dto, ...promo, costItems: dto.costItems ? toJson(dto.costItems) : undefined, pdvCode: pdv(dto.pdvCode), ncm: dto.ncm === undefined ? undefined : dto.ncm || null, cfop: dto.cfop === undefined ? undefined : dto.cfop || null, channelPrices: prices(dto.channelPrices), name: dto.name?.trim() },
      })
      .catch((e) => {
        throw this.unique(e, PDV_TAKEN);
      });
  }

  async deleteProduct(tenantId: string, id: string) {
    await this.own('product', tenantId, id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  async createGroup(tenantId: string, productId: string, dto: OptionGroupDto) {
    await this.own('product', tenantId, productId);
    this.checkMinMax(dto.minSelect, dto.maxSelect);
    const position = dto.position ?? (await this.prisma.optionGroup.count({ where: { productId } }));
    return this.prisma.optionGroup.create({
      data: { tenantId, productId, name: dto.name.trim(), minSelect: dto.minSelect, maxSelect: dto.maxSelect, position },
      include: { options: true },
    });
  }

  async updateGroup(tenantId: string, id: string, dto: UpdateOptionGroupDto) {
    const g = await this.prisma.optionGroup.findFirst({ where: { id, tenantId } });
    if (!g) throw new NotFoundException('Grupo de adicionais não encontrado.');
    this.checkMinMax(dto.minSelect ?? g.minSelect, dto.maxSelect ?? g.maxSelect);
    return this.prisma.optionGroup.update({ where: { id }, data: { ...dto, name: dto.name?.trim() }, include: { options: true } });
  }

  async deleteGroup(tenantId: string, id: string) {
    await this.own('optionGroup', tenantId, id);
    await this.prisma.optionGroup.delete({ where: { id } });
    return { ok: true };
  }

  async createOption(tenantId: string, groupId: string, dto: OptionDto) {
    await this.own('optionGroup', tenantId, groupId);
    const position = dto.position ?? (await this.prisma.option.count({ where: { groupId } }));
    return this.prisma.option.create({ data: { tenantId, groupId, name: dto.name.trim(), priceCents: dto.priceCents, costCents: dto.costCents ?? 0, pdvCode: pdv(dto.pdvCode) ?? null, available: dto.available ?? true, position } });
  }

  async updateOption(tenantId: string, id: string, dto: UpdateOptionDto) {
    await this.own('option', tenantId, id);
    return this.prisma.option.update({ where: { id }, data: { ...dto, pdvCode: pdv(dto.pdvCode), name: dto.name?.trim() } });
  }

  async deleteOption(tenantId: string, id: string) {
    await this.own('option', tenantId, id);
    await this.prisma.option.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Auxiliares ----------

  private checkMinMax(min: number, max: number) {
    if (min > max) throw new BadRequestException('O mínimo de escolhas não pode ser maior que o máximo.');
  }

  /** Confere que o registro existe E pertence ao restaurante; senão, 404 (sem revelar que existe em outro). */
  private async own(
    model: 'deliveryZone' | 'menuCategory' | 'product' | 'optionGroup' | 'option',
    tenantId: string,
    id: string,
  ) {
    const where = { where: { id, tenantId }, select: { id: true } };
    const found =
      model === 'deliveryZone'
        ? await this.prisma.deliveryZone.findFirst(where)
        : model === 'menuCategory'
          ? await this.prisma.menuCategory.findFirst(where)
          : model === 'product'
            ? await this.prisma.product.findFirst(where)
            : model === 'optionGroup'
              ? await this.prisma.optionGroup.findFirst(where)
              : await this.prisma.option.findFirst(where);
    if (!found) throw new NotFoundException('Registro não encontrado.');
  }

  private unique(err: unknown, message: string) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return new ConflictException(message);
    return err;
  }
}
