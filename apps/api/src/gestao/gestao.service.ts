import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntryStatus, EntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { GROUPS, fromDbDate, localDate, toDbDate } from './chart';
import { buildDre } from './dre';
import { GestaoSyncService } from './gestao-sync.service';
import { paymentFeeBps } from '@delivery360/shared';
import { AccountDto, EntryDto, FinanceSettingsDto, UpdateAccountDto, UpdateEntryDto } from './gestao.dto';

const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};

const entryInclude = { account: { select: { id: true, code: true, name: true, group: true } } } satisfies Prisma.FinancialEntryInclude;

type EntryRow = Prisma.FinancialEntryGetPayload<{ include: typeof entryInclude }>;
const view = (e: EntryRow) => ({
  ...e,
  competenceDate: fromDbDate(e.competenceDate),
  dueDate: fromDbDate(e.dueDate),
  paidAt: e.paidAt ? fromDbDate(e.paidAt) : null,
});

@Injectable()
export class GestaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: GestaoSyncService,
  ) {}

  /** Antes de mostrar números, garante plano de contas e lançamentos automáticos em dia. */
  private async fresh(tenantId: string) {
    await this.sync.ensureChart(tenantId);
    await this.sync.processPending(tenantId);
  }

  // ---------- Plano de contas ----------

  async accounts(tenantId: string) {
    await this.sync.ensureChart(tenantId);
    const list = await this.prisma.account.findMany({ where: { tenantId } });
    list.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
    return GROUPS.map((g) => ({ ...g, accounts: list.filter((a) => a.group === g.group) }));
  }

  async createAccount(tenantId: string, userId: string, dto: AccountDto) {
    await this.sync.ensureChart(tenantId);
    const group = GROUPS.find((g) => g.group === dto.group)!;
    const codes = await this.prisma.account.findMany({ where: { tenantId, group: dto.group }, select: { code: true } });
    const next = Math.max(0, ...codes.map((c) => Number(c.code.split('.')[1]) || 0)) + 1;
    const account = await this.prisma.account.create({
      data: { tenantId, group: dto.group, code: `${dto.group}.${next}`, name: dto.name.trim(), kind: group.kind },
    });
    await this.audit.log({ tenantId, userId, action: 'account.create', entity: 'account', entityId: account.id, after: account });
    return account;
  }

  async updateAccount(tenantId: string, userId: string, id: string, dto: UpdateAccountDto) {
    const before = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('Conta não encontrada.');
    if (dto.active === false && before.system) throw new BadRequestException('Contas padrão não podem ser desativadas (os lançamentos automáticos usam). Você pode renomear.');
    const after = await this.prisma.account.update({ where: { id }, data: { name: dto.name?.trim(), active: dto.active } });
    await this.audit.log({ tenantId, userId, action: 'account.update', entity: 'account', entityId: id, before, after });
    return after;
  }

  // ---------- Contas a pagar e a receber ----------

  async entries(tenantId: string, q: { type?: EntryType; status?: EntryStatus | 'OVERDUE'; from?: string; to?: string; accountId?: string; search?: string }) {
    await this.fresh(tenantId);
    const today = toDbDate(localDate(new Date()));
    const where: Prisma.FinancialEntryWhereInput = {
      tenantId,
      type: q.type,
      accountId: q.accountId,
      ...(q.status === 'OVERDUE' ? { status: 'OPEN', dueDate: { lt: today } } : q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }),
      ...(q.from || q.to ? { dueDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}), ...(q.status === 'OVERDUE' ? { lt: today } : {}) } } : {}),
      ...(q.search ? { OR: [{ description: { contains: q.search, mode: 'insensitive' } }, { counterparty: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.financialEntry.findMany({ where, include: entryInclude, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 500 });
    const sum = (f: (e: EntryRow) => boolean) => rows.filter(f).reduce((s, e) => s + e.amountCents, 0);
    return {
      items: rows.map(view),
      totals: {
        openCents: sum((e) => e.status === 'OPEN'),
        overdueCents: sum((e) => e.status === 'OPEN' && e.dueDate < today),
        paidCents: sum((e) => e.status === 'PAID'),
      },
    };
  }

  async createEntry(tenantId: string, userId: string, dto: EntryDto) {
    const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, tenantId, active: true } });
    if (!account) throw new BadRequestException('Escolha uma conta do plano de contas.');
    const months = dto.repeatMonths ?? 1;
    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < months; i++) {
        const suffix = months > 1 ? ` (${i + 1}/${months})` : '';
        const paid = i === 0 && dto.paidAt;
        out.push(
          await tx.financialEntry.create({
            data: {
              tenantId,
              type: dto.type,
              accountId: account.id,
              description: `${dto.description.trim()}${suffix}`,
              counterparty: dto.counterparty?.trim() || null,
              amountCents: dto.amountCents,
              competenceDate: toDbDate(addMonths(dto.competenceDate, i)),
              dueDate: toDbDate(addMonths(dto.dueDate, i)),
              notes: dto.notes?.trim() || null,
              status: paid ? 'PAID' : 'OPEN',
              paidAt: paid ? toDbDate(dto.paidAt!) : null,
              createdBy: userId,
            },
            include: entryInclude,
          }),
        );
      }
      await this.audit.log({ tenantId, userId, action: 'entry.create', entity: 'financial_entry', entityId: out[0].id, after: { ...dto, count: months } }, tx);
      return out;
    });
    return created.map(view);
  }

  async updateEntry(tenantId: string, userId: string, id: string, dto: UpdateEntryDto) {
    const before = await this.own(tenantId, id);
    if (before.status === 'CANCELLED') throw new ConflictException('Lançamento cancelado não pode ser alterado.');
    // Valores gerados pelos pedidos e entregas vêm da operação: só a descrição e as observações mudam.
    if (before.source !== 'manual' && (dto.amountCents !== undefined || dto.competenceDate !== undefined || dto.accountId !== undefined)) {
      throw new BadRequestException('Este lançamento foi gerado automaticamente pela operação: valor, conta e competência não podem ser alterados.');
    }
    if (dto.accountId) {
      const acc = await this.prisma.account.findFirst({ where: { id: dto.accountId, tenantId } });
      if (!acc) throw new BadRequestException('Conta inválida.');
    }
    const after = await this.prisma.financialEntry.update({
      where: { id },
      data: {
        accountId: dto.accountId,
        description: dto.description?.trim(),
        counterparty: dto.counterparty === undefined ? undefined : dto.counterparty.trim() || null,
        amountCents: dto.amountCents,
        competenceDate: dto.competenceDate ? toDbDate(dto.competenceDate) : undefined,
        dueDate: dto.dueDate ? toDbDate(dto.dueDate) : undefined,
        notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
      },
      include: entryInclude,
    });
    await this.audit.log({ tenantId, userId, action: 'entry.update', entity: 'financial_entry', entityId: id, before, after });
    return view(after);
  }

  /** Dar baixa (pago ou recebido). */
  async pay(tenantId: string, userId: string, ids: string[], paidAt?: string) {
    const day = paidAt ?? localDate(new Date());
    const { count } = await this.prisma.financialEntry.updateMany({
      where: { tenantId, id: { in: ids }, status: 'OPEN' },
      data: { status: 'PAID', paidAt: toDbDate(day) },
    });
    if (count === 0) throw new ConflictException('Nada para dar baixa: os lançamentos já estão pagos ou cancelados.');
    await this.audit.log({ tenantId, userId, action: 'entry.pay', entity: 'financial_entry', entityId: ids[0], after: { ids, paidAt: day } });
    return { count };
  }

  /** Desfaz a baixa (pagamento lançado por engano). */
  async reopen(tenantId: string, userId: string, id: string) {
    const e = await this.own(tenantId, id);
    if (e.status !== 'PAID') throw new ConflictException('Só dá para reabrir um lançamento pago.');
    await this.prisma.financialEntry.update({ where: { id }, data: { status: 'OPEN', paidAt: null } });
    await this.audit.log({ tenantId, userId, action: 'entry.reopen', entity: 'financial_entry', entityId: id, before: { paidAt: e.paidAt } });
    return { ok: true };
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const e = await this.own(tenantId, id);
    if (e.status === 'CANCELLED') return { ok: true };
    await this.prisma.financialEntry.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ tenantId, userId, action: 'entry.cancel', entity: 'financial_entry', entityId: id, before: e });
    return { ok: true };
  }

  // ---------- Impostos e taxas ----------

  settings(tenantId: string) {
    return this.sync.rates(this.prisma, tenantId);
  }

  async updateSettings(tenantId: string, userId: string, dto: FinanceSettingsDto) {
    const before = await this.sync.rates(this.prisma, tenantId);
    const after = await this.prisma.financeSettings.upsert({ where: { tenantId }, create: { tenantId, ...dto }, update: dto });
    await this.audit.log({ tenantId, userId, action: 'finance_settings.update', entity: 'finance_settings', entityId: tenantId, before, after });
    return after;
  }

  // ---------- Margem por produto (ficha técnica x vendas) ----------

  /** Itens vendidos (pedidos entregues/retirados) no período, com o custo gravado na venda. */
  private async soldItems(tenantId: string, from: string, to: string) {
    const start = new Date(`${from}T03:00:00Z`);
    const end = new Date(new Date(`${to}T03:00:00Z`).getTime() + 86_400_000);
    return this.prisma.orderItem.findMany({
      where: { order: { tenantId, status: 'COMPLETED', createdAt: { gte: start, lt: end } } },
      select: { productId: true, name: true, quantity: true, totalCents: true, unitCostCents: true, order: { select: { paymentMethod: true } } },
    });
  }

  async productsMargin(tenantId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('A data inicial é depois da final.');
    const [items, rates] = await Promise.all([this.soldItems(tenantId, from, to), this.sync.rates(this.prisma, tenantId)]);
    const map = new Map<string, { productId: string | null; name: string; quantity: number; revenueCents: number; cmvCents: number; variableCents: number; withoutCost: number }>();
    for (const i of items) {
      const key = i.productId ?? i.name;
      const row = map.get(key) ?? { productId: i.productId, name: i.name, quantity: 0, revenueCents: 0, cmvCents: 0, variableCents: 0, withoutCost: 0 };
      row.quantity += i.quantity;
      row.revenueCents += i.totalCents;
      row.cmvCents += i.unitCostCents * i.quantity;
      row.variableCents += Math.round((i.totalCents * (rates.salesTaxBps + paymentFeeBps(rates, i.order.paymentMethod))) / 10_000);
      if (i.unitCostCents === 0) row.withoutCost += i.quantity;
      map.set(key, row);
    }
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const rows = [...map.values()]
      .map((r) => {
        const profitCents = r.revenueCents - r.cmvCents - r.variableCents;
        // Sem ficha em nenhuma venda: CMV desconhecido (não é 0%).
        const unknown = r.withoutCost === r.quantity;
        return { ...r, profitCents, cmvPct: unknown ? null : pct(r.cmvCents, r.revenueCents), resultPct: unknown ? null : pct(profitCents, r.revenueCents) };
      })
      .sort((a, b) => b.profitCents - a.profitCents);
    const total = rows.reduce(
      (t, r) => ({
        quantity: t.quantity + r.quantity,
        revenueCents: t.revenueCents + r.revenueCents,
        cmvCents: t.cmvCents + r.cmvCents,
        variableCents: t.variableCents + r.variableCents,
        profitCents: t.profitCents + r.profitCents,
      }),
      { quantity: 0, revenueCents: 0, cmvCents: 0, variableCents: 0, profitCents: 0 },
    );
    return {
      from,
      to,
      rows,
      total: { ...total, cmvPct: pct(total.cmvCents, total.revenueCents), resultPct: pct(total.profitCents, total.revenueCents) },
      // Produtos vendidos sem ficha técnica: o CMV deles aparece como zero.
      missingCost: rows.filter((r) => r.withoutCost > 0).map((r) => r.name),
    };
  }

  // ---------- DRE e resumo ----------

  /** DRE por competência no período (não conta cancelados). */
  async dre(tenantId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('A data inicial é depois da final.');
    await this.fresh(tenantId);
    const grouped = await this.prisma.financialEntry.groupBy({
      by: ['accountId', 'type'],
      where: { tenantId, status: { not: 'CANCELLED' }, competenceDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      _sum: { amountCents: true },
    });
    const accounts = await this.prisma.account.findMany({ where: { tenantId, id: { in: grouped.map((g) => g.accountId) } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const lines = buildDre(
      grouped.map((g) => {
        const a = byId.get(g.accountId)!;
        return { code: a.code, name: a.name, group: a.group, kind: a.kind, type: g.type, amountCents: g._sum.amountCents ?? 0 };
      }),
    );
    const orders = await this.prisma.order.aggregate({
      where: { tenantId, status: 'COMPLETED', createdAt: { gte: new Date(`${from}T03:00:00Z`), lt: new Date(new Date(`${to}T03:00:00Z`).getTime() + 86_400_000) } },
      _count: true,
      _sum: { totalCents: true },
    });
    // CMV teórico (fichas técnicas das vendas) x CMV real (compras lançadas no grupo 3): a diferença
    // aponta desperdício, porção maior que a ficha, roubo ou ficha desatualizada.
    const sold = await this.soldItems(tenantId, from, to);
    const salesCents = sold.reduce((s, i) => s + i.totalCents, 0);
    const theoreticalCents = sold.reduce((s, i) => s + i.unitCostCents * i.quantity, 0);
    const actualCents = -(lines.find((l) => l.key === 'g3')?.valueCents ?? 0);
    return {
      from,
      to,
      lines,
      orders: { count: orders._count, ticketCents: orders._count ? Math.round((orders._sum.totalCents ?? 0) / orders._count) : 0 },
      cmv: {
        salesCents,
        theoreticalCents,
        theoreticalPct: salesCents ? Math.round((theoreticalCents / salesCents) * 1000) / 10 : null,
        actualCents,
        actualPct: salesCents ? Math.round((actualCents / salesCents) * 1000) / 10 : null,
        missingCostItems: sold.filter((i) => i.unitCostCents === 0).reduce((s, i) => s + i.quantity, 0),
      },
    };
  }

  /** Painel da Gestão: contas vencidas e a vencer, e o mês até agora. */
  async summary(tenantId: string) {
    await this.fresh(tenantId);
    const todayStr = localDate(new Date());
    const today = toDbDate(todayStr);
    const in7 = toDbDate(addDays(todayStr, 7));
    const monthStart = `${todayStr.slice(0, 8)}01`;
    const open = await this.prisma.financialEntry.findMany({
      where: { tenantId, status: 'OPEN' },
      select: { type: true, dueDate: true, amountCents: true },
    });
    const bucket = (type: EntryType) => {
      const l = open.filter((e) => e.type === type);
      const s = (f: (d: Date) => boolean) => l.filter((e) => f(e.dueDate)).reduce((acc, e) => ({ count: acc.count + 1, cents: acc.cents + e.amountCents }), { count: 0, cents: 0 });
      return {
        overdue: s((d) => d < today),
        today: s((d) => d.getTime() === today.getTime()),
        next7: s((d) => d > today && d <= in7),
        total: s(() => true),
      };
    };
    const cash = await this.prisma.financialEntry.groupBy({
      by: ['type'],
      where: { tenantId, status: 'PAID', paidAt: { gte: toDbDate(monthStart), lte: today } },
      _sum: { amountCents: true },
    });
    const cashIn = cash.find((c) => c.type === 'RECEIVABLE')?._sum.amountCents ?? 0;
    const cashOut = cash.find((c) => c.type === 'PAYABLE')?._sum.amountCents ?? 0;
    const month = await this.dre(tenantId, monthStart, todayStr);
    const line = (k: string) => month.lines.find((l) => l.key === k)?.valueCents ?? 0;
    return {
      today: todayStr,
      payable: bucket('PAYABLE'),
      receivable: bucket('RECEIVABLE'),
      month: { from: monthStart, to: todayStr, grossCents: line('g1'), netProfitCents: line('netProfit'), cashInCents: cashIn, cashOutCents: cashOut, orders: month.orders },
    };
  }

  private async own(tenantId: string, id: string) {
    const e = await this.prisma.financialEntry.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException('Lançamento não encontrado.');
    return e;
  }
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
