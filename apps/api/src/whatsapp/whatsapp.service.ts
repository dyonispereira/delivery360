import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { publicWebUrl, statusMessage, whatsappNumber } from './order-messages';
import { EvolutionProvider, FakeWhatsapp, WhatsappError, type WhatsappProvider } from './whatsapp.provider';
import { scheduleLabel } from '../cardapio/schedule';

/** Avisos mais velhos que isso não saem mais (ex.: WhatsApp ficou desconectado por horas). */
const MAX_AGE_MS = 2 * 60 * 60_000;

/**
 * WhatsApp do restaurante (conectado por QR Code) e avisos de status do pedido para o cliente.
 * Os avisos saem de uma fila: cada mudança de status (order_status_history) é enviada uma vez, em ordem.
 */
@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsappService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Troca nos testes. */
  provider: WhatsappProvider | null = WhatsappService.providerFromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static providerFromEnv(): WhatsappProvider | null {
    const url = process.env.WHATSAPP_API_URL;
    const key = process.env.WHATSAPP_API_KEY;
    if (url && key) return new EvolutionProvider(url, key);
    return process.env.WHATSAPP_FAKE_ENABLED === 'true' ? new FakeWhatsapp() : null;
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !this.provider) return;
    this.timer = setInterval(() => void this.processPending().catch((e) => this.log.error(e)), 8_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private need() {
    if (!this.provider) throw new BadRequestException('O WhatsApp ainda não está disponível neste servidor. Fale com a Delivery360.');
    return this.provider;
  }

  private wrap(e: unknown): never {
    if (e instanceof WhatsappError) throw new BadRequestException(e.message);
    throw e;
  }

  /** Situação para o painel. Enquanto espera o QR, confere no servidor se já conectou. */
  async status(tenantId: string) {
    let a = await this.prisma.whatsappAccount.findUnique({ where: { tenantId } });
    if (a && this.provider && a.status !== 'CONNECTED') a = await this.refresh(a.id, a.instanceName).catch(() => a);
    return {
      available: !!this.provider,
      connected: a?.status === 'CONNECTED',
      status: a?.status ?? null,
      phone: a?.phone ?? null,
      notifyEnabled: a?.notifyEnabled ?? true,
      connectedAt: a?.connectedAt ?? null,
    };
  }

  private async refresh(id: string, instance: string) {
    const provider = this.need();
    const before = await this.prisma.whatsappAccount.findUniqueOrThrow({ where: { id } });
    const state = await provider.state(instance);
    if (state === 'open') {
      const phone = await provider.ownerPhone(instance).catch(() => null);
      const account = await this.prisma.whatsappAccount.update({ where: { id }, data: { status: 'CONNECTED', phone, connectedAt: before.connectedAt && before.status !== 'PENDING' ? before.connectedAt : new Date() } });
      // Conectou pelo QR agora: o que aconteceu antes não vira mensagem atrasada para o cliente.
      // (Se só caiu e voltou sozinho, a fila continua e sai em ordem.)
      if (before.status === 'PENDING') {
        await this.prisma.orderStatusHistory.updateMany({ where: { notifiedAt: null, order: { tenantId: account.tenantId } }, data: { notifiedAt: new Date() } });
      }
      return account;
    }
    // Instância sumiu do servidor ou foi desconectada no celular: precisa ler o QR de novo.
    const status = state === 'connecting' && before.status === 'PENDING' ? 'PENDING' : 'DISCONNECTED';
    return this.prisma.whatsappAccount.update({ where: { id }, data: { status } });
  }

  /** Gera o QR Code para o dono ler no WhatsApp do celular da loja. */
  async connect(tenantId: string, userId: string) {
    const provider = this.need();
    const account =
      (await this.prisma.whatsappAccount.findUnique({ where: { tenantId } })) ??
      (await this.prisma.whatsappAccount.create({ data: { tenantId, instanceName: `d360-${randomBytes(6).toString('hex')}` } }));
    const r = await provider.connect(account.instanceName).catch((e) => this.wrap(e));
    if (r.state === 'open') {
      await this.refresh(account.id, account.instanceName);
      return { ...(await this.status(tenantId)), qr: null, pairingCode: null };
    }
    await this.prisma.whatsappAccount.update({ where: { id: account.id }, data: { status: 'PENDING' } });
    await this.audit.log({ tenantId, userId, action: 'whatsapp.connect', entity: 'whatsapp_account' });
    return { available: true, connected: false, status: 'PENDING', phone: null, notifyEnabled: account.notifyEnabled, connectedAt: null, qr: r.qr ?? null, pairingCode: r.pairingCode ?? null };
  }

  async setNotify(tenantId: string, enabled: boolean) {
    const a = await this.prisma.whatsappAccount.findUnique({ where: { tenantId } });
    if (!a) throw new NotFoundException('Conecte o WhatsApp da loja primeiro.');
    // Religou: o que aconteceu com os avisos desligados não sai atrasado.
    if (enabled && !a.notifyEnabled) {
      await this.prisma.orderStatusHistory.updateMany({ where: { notifiedAt: null, order: { tenantId } }, data: { notifiedAt: new Date() } });
    }
    await this.prisma.whatsappAccount.update({ where: { id: a.id }, data: { notifyEnabled: enabled } });
    return this.status(tenantId);
  }

  async disconnect(tenantId: string, userId: string) {
    const a = await this.prisma.whatsappAccount.findUnique({ where: { tenantId } });
    if (!a) return this.status(tenantId);
    await this.provider?.remove(a.instanceName).catch(() => undefined);
    await this.prisma.whatsappAccount.delete({ where: { id: a.id } });
    await this.audit.log({ tenantId, userId, action: 'whatsapp.disconnect', entity: 'whatsapp_account' });
    return this.status(tenantId);
  }

  /** Manda uma mensagem de teste para o próprio WhatsApp da loja. */
  async sendTest(tenantId: string) {
    const provider = this.need();
    const a = await this.prisma.whatsappAccount.findUnique({ where: { tenantId }, include: { tenant: { select: { store: { select: { displayName: true } } } } } });
    if (a?.status !== 'CONNECTED' || !a.phone) throw new BadRequestException('Conecte o WhatsApp da loja primeiro.');
    await provider
      .sendText(a.instanceName, a.phone, `✅ Teste da ${a.tenant.store?.displayName ?? 'loja'}: os avisos de pedido pelo WhatsApp estão funcionando.`)
      .catch((e) => this.wrap(e));
    return { sent: true };
  }

  /**
   * Envia os avisos pendentes. Cada linha do histórico é "reservada" antes de enviar (não sai duas vezes,
   * mesmo com dois servidores); se o envio falha, volta para a fila e tenta de novo.
   */
  async processPending(now = new Date()) {
    if (!this.provider || this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const since = new Date(now.getTime() - MAX_AGE_MS);
      // Conexão que caiu pode voltar sozinha (o servidor reconecta): confere de vez em quando.
      for (const a of await this.prisma.whatsappAccount.findMany({ where: { status: 'DISCONNECTED' }, select: { id: true, instanceName: true }, take: 20 })) {
        await this.refresh(a.id, a.instanceName).catch(() => undefined);
      }
      // Fila velha (loja sem WhatsApp, ou fora do ar por horas) é descartada.
      await this.prisma.orderStatusHistory.updateMany({ where: { notifiedAt: null, createdAt: { lt: since } }, data: { notifiedAt: now } });
      const rows = await this.prisma.orderStatusHistory.findMany({
        where: { notifiedAt: null, createdAt: { gte: since }, // Só pedidos da loja própria: quem pediu pelo iFood/99/Keeta é avisado pelo app de lá.
        // Mesa do salão também não: o cliente está ali, sem telefone.
        order: { channel: 'LOJA', type: { not: 'DINE_IN' }, tenant: { whatsappAccount: { status: 'CONNECTED', notifyEnabled: true } } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          order: {
            select: {
              id: true,
              number: true,
              type: true,
              customerName: true,
              customerPhone: true,
              trackingCode: true,
              scheduledFor: true,
              batch: { select: { courier: { select: { name: true } } } },
              tenant: { select: { whatsappAccount: true, store: { select: { displayName: true, estimatedMinutes: true } } } },
            },
          },
        },
      });
      const web = publicWebUrl();
      const failedOrders = new Set<string>();
      for (const row of rows) {
        const o = row.order;
        const account = o.tenant.whatsappAccount!;
        // Mantém a ordem: se um aviso do pedido falhou, os seguintes esperam.
        if (failedOrders.has(o.id)) continue;
        const claimed = await this.prisma.orderStatusHistory.updateMany({ where: { id: row.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
        if (claimed.count === 0) continue;
        const number = whatsappNumber(o.customerPhone);
        const text = statusMessage({
          status: row.status,
          type: o.type,
          number: o.number,
          storeName: o.tenant.store?.displayName ?? 'loja',
          customerName: o.customerName,
          trackingUrl: web ? `${web}/pedido/${o.trackingCode}` : null,
          courierName: o.batch?.courier.name,
          estimatedMinutes: o.tenant.store?.estimatedMinutes,
          scheduledLabel: o.scheduledFor ? scheduleLabel(o.scheduledFor) : null,
        });
        if (!number || !text) continue;
        try {
          await this.provider.sendText(account.instanceName, number, text);
          sent++;
        } catch (e) {
          await this.prisma.orderStatusHistory.update({ where: { id: row.id }, data: { notifiedAt: null } });
          failedOrders.add(o.id);
          this.log.warn(`WhatsApp da loja ${o.tenant.store?.displayName}: aviso do pedido #${o.number} não saiu (${(e as Error).message})`);
          // Confere se caiu a conexão; se caiu, o painel mostra "desconectado" e a fila espera.
          const state = await this.provider.state(account.instanceName).catch(() => 'open' as const);
          if (state !== 'open') await this.prisma.whatsappAccount.update({ where: { id: account.id }, data: { status: 'DISCONNECTED' } });
        }
      }
    } finally {
      this.running = false;
    }
    return sent;
  }
}
