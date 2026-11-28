import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

type CatalogRow = {
  kind: 'Categoria' | 'Produto' | 'Grupo' | 'Adicional';
  externalId: string;
  name: string;
  localId?: string;
  action: 'Criar' | 'Vincular' | 'Atualizar preço' | 'Ignorar';
  currentPrice?: number;
  price?: number;
};

type Step = {
  row: CatalogRow;
  apply: () => Promise<string>;
};

function demoCatalog(revised: boolean) {
  return {
    id: 'demo-burgers',
    name: 'Hambúrgueres (demo iFood)',
    product: {
      id: 'demo-classico',
      pdvCode: 'IFOOD-DEMO-CLASSICO',
      name: 'Hambúrguer clássico (demo iFood)',
      priceCents: revised ? 3490 : 2990,
      group: {
        id: 'demo-extras',
        name: 'Adicionais',
        minSelect: 0,
        maxSelect: 2,
        options: [
          { id: 'demo-bacon', name: 'Bacon', priceCents: 500 },
          { id: 'demo-queijo', name: 'Queijo extra', priceCents: 350 },
        ],
      },
    },
  };
}

@Injectable()
export class IfoodCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  preview(tenantId: string, revised: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const { rows, token } = await this.plan(tx, tenantId, revised);
      return { rows, token };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async confirm(tenantId: string, revised: boolean, expectedToken: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { rows, token, steps } = await this.plan(tx, tenantId, revised);
        if (token !== expectedToken) throw new ConflictException('O cardápio mudou. Gere uma nova prévia.');
        for (const { row, apply } of steps) {
          if (row.action === 'Ignorar') continue;
          const localId = await apply();
          const key = { tenantId, kind: row.kind, externalId: row.externalId };
          await tx.ifoodCatalogLink.upsert({
            where: { tenantId_kind_externalId: key },
            create: { ...key, localId },
            update: { localId },
          });
        }
        return { affected: rows.filter((row) => row.action !== 'Ignorar').length };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('O cardápio mudou. Gere uma nova prévia.');
      }
      throw error;
    }
  }

  private async plan(tx: Prisma.TransactionClient, tenantId: string, revised: boolean) {
    if (process.env.PAYMENTS_FAKE_ENABLED !== 'true') {
      throw new ForbiddenException('Simulação desligada neste ambiente.');
    }
    const category = demoCatalog(revised);
    const { product } = category;
    const { group } = product;
    const links = await tx.ifoodCatalogLink.findMany({ where: { tenantId } });
    const linked = (kind: CatalogRow['kind'], externalId: string) =>
      links.find((link) => link.kind === kind && link.externalId === externalId)?.localId;

    const linkedCategoryId = linked('Categoria', category.id);
    const linkedProductId = linked('Produto', product.id);
    const savedProduct = linkedProductId
      ? await tx.product.findFirst({ where: { tenantId, id: linkedProductId } })
      : null;
    const matchedProduct = savedProduct ?? await tx.product.findUnique({
      where: { tenantId_pdvCode: { tenantId, pdvCode: product.pdvCode } },
    });
    if (matchedProduct && !savedProduct && links.some((link) => link.kind === 'Produto' && link.localId === matchedProduct.id)) {
      throw new ConflictException('O código PDV já está associado a outro produto do iFood.');
    }
    const existingCategoryId = linkedCategoryId ?? matchedProduct?.categoryId;
    const matchedCategory = existingCategoryId
      ? await tx.menuCategory.findFirst({ where: { tenantId, id: existingCategoryId } })
      : null;
    const categoryId = matchedCategory?.id ?? randomUUID();
    const productId = matchedProduct?.id ?? randomUUID();
    const linkedGroupId = linked('Grupo', group.id);
    const savedGroup = matchedProduct && linkedGroupId
      ? await tx.optionGroup.findFirst({ where: { tenantId, productId, id: linkedGroupId }, include: { options: true } })
      : null;
    const matchingGroups = matchedProduct && !savedGroup
      ? await tx.optionGroup.findMany({ where: { tenantId, productId, name: group.name }, include: { options: true }, take: 2 })
      : [];
    if (matchingGroups.length > 1) throw new ConflictException('Há grupos de adicionais com o mesmo nome no produto.');
    const matchedGroup = savedGroup ?? matchingGroups[0];
    const groupId = matchedGroup?.id ?? randomUUID();

    const prices = matchedProduct?.channelPrices;
    const channelPrices = prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {};
    const currentPrice = matchedProduct
      ? typeof channelPrices.IFOOD === 'number' ? channelPrices.IFOOD : matchedProduct.priceCents
      : undefined;
    const priceChanged = currentPrice !== undefined && currentPrice !== product.priceCents;
    const steps: Step[] = [
      {
        row: {
          kind: 'Categoria', externalId: category.id, name: category.name, localId: matchedCategory?.id,
          action: !matchedCategory ? 'Criar' : linkedCategoryId ? 'Ignorar' : 'Vincular',
        },
        apply: async () => matchedCategory?.id ?? (await tx.menuCategory.create({
          data: { id: categoryId, tenantId, name: category.name },
        })).id,
      },
      {
        row: {
          kind: 'Produto', externalId: product.id, name: product.name, localId: matchedProduct?.id,
          action: !matchedProduct ? 'Criar' : priceChanged ? 'Atualizar preço' : savedProduct ? 'Ignorar' : 'Vincular',
          currentPrice, price: product.priceCents,
        },
        apply: async () => {
          if (!matchedProduct) {
            await tx.product.create({ data: {
              id: productId, tenantId, categoryId, name: product.name, pdvCode: product.pdvCode,
              priceCents: product.priceCents, channelPrices: { IFOOD: product.priceCents },
            } });
          } else {
            await tx.product.update({ where: { id: productId }, data: {
              channelPrices: { ...channelPrices, IFOOD: product.priceCents },
            } });
          }
          return productId;
        },
      },
      {
        row: { kind: 'Grupo', externalId: group.id, name: group.name, localId: matchedGroup?.id, action: savedGroup ? 'Ignorar' : matchedGroup ? 'Vincular' : 'Criar' },
        apply: async () => {
          if (!matchedGroup) await tx.optionGroup.create({ data: {
            id: groupId, tenantId, productId, name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect,
          } });
          return groupId;
        },
      },
    ];
    for (const option of group.options) {
      const saved = matchedGroup?.options.find((item) => item.id === linked('Adicional', option.id));
      const matches = matchedGroup?.options.filter((item) => item.name === option.name) ?? [];
      if (!saved && matches.length > 1) throw new ConflictException('Há adicionais com o mesmo nome no grupo.');
      const matched = saved ?? matches[0];
      steps.push({
        row: {
          kind: 'Adicional', externalId: option.id, name: option.name, localId: matched?.id,
          action: saved ? 'Ignorar' : matched ? 'Vincular' : 'Criar',
          currentPrice: matched?.priceCents, price: matched?.priceCents ?? option.priceCents,
        },
        apply: async () => matched?.id ?? (await tx.option.create({ data: {
          tenantId, groupId, name: option.name, priceCents: option.priceCents,
        } })).id,
      });
    }
    const rows = steps.map(({ row }) => row);
    const token = createHash('sha256').update(JSON.stringify({ tenantId, revised, rows })).digest('hex');
    return { rows, token, steps };
  }
}
