import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DomainEvent, EntryStatus, EntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paymentFeeBps, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@delivery360/shared';
import { DEFAULT_ACCOUNTS, GROUPS, localDate, toDbDate } from './chart';

type Tx = Prisma.TransactionClient;
type Payload = Record<string, unknown>;

const ONLINE = ['PIX', 'CREDIT_CARD'];

/**
 * Liga os módulos à Gestão: lê a fila de eventos (domain_events) e gera os lançamentos
 * do financeiro. Idempotente: cada lançamento automático tem uma chave única.
 *
 * - pedido.recebido   → a receber 1.2 com a forma de pagamento do cliente (PIX/cartão online já entra baixado),
 *                       taxa da forma de pagamento 2.3 e imposto sobre a venda 2.1 (configurados em Gestão)
 * - pedido.status → COMPLETED → baixa do a receber (dinheiro/maquininha recebidos na entrega)
 * - pedido.cancelado  → cancela o a receber e o imposto; se já estava pago, a pagar 2.5 (devolver ao cliente)
 * - entrega.concluida → a pagar 6.1 ao motoboy (valor por entrega)
 * - gorjeta.recebida  → entrada 11.1 + a pagar 11.2 ao motoboy (fora da DRE)
 * - gorjeta.repassada → baixa do 11.2
 */
@Injectable()
export class GestaoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(GestaoSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.processPending().catch((e) => this.log.error(e)), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Cria o plano de contas padrão do restaurante (só as contas que faltam). */
  async ensureChart(tenantId: string, db: Tx | PrismaService = this.prisma) {
    const existing = await db.account.findMany({ where: { tenantId }, select: { code: true } });
    const have = new Set(existing.map((a) => a.code));
    const missing = DEFAULT_ACCOUNTS.filter(([code]) => !have.has(code));
    if (missing.length) {
      await db.account.createMany({
        data: missing.map(([code, name]) => {
          const group = Number(code.split('.')[0]);
          return { tenantId, code, name, group, kind: GROUPS.find((g) => g.group === group)!.kind, system: true };
        }),
        skipDuplicates: true,
      });
    }
  }

  /** Processa os eventos pendentes (de um restaurante ou de todos), em ordem. */
  async processPending(tenantId?: string) {
    if (this.running && !tenantId) return 0;
    this.running = !tenantId || this.running;
    let done = 0;
    try {
      for (;;) {
        const events = await this.prisma.domainEvent.findMany({
          where: { processedAt: null, ...(tenantId ? { tenantId } : {}) },
          orderBy: { createdAt: 'asc' },
          take: 100,
        });
        if (events.length === 0) break;
        for (const ev of events) {
          await this.prisma.$transaction(async (tx) => {
            // Marca primeiro: se outra chamada já pegou este evento, não processa de novo.
            const { count } = await tx.domainEvent.updateMany({ where: { id: ev.id, processedAt: null }, data: { processedAt: new Date() } });
            if (count === 0) return;
            await this.handle(tx, ev);
          });
          done++;
        }
        if (events.length < 100) break;
      }
    } finally {
      if (!tenantId) this.running = false;
    }
    return done;
  }

  private async handle(tx: Tx, ev: DomainEvent) {
    const p = ev.payload as Payload;
    const day = localDate(ev.createdAt);
    const t = ev.tenantId;
    switch (ev.type) {
      case 'pedido.recebido': {
        const order = await this.order(tx, String(p.orderId));
        if (!order) return;
        const online = ONLINE.includes(order.paymentMethod);
        const method = order.paymentMethod as PaymentMethod;
        await this.upsert(tx, t, `order:${order.id}:sale`, {
          type: 'RECEIVABLE',
          code: '1.2',
          description: `Pedido #${order.number}${order.type === 'PICKUP' ? ' (retirada)' : ''}`,
          counterparty: order.customerName,
          amountCents: order.totalCents,
          day,
          status: online ? 'PAID' : 'OPEN',
          source: 'cardapio',
          paymentMethod: method,
        });
        const rates = await this.rates(tx, t);
        // Taxa: a que o gateway informou; se não veio, a configurada para a forma de pagamento.
        const gatewayFee = order.payments.reduce((s, x) => s + x.feeCents, 0);
        const fee = gatewayFee || Math.round((order.totalCents * paymentFeeBps(rates, method)) / 10_000);
        if (fee > 0) {
          await this.upsert(tx, t, `order:${order.id}:fee`, {
            type: 'PAYABLE',
            code: '2.3',
            description: `Taxa ${PAYMENT_METHOD_LABELS[method]} · pedido #${order.number}`,
            amountCents: fee,
            day,
            // Descontada no repasse: já sai "paga" junto com o recebimento.
            status: online ? 'PAID' : 'OPEN',
            source: 'cardapio',
            paymentMethod: method,
          });
        }
        const tax = Math.round((order.totalCents * rates.salesTaxBps) / 10_000);
        if (tax > 0) {
          await this.upsert(tx, t, `order:${order.id}:tax`, {
            type: 'PAYABLE',
            code: '2.1',
            description: `Imposto sobre a venda · pedido #${order.number}`,
            amountCents: tax,
            day,
            dueDay: nextMonthDay(day, rates.taxDueDay),
            status: 'OPEN',
            source: 'cardapio',
          });
        }
        return;
      }
      case 'pedido.status': {
        if (p.to !== 'COMPLETED') return;
        // Dinheiro ou maquininha: recebido quando o pedido é entregue/retirado.
        await tx.financialEntry.updateMany({
          where: { tenantId: t, externalKey: { in: [`order:${String(p.orderId)}:sale`, `order:${String(p.orderId)}:fee`] }, status: 'OPEN' },
          data: { status: 'PAID', paidAt: toDbDate(day) },
        });
        return;
      }
      case 'pedido.cancelado': {
        const key = `order:${String(p.orderId)}:sale`;
        const sale = await tx.financialEntry.findUnique({ where: { tenantId_externalKey: { tenantId: t, externalKey: key } } });
        if (!sale || sale.status === 'CANCELLED') return;
        // Venda desfeita: o imposto não é devido; a taxa só some se ainda não foi descontada.
        await tx.financialEntry.updateMany({
          where: { tenantId: t, externalKey: { in: [`order:${String(p.orderId)}:tax`, `order:${String(p.orderId)}:fee`] }, status: 'OPEN' },
          data: { status: 'CANCELLED', notes: 'Pedido cancelado' },
        });
        if (sale.status === 'OPEN') {
          await tx.financialEntry.update({ where: { id: sale.id }, data: { status: 'CANCELLED', notes: 'Pedido cancelado' } });
          return;
        }
        // Já recebido (PIX): fica a devolução ao cliente como conta a pagar.
        await this.upsert(tx, t, `order:${String(p.orderId)}:refund`, {
          type: 'PAYABLE',
          code: '2.5',
          description: `Devolução ao cliente · ${sale.description}`,
          counterparty: sale.counterparty,
          amountCents: sale.amountCents,
          day,
          status: 'OPEN',
          source: 'cardapio',
        });
        return;
      }
      case 'entrega.concluida': {
        const fee = Number(p.courierFeeCents ?? 0);
        if (!fee) return;
        const [order, courier] = await Promise.all([
          this.order(tx, String(p.orderId)),
          tx.courier.findUnique({ where: { id: String(p.courierId) }, select: { name: true } }),
        ]);
        await this.upsert(tx, t, `delivery:${String(p.orderId)}:${String(p.courierId)}`, {
          type: 'PAYABLE',
          code: '6.1',
          description: `Entrega do pedido #${order?.number ?? '?'}`,
          counterparty: courier?.name ?? null,
          amountCents: fee,
          day,
          status: 'OPEN',
          source: 'entregas',
        });
        return;
      }
      case 'gorjeta.recebida': {
        const [order, courier] = await Promise.all([
          this.order(tx, String(p.orderId)),
          tx.courier.findUnique({ where: { id: String(p.courierId) }, select: { name: true } }),
        ]);
        const amountCents = Number(p.amountCents);
        const base = { amountCents, day, source: 'entregas' };
        await this.upsert(tx, t, `tip:${String(p.tipId)}:in`, {
          ...base,
          type: 'RECEIVABLE',
          code: '11.1',
          description: `Gorjeta do pedido #${order?.number ?? '?'}`,
          counterparty: order?.customerName ?? null,
          status: 'PAID',
        });
        await this.upsert(tx, t, `tip:${String(p.tipId)}:out`, {
          ...base,
          type: 'PAYABLE',
          code: '11.2',
          description: `Repassar gorjeta do pedido #${order?.number ?? '?'}`,
          counterparty: courier?.name ?? null,
          status: 'OPEN',
        });
        return;
      }
      case 'gorjeta.repassada': {
        const ids = (p.tipIds as string[] | undefined) ?? [];
        await tx.financialEntry.updateMany({
          where: { tenantId: t, externalKey: { in: ids.map((id) => `tip:${id}:out`) }, status: 'OPEN' },
          data: { status: 'PAID', paidAt: toDbDate(day) },
        });
        return;
      }
      default:
        return;
    }
  }

  /** Impostos e taxas do restaurante (zerados até o dono configurar). */
  async rates(db: Tx | PrismaService, tenantId: string) {
    const s = await db.financeSettings.findUnique({ where: { tenantId } });
    return s ?? { salesTaxBps: 0, pixFeeBps: 0, creditFeeBps: 0, cardOnDeliveryFeeBps: 0, targetMarginBps: 2000, taxDueDay: 20 };
  }

  private order(tx: Tx, id: string) {
    return tx.order.findUnique({
      where: { id },
      select: { id: true, number: true, type: true, customerName: true, totalCents: true, paymentMethod: true, payments: { where: { status: 'PAID' }, select: { feeCents: true } } },
    });
  }

  private async upsert(
    tx: Tx,
    tenantId: string,
    externalKey: string,
    e: {
      type: EntryType;
      code: string;
      description: string;
      counterparty?: string | null;
      amountCents: number;
      day: string;
      dueDay?: string;
      status: EntryStatus;
      source: string;
      paymentMethod?: string;
    },
  ) {
    await this.ensureChart(tenantId, tx);
    const account = await tx.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: e.code } } });
    const date = toDbDate(e.day);
    await tx.financialEntry.upsert({
      where: { tenantId_externalKey: { tenantId, externalKey } },
      update: {},
      create: {
        tenantId,
        externalKey,
        type: e.type,
        accountId: account.id,
        description: e.description,
        counterparty: e.counterparty ?? null,
        amountCents: e.amountCents,
        competenceDate: date,
        dueDate: e.dueDay ? toDbDate(e.dueDay) : date,
        paymentMethod: e.paymentMethod ?? null,
        status: e.status,
        paidAt: e.status === 'PAID' ? date : null,
        source: e.source,
      },
    });
  }
}

/** Dia N do mês seguinte (ex.: imposto da venda de 25/11 vence 20/12). */
function nextMonthDay(day: string, n: number) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, n)).toISOString().slice(0, 10);
}
