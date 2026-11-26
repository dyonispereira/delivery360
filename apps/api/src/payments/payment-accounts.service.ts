import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { AsaasClient, AsaasError, type FetchLike } from './asaas.client';
import { AsaasGateway, FakePaymentGateway, type PaymentGateway } from './payment-gateway';
import { open, seal } from './secret-box';

/** Endereço que o Asaas chama a cada pagamento (precisa ser público). */
export const asaasWebhookUrl = (tenantId: string) => {
  const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  return base ? `${base}/public/webhooks/asaas/${tenantId}` : null;
};

/**
 * Conta de pagamento de cada restaurante. Hoje: Asaas, com o dinheiro caindo direto na conta do restaurante
 * (a Delivery360 não toca no dinheiro). Sem conta conectada, só o Pix de teste (PAYMENTS_FAKE_ENABLED).
 */
@Injectable()
export class PaymentAccountsService {
  private readonly logger = new Logger(PaymentAccountsService.name);
  /** Troca nos testes para não chamar o Asaas de verdade. */
  fetchImpl: FetchLike | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private client(apiKey: string, sandbox: boolean) {
    return new AsaasClient(apiKey, sandbox, this.fetchImpl);
  }

  private fakeEnabled() {
    return process.env.PAYMENTS_FAKE_ENABLED === 'true';
  }

  /** Gateway que recebe o Pix desta loja, ou null se a loja ainda não pode receber online. */
  async gatewayFor(tenantId: string): Promise<PaymentGateway | null> {
    const account = await this.prisma.paymentAccount.findUnique({ where: { tenantId } });
    if (account) return new AsaasGateway(this.client(open(account.apiKeyEncrypted), account.sandbox));
    return this.fakeEnabled() ? new FakePaymentGateway() : null;
  }

  async status(tenantId: string) {
    const a = await this.prisma.paymentAccount.findUnique({ where: { tenantId } });
    return {
      connected: !!a,
      provider: a?.provider ?? null,
      sandbox: a?.sandbox ?? false,
      apiKeyLast4: a?.apiKeyLast4 ?? null,
      accountName: a?.accountName ?? null,
      webhookActive: !!a?.webhookId,
      connectedAt: a?.updatedAt ?? null,
      /** Sem conta, a loja usa o Pix de teste (só em ambiente de teste). */
      testPixAvailable: this.fakeEnabled(),
      webhookUrlConfigured: !!asaasWebhookUrl(tenantId),
    };
  }

  /** Confere a chave no Asaas, cadastra o webhook de pagamentos e guarda tudo (a chave cifrada). */
  async connect(tenantId: string, userId: string, dto: { apiKey: string; sandbox: boolean }) {
    const apiKey = dto.apiKey.trim();
    const url = asaasWebhookUrl(tenantId);
    if (!url) throw new BadRequestException('O endereço público da API não está configurado (PUBLIC_API_URL). Fale com a Delivery360.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const client = this.client(apiKey, dto.sandbox);
    const before = await this.prisma.paymentAccount.findUnique({ where: { tenantId } });
    try {
      const info = await client.accountInfo();
      // Reconectar: tira o webhook antigo para o Asaas não avisar duas vezes.
      if (before?.webhookId) await this.dropWebhook(before.apiKeyEncrypted, before.sandbox, before.webhookId);
      const webhookToken = randomBytes(32).toString('base64url');
      const webhookId = await client.createWebhook({ url, email: user?.email ?? 'pagamentos@delivery360.app', authToken: webhookToken });
      const data = {
        provider: 'asaas',
        sandbox: dto.sandbox,
        apiKeyEncrypted: seal(apiKey),
        apiKeyLast4: apiKey.slice(-4),
        accountName: info.tradingName || info.companyName || info.name || null,
        webhookToken,
        webhookId,
      };
      await this.prisma.paymentAccount.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    } catch (e) {
      if (e instanceof AsaasError) throw new BadRequestException(e.message);
      throw e;
    }
    await this.audit.log({ tenantId, userId, action: 'payments.connect', entity: 'payment_account', after: { provider: 'asaas', sandbox: dto.sandbox } });
    return this.status(tenantId);
  }

  async disconnect(tenantId: string, userId: string) {
    const a = await this.prisma.paymentAccount.findUnique({ where: { tenantId } });
    if (!a) throw new NotFoundException('Nenhuma conta de pagamento conectada.');
    if (a.webhookId) await this.dropWebhook(a.apiKeyEncrypted, a.sandbox, a.webhookId);
    await this.prisma.paymentAccount.delete({ where: { tenantId } });
    await this.audit.log({ tenantId, userId, action: 'payments.disconnect', entity: 'payment_account', before: { provider: a.provider, sandbox: a.sandbox } });
    return this.status(tenantId);
  }

  /** O webhook só vale com o token que cadastramos no Asaas desta loja. */
  async checkWebhookToken(tenantId: string, token: string | undefined) {
    const a = await this.prisma.paymentAccount.findUnique({ where: { tenantId }, select: { webhookToken: true } });
    if (!a || !token) return false;
    const x = Buffer.from(a.webhookToken);
    const y = Buffer.from(token);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  /** Valor da taxa do Asaas numa cobrança (valor - valor líquido), em centavos. */
  static feeCents(payment: { value?: number; netValue?: number }) {
    if (payment.value == null || payment.netValue == null) return 0;
    return Math.max(0, Math.round((payment.value - payment.netValue) * 100));
  }

  private async dropWebhook(apiKeyEncrypted: string, sandbox: boolean, webhookId: string) {
    try {
      await this.client(open(apiKeyEncrypted), sandbox).deleteWebhook(webhookId);
    } catch (e) {
      // A chave antiga pode já ter sido revogada: segue sem o webhook antigo.
      this.logger.warn(`Não consegui remover o webhook antigo do Asaas: ${(e as Error).message}`);
    }
  }
}
