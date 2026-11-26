import { randomBytes } from 'node:crypto';
import { AsaasClient } from './asaas.client';

export interface CreateChargeInput {
  amountCents: number;
  method: 'PIX';
  description: string;
  customer: {
    name: string;
    phone: string;
    /** CPF ou CNPJ, só dígitos (o Asaas exige). */
    document?: string | null;
    /** Id do cliente já cadastrado no gateway, para não cadastrar de novo. */
    gatewayCustomerId?: string | null;
  };
}

export interface ChargeResult {
  externalId: string;
  pixCopyPaste?: string;
  /** PNG em base64. */
  pixQrImage?: string;
  expiresAt?: Date;
  gatewayCustomerId?: string;
}

/**
 * Contrato de cada gateway. A confirmação do pagamento chega sempre pelo servidor (webhook), nunca pelo navegador.
 */
export interface PaymentGateway {
  readonly name: string;
  /** O gateway exige CPF/CNPJ do pagador. */
  readonly requiresDocument: boolean;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  /** Cancela a cobrança que venceu sem pagamento, para ninguém pagar um pedido já cancelado. */
  cancelCharge(externalId: string): Promise<void>;
}

export const PIX_EXPIRATION_MINUTES = 15;

/**
 * Gateway de desenvolvimento: gera um PIX de mentira e permite "simular o pagamento".
 * Só fica ligado com PAYMENTS_FAKE_ENABLED=true, para lojas sem conta Asaas conectada.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'fake';
  readonly requiresDocument = false;

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    const externalId = `fake_${randomBytes(8).toString('hex')}`;
    return {
      externalId,
      pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136${externalId}5204000053039865406${(input.amountCents / 100).toFixed(2)}5802BR5913DELIVERY360TESTE6009SAO PAULO`,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000),
    };
  }

  async cancelCharge() {}
}

/** Data de hoje em Brasília (AAAA-MM-DD), que é o vencimento da cobrança Pix. */
export const todayInBrazil = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);

/** Pix pela conta Asaas do próprio restaurante: o dinheiro cai direto nela. */
export class AsaasGateway implements PaymentGateway {
  readonly name = 'asaas';
  readonly requiresDocument = true;

  constructor(private readonly client: AsaasClient) {}

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    const document = input.customer.document;
    if (!document) throw new Error('CPF obrigatório para o Pix do Asaas.');
    let customer = input.customer.gatewayCustomerId ?? (await this.client.findCustomerByDocument(document));
    if (!customer) customer = await this.client.createCustomer({ name: input.customer.name, cpfCnpj: document, mobilePhone: input.customer.phone });
    const payment = await this.client.createPayment({
      customer,
      billingType: 'PIX',
      value: Math.round(input.amountCents) / 100,
      dueDate: todayInBrazil(),
      description: input.description.slice(0, 500),
    });
    const qr = await this.client.pixQrCode(payment.id);
    return {
      externalId: payment.id,
      pixCopyPaste: qr.payload,
      pixQrImage: qr.encodedImage,
      // O prazo da loja é curto (o pedido espera pagamento); depois disso a cobrança é cancelada no Asaas.
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000),
      gatewayCustomerId: customer,
    };
  }

  async cancelCharge(externalId: string) {
    await this.client.deletePayment(externalId);
  }
}
