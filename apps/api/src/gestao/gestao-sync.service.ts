import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DomainEvent, EntryStatus, EntryType, Prisma, SalesChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateServiceFee, CHANNEL_LABELS, CHANNEL_REVENUE_ACCOUNT, paymentFeeBps, PAYMENT_METHOD_LABELS, pdvPayLabel, TAB_PAYMENT_METHODS, type PaymentMethod } from '@delivery360/shared';
import { DEFAULT_ACCOUNTS, GROUPS, localDate, toDbDate } from './chart';

type Tx = Prisma.TransactionClient;
type Payload = Record<string, unknown>;

const ONLINE = ['PIX', 'CREDIT_CARD'];
/** Nomes do salão ("Cartão (maquininha)", não "na entrega"). */
const PAYMENT_METHOD_LABELS_SALAO: Partial<Record<PaymentMethod, string>> = Object.fromEntries(TAB_PAYMENT_METHODS.map((m) => [m.method, m.label]));

/**
 * Liga os módulos à Gestão: lê a fila de eventos (domain_events) e gera os lançamentos
 * do financeiro. Idempotente: cada lançamento automático tem uma chave única.
 *
 * - pedido.recebido   → a receber na conta do canal (1.2 loja, 1.3 iFood, 1.6 99Food, 1.7 Keeta) com a forma de pagamento
 *                       (PIX/cartão online já entra baixado; pago no app vence no dia do repasse do app),
 *                       taxa da forma de pagamento 2.3, comissão do app 2.2 e imposto sobre a venda 2.1
 * - pedido.status → COMPLETED → baixa do a receber (dinheiro/maquininha recebidos na entrega)
 * - pedido.cancelado  → cancela o a receber e o imposto; se já estava pago, a pagar 2.5 (devolver ao cliente)
 * - entrega.concluida → a pagar 6.1 ao motoboy (valor por entrega)
 * - pdv.venda_paga   → cada pagamento do balcão: 1.8 Balcão (já recebido) + taxa 2.3
 * - salao.conta_fechada → cada pagamento da mesa: 1.1 Salão + 11.3 taxa de serviço (fora da DRE) + taxa 2.3; a pagar 11.4 à equipe
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
        if (order.channel !== 'LOJA') return this.marketplaceSale(tx, t, day, order);
        // Salão: a venda só entra quando a conta da mesa fecha, já paga (aqui só imposto e descontos).
        // Balcão (PDV): igual ao salão, o dinheiro entra pelos pagamentos (pdv.venda_paga), já recebido.
        const dineIn = order.type === 'DINE_IN' || order.type === 'COUNTER';
        const online = ONLINE.includes(order.paymentMethod) || dineIn;
        const revenueCode = order.type === 'COUNTER' ? '1.8' : dineIn ? '1.1' : '1.2';
        const method = order.paymentMethod as PaymentMethod;
        const restaurantCoupon = order.discountCents - order.couponPlatformCents;
        // Venda pelo que o cliente pagou de fato: é o que entra no caixa e no extrato do gateway.
        // Salão: o dinheiro entra pelos pagamentos da conta da mesa (salao.conta_fechada), um por forma de pagamento.
        if (!dineIn) await this.upsert(tx, t, `order:${order.id}:sale`, {
          type: 'RECEIVABLE',
          code: revenueCode,
          description: dineIn
            ? `${order.tableName ?? 'Salão'} · pedido #${order.number}`
            : `Pedido #${order.number}${order.type === 'PICKUP' ? ' (retirada)' : ''}`,
          counterparty: order.customerName,
          amountCents: order.totalCents,
          day,
          status: online ? 'PAID' : 'OPEN',
          source: 'cardapio',
          paymentMethod: method,
          channel: 'LOJA',
        });
        // Preço de/por e cupom do restaurante: só no DRE (receita pelo preço cheio − desconto = o que foi pago).
        // Não é dinheiro, então não aparece em contas a pagar/receber nem no caixa.
        // Fidelidade (prêmio por pontos, clube, indicação): também custo do restaurante.
        const discountCents = order.promoDiscountCents + Math.max(0, restaurantCoupon) + order.loyaltyDiscountCents;
        if (discountCents > 0) {
          const memo = { day, status: (online ? 'PAID' : 'OPEN') as EntryStatus, source: 'cardapio', paymentMethod: method, channel: 'LOJA' as const, memo: true };
          await this.upsert(tx, t, `order:${order.id}:gross`, {
            ...memo,
            type: 'RECEIVABLE',
            code: revenueCode,
            description: `Preço cheio (antes dos descontos) · pedido #${order.number}`,
            counterparty: order.customerName,
            amountCents: discountCents,
          });
          if (order.promoDiscountCents > 0) {
            await this.upsert(tx, t, `order:${order.id}:promo`, {
              ...memo,
              type: 'PAYABLE',
              code: '2.4',
              description: `Preço promocional · pedido #${order.number}`,
              counterparty: order.customerName,
              amountCents: order.promoDiscountCents,
            });
          }
          if (restaurantCoupon > 0) {
            await this.upsert(tx, t, `order:${order.id}:coupon`, {
              ...memo,
              type: 'PAYABLE',
              code: '2.4',
              description: order.type === 'COUNTER' && !order.couponCode ? `Desconto no balcão · pedido #${order.number}` : `Cupom ${order.couponCode ?? ''} · pedido #${order.number}`.replace(/ +/g, ' '),
              counterparty: order.customerName,
              amountCents: restaurantCoupon,
            });
          }
          if (order.loyaltyDiscountCents > 0) {
            const what = [
              order.rewardDiscountCents > 0 ? `prêmio ${order.rewardName ?? ''}`.trim() : null,
              order.clubDiscountCents > 0 ? `clube ${order.clubLevelName ?? ''}`.trim() : null,
              order.referralDiscountCents > 0 ? 'indicação' : null,
            ].filter(Boolean);
            await this.upsert(tx, t, `order:${order.id}:loyalty`, {
              ...memo,
              type: 'PAYABLE',
              code: '2.4',
              description: `Fidelidade (${what.join(', ')}) · pedido #${order.number}`,
              counterparty: order.customerName,
              amountCents: order.loyaltyDiscountCents,
            });
          }
        }
        const from360 = order.platformDiscountCents + order.couponPlatformCents;
        if (from360 > 0) {
          await this.upsert(tx, t, `order:${order.id}:coupon360`, {
            type: 'RECEIVABLE',
            code: '1.2',
            description: `Desconto bancado pela Delivery360 · pedido #${order.number}`,
            counterparty: 'Delivery360',
            amountCents: from360,
            day,
            // A Delivery360 repassa depois: fica em aberto até o repasse.
            status: 'OPEN',
            source: 'cardapio',
            channel: 'LOJA',
          });
        }
        const rates = await this.rates(tx, t);
        // Taxa: a que o gateway informou; se não veio, a configurada para a forma de pagamento.
        const gatewayFee = order.payments.reduce((s, x) => s + x.feeCents, 0);
        const fee = gatewayFee || Math.round((order.totalCents * paymentFeeBps(rates, method)) / 10_000);
        if (fee > 0 && !dineIn) {
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
            channel: 'LOJA',
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
            channel: 'LOJA',
          });
        }
        return;
      }
      case 'pedido.status': {
        if (p.to !== 'COMPLETED') return;
        // Dinheiro ou maquininha: recebido quando o pedido é entregue/retirado.
        // Pago no app não: esse entra no dia do repasse do app.
        await tx.financialEntry.updateMany({
          where: {
            tenantId: t,
            externalKey: { in: ['sale', 'fee', 'gross', 'promo', 'coupon', 'loyalty'].map((k) => `order:${String(p.orderId)}:${k}`) },
            status: 'OPEN',
            paymentMethod: { not: 'APP_ONLINE' },
          },
          data: { status: 'PAID', paidAt: toDbDate(day) },
        });
        return;
      }
      case 'pedido.cancelado': {
        // Venda de balcão cancelada: o dinheiro foi devolvido na hora, então os lançamentos somem (caixa bate).
        const pdvPays = await tx.counterPayment.findMany({ where: { orderId: String(p.orderId) }, select: { id: true } });
        if (pdvPays.length) {
          await tx.financialEntry.updateMany({
            where: {
              tenantId: t,
              status: { not: 'CANCELLED' },
              externalKey: {
                in: [
                  ...pdvPays.flatMap((x) => [`pdvpay:${x.id}:sale`, `pdvpay:${x.id}:fee`]),
                  ...['tax', 'gross', 'promo', 'coupon', 'loyalty'].map((k) => `order:${String(p.orderId)}:${k}`),
                ],
              },
            },
            data: { status: 'CANCELLED', notes: 'Venda do balcão cancelada' },
          });
          return;
        }
        const key = `order:${String(p.orderId)}:sale`;
        const sale = await tx.financialEntry.findUnique({ where: { tenantId_externalKey: { tenantId: t, externalKey: key } } });
        if (!sale || sale.status === 'CANCELLED') return;
        // Venda desfeita: o imposto não é devido; a taxa só some se ainda não foi descontada.
        await tx.financialEntry.updateMany({
          where: {
            tenantId: t,
            externalKey: { in: ['tax', 'fee', 'commission', 'subsidy', 'gross', 'promo', 'coupon', 'loyalty', 'coupon360'].map((k) => `order:${String(p.orderId)}:${k}`) },
            status: 'OPEN',
          },
          data: { status: 'CANCELLED', notes: 'Pedido cancelado' },
        });
        if (sale.status === 'OPEN') {
          await tx.financialEntry.update({ where: { id: sale.id }, data: { status: 'CANCELLED', notes: 'Pedido cancelado' } });
          return;
        }
        // Já recebido (PIX/cartão): fica a devolução ao cliente como conta a pagar, do que ele pagou de fato.
        const paidByCustomer = sale.amountCents;
        await this.upsert(tx, t, `order:${String(p.orderId)}:refund`, {
          type: 'PAYABLE',
          code: '2.5',
          description: `Devolução ao cliente · ${sale.description}`,
          counterparty: sale.counterparty,
          amountCents: paidByCustomer,
          day,
          status: 'OPEN',
          source: 'cardapio',
          channel: sale.channel ?? undefined,
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
      case 'pdv.venda_paga': {
        // Cada pagamento do balcão entra no caixa com a sua forma, pelo valor que ficou (sem o troco).
        const order = await tx.order.findUnique({ where: { id: String(p.orderId) }, include: { counterPayments: { orderBy: { createdAt: 'asc' } } } });
        if (!order || order.status === 'CANCELLED' || !order.counterPayments.length) return;
        const rates = await this.rates(tx, t);
        const many = order.counterPayments.length > 1;
        for (const [i, pay] of order.counterPayments.entries()) {
          const method = pay.method as PaymentMethod;
          const label = `${pdvPayLabel(method, pay.cardKind)}${many ? ` ${i + 1}/${order.counterPayments.length}` : ''}${pay.label ? ` (${pay.label})` : ''}`;
          const base = { day, status: 'PAID' as EntryStatus, source: 'cardapio', paymentMethod: method, channel: 'LOJA' as const };
          await this.upsert(tx, t, `pdvpay:${pay.id}:sale`, {
            ...base,
            type: 'RECEIVABLE',
            code: '1.8',
            description: `${order.totemId ? 'Totem' : 'Balcão'} · pedido #${order.number} · ${label}`,
            counterparty: pay.label ?? (order.customerName === 'Balcão' ? null : order.customerName),
            amountCents: pay.amountCents,
          });
          const fee = Math.round((pay.amountCents * paymentFeeBps(rates, method)) / 10_000);
          if (fee > 0) {
            await this.upsert(tx, t, `pdvpay:${pay.id}:fee`, { ...base, type: 'PAYABLE', code: '2.3', description: `Taxa ${label} · ${order.totemId ? 'totem' : 'balcão'} #${order.number}`, amountCents: fee });
          }
        }
        return;
      }
      case 'salao.conta_fechada': {
        // Cada pagamento da mesa entra no caixa com a sua forma (cartão 1, cartão 2, Pix, dinheiro):
        // a parte do consumo em 1.1 Salão e a parte da taxa de serviço em 11.3 (da equipe, fora da DRE).
        const tab = await tx.tableTab.findUnique({ where: { id: String(p.tabId) }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
        if (!tab || tab.status !== 'CLOSED' || !tab.payments.length) return;
        const rates = await this.rates(tx, t);
        const shares = allocateServiceFee(tab.payments.map((x) => x.amountCents), tab.serviceFeeCents);
        const many = tab.payments.length > 1;
        for (const [i, pay] of tab.payments.entries()) {
          const method = pay.method as PaymentMethod;
          const label = `${tab.tableName} · ${PAYMENT_METHOD_LABELS_SALAO[method] ?? PAYMENT_METHOD_LABELS[method]}${many ? ` ${i + 1}/${tab.payments.length}` : ''}${pay.label ? ` (${pay.label})` : ''}`;
          const service = shares[i];
          const sale = pay.amountCents - service;
          const base = { day, status: 'PAID' as EntryStatus, source: 'cardapio', paymentMethod: method, channel: 'LOJA' as const };
          if (sale > 0) {
            await this.upsert(tx, t, `tabpay:${pay.id}:sale`, { ...base, type: 'RECEIVABLE', code: '1.1', description: label, counterparty: pay.label, amountCents: sale });
          }
          if (service > 0) {
            await this.upsert(tx, t, `tabpay:${pay.id}:service`, { ...base, type: 'RECEIVABLE', code: '11.3', description: `Taxa de serviço · ${label}`, counterparty: pay.label, amountCents: service });
          }
          // A maquininha/Pix cobra sobre o valor inteiro passado.
          const fee = Math.round((pay.amountCents * paymentFeeBps(rates, method)) / 10_000);
          if (fee > 0) {
            await this.upsert(tx, t, `tabpay:${pay.id}:fee`, { ...base, type: 'PAYABLE', code: '2.3', description: `Taxa ${PAYMENT_METHOD_LABELS_SALAO[method] ?? method} · ${tab.tableName}`, amountCents: fee });
          }
        }
        if (tab.serviceFeeCents > 0) {
          await this.upsert(tx, t, `tab:${tab.id}:service-out`, {
            type: 'PAYABLE',
            code: '11.4',
            description: `Repassar taxa de serviço · ${tab.tableName}`,
            counterparty: 'Equipe do salão',
            amountCents: tab.serviceFeeCents,
            day,
            status: 'OPEN',
            source: 'cardapio',
          });
        }
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
    return s ?? { salesTaxBps: 0, pixFeeBps: 0, creditFeeBps: 0, cardOnDeliveryFeeBps: 0, targetMarginBps: 2000, taxDueDay: 20, fgtsBps: 800, employerInssBps: 0, payDay: 5 };
  }

  private order(tx: Tx, id: string) {
    return tx.order.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        type: true,
        customerName: true,
        tableName: true,
        totalCents: true,
        channelLink: { select: { externalAmounts: true } },
        promoDiscountCents: true,
        discountCents: true,
        couponCode: true,
        platformDiscountCents: true,
        couponPlatformCents: true,
        loyaltyDiscountCents: true,
        rewardName: true,
        rewardDiscountCents: true,
        clubLevelName: true,
        clubDiscountCents: true,
        referralDiscountCents: true,
        paymentMethod: true,
        channel: true,
        externalCode: true,
        payments: { where: { status: 'PAID' }, select: { feeCents: true } },
      },
    });
  }

  /**
   * Venda de app de delivery: receita na conta do app, comissão 2.2 e, se pago no app, taxa do app 2.3.
   * Pago no app: o app repassa depois (vence em "dias para o repasse"); comissão e taxa saem descontadas no repasse.
   * Pago na entrega (dinheiro/maquininha): recebido quando o pedido é finalizado, como na loja.
   */
  private async marketplaceSale(tx: Tx, t: string, day: string, order: NonNullable<Awaited<ReturnType<GestaoSyncService['order']>>>) {
    const channel = order.channel;
    const label = CHANNEL_LABELS[channel];
    const cfg = await tx.channelSetting.findUnique({ where: { tenantId_channel: { tenantId: t, channel } } });
    const rates = await this.rates(tx, t);
    const method = order.paymentMethod as PaymentMethod;
    const inApp = method === 'APP_ONLINE';
    const payoutDay = addDays(day, cfg?.payoutDays ?? 30);
    const ref = `pedido #${order.number}${order.externalCode ? ` (${label} ${order.externalCode})` : ''}`;
    const base = { day, source: 'cardapio', channel };

    await this.upsert(tx, t, `order:${order.id}:sale`, {
      ...base,
      type: 'RECEIVABLE',
      code: CHANNEL_REVENUE_ACCOUNT[channel],
      description: `Venda ${label} · ${ref}`,
      counterparty: inApp ? label : order.customerName,
      amountCents: order.totalCents,
      dueDay: inApp ? payoutDay : undefined,
      status: 'OPEN',
      paymentMethod: method,
    });
    // Valores informados pelo app (Hub iFood) valem mais que o % configurado.
    const informed = (order.channelLink?.externalAmounts ?? {}) as { commissionCents?: number; paymentFeeCents?: number; ifoodDiscountCents?: number };
    const subsidy = inApp ? Math.max(0, Number(informed.ifoodDiscountCents ?? 0)) : 0;
    if (subsidy > 0) {
      // Desconto bancado pelo app: o cliente pagou menos, mas o app paga essa parte ao restaurante no repasse.
      await this.upsert(tx, t, `order:${order.id}:subsidy`, {
        ...base,
        type: 'RECEIVABLE',
        code: CHANNEL_REVENUE_ACCOUNT[channel],
        description: `Desconto bancado pelo ${label} · ${ref}`,
        counterparty: label,
        amountCents: subsidy,
        dueDay: payoutDay,
        status: 'OPEN',
        paymentMethod: method,
      });
    }
    const commission =
      typeof informed.commissionCents === 'number' ? informed.commissionCents : Math.round((order.totalCents * (cfg?.commissionBps ?? 0)) / 10_000);
    if (commission > 0) {
      await this.upsert(tx, t, `order:${order.id}:commission`, {
        ...base,
        type: 'PAYABLE',
        code: '2.2',
        description: `Comissão ${label} · ${ref}`,
        counterparty: label,
        amountCents: commission,
        dueDay: payoutDay,
        status: 'OPEN',
        paymentMethod: method,
      });
    }
    const feeBps = inApp ? (cfg?.paymentFeeBps ?? 0) : paymentFeeBps(rates, method);
    const fee = inApp && typeof informed.paymentFeeCents === 'number' ? informed.paymentFeeCents : Math.round((order.totalCents * feeBps) / 10_000);
    if (fee > 0) {
      await this.upsert(tx, t, `order:${order.id}:fee`, {
        ...base,
        type: 'PAYABLE',
        code: '2.3',
        description: `Taxa ${inApp ? `pagamento ${label}` : PAYMENT_METHOD_LABELS[method]} · ${ref}`,
        counterparty: inApp ? label : null,
        amountCents: fee,
        dueDay: inApp ? payoutDay : undefined,
        status: 'OPEN',
        paymentMethod: method,
      });
    }
    const tax = Math.round((order.totalCents * rates.salesTaxBps) / 10_000);
    if (tax > 0) {
      await this.upsert(tx, t, `order:${order.id}:tax`, {
        ...base,
        type: 'PAYABLE',
        code: '2.1',
        description: `Imposto sobre a venda · ${ref}`,
        amountCents: tax,
        dueDay: nextMonthDay(day, rates.taxDueDay),
        status: 'OPEN',
      });
    }
  }

  /** Cria o lançamento automático (uma vez só por chave). */
  async upsert(
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
      channel?: SalesChannel;
      memo?: boolean;
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
        channel: e.channel ?? null,
        memo: e.memo ?? false,
      },
    });
  }
}

/** Dia N do mês seguinte (ex.: imposto da venda de 25/11 vence 20/12). */
function nextMonthDay(day: string, n: number) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, n)).toISOString().slice(0, 10);
}

/** Data + N dias (ex.: repasse do app 30 dias depois da venda). */
function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
