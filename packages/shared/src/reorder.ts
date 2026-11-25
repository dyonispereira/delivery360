import type { OrderTracking, PublicProduct, PublicStore } from './orders';

/** Item do carrinho montado a partir de um pedido antigo ("Pedir de novo"). */
export interface ReorderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  optionIds: string[];
  optionNames: string[];
  notes: string;
}

export interface ReorderResult {
  items: ReorderItem[];
  /** Avisos para o cliente: o que acabou, o que mudou de preço. */
  warnings: string[];
}

const brl = (cents: number) => 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');

/**
 * Remonta o carrinho de um pedido antigo com o cardápio de hoje.
 * Usa o preço atual (o servidor recalcula de qualquer forma), tira o que não existe mais
 * ou está em falta, e explica cada diferença ao cliente.
 */
export function rebuildOrder(order: Pick<OrderTracking, 'items'>, menu: Pick<PublicStore, 'categories'>): ReorderResult {
  const products = new Map<string, PublicProduct>();
  for (const c of menu.categories) for (const p of c.products) products.set(p.id, p);

  const items: ReorderItem[] = [];
  const warnings: string[] = [];

  for (const old of order.items) {
    const product = old.productId ? products.get(old.productId) : undefined;
    if (!product || !product.available) {
      warnings.push(`${old.name} não está disponível hoje e ficou de fora.`);
      continue;
    }

    const options = product.optionGroups.flatMap((g) => g.options.map((o) => ({ ...o, groupId: g.id })));
    const picked: (typeof options)[number][] = [];
    const missingOptions: string[] = [];
    for (const o of old.options) {
      const now = o.optionId ? options.find((x) => x.id === o.optionId) : undefined;
      if (now && now.available) picked.push(now);
      else missingOptions.push(o.name);
    }

    // Regras de escolha de hoje: mínimo e máximo de cada grupo.
    let broken = false;
    for (const g of product.optionGroups) {
      const count = picked.filter((o) => o.groupId === g.id).length;
      if (count < g.minSelect || count > g.maxSelect) broken = true;
    }
    if (broken) {
      warnings.push(
        missingOptions.length
          ? `${old.name}: ${missingOptions.join(', ')} acabou. Toque no produto para escolher de novo.`
          : `${old.name} mudou de opções. Toque no produto para escolher de novo.`,
      );
      continue;
    }
    if (missingOptions.length) warnings.push(`${old.name}: ${missingOptions.join(', ')} acabou e saiu do item.`);

    const unit = product.priceCents + picked.reduce((s, o) => s + o.priceCents, 0);
    if (unit !== old.unitPriceCents) warnings.push(`${product.name} mudou de ${brl(old.unitPriceCents)} para ${brl(unit)}.`);

    items.push({
      productId: product.id,
      name: product.name,
      quantity: old.quantity,
      unitPriceCents: unit,
      optionIds: picked.map((o) => o.id),
      optionNames: picked.map((o) => o.name),
      notes: old.notes ?? '',
    });
  }

  return { items, warnings };
}
