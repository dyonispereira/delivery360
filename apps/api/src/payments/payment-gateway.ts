import { randomBytes } from 'node:crypto';

export interface CreateChargeInput {
  paymentId: string;
  amountCents: number;
  method: 'PIX' | 'CREDIT_CARD';
  description: string;
  customer: { name: string; phone: string };
}

export interface ChargeResult {
  externalId: string;
  pixCopyPaste?: string;
  expiresAt?: Date;
}

/**
 * Contrato que cada gateway (Mercado Pago, Pagar.me, Asaas...) vai implementar.
 * A confirmação do pagamento chega sempre pelo servidor (webhook), nunca pelo navegador.
 */
export interface PaymentGateway {
  readonly name: string;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
export const PIX_EXPIRATION_MINUTES = 15;

/**
 * Gateway de desenvolvimento: gera um PIX de mentira e permite "simular o pagamento".
 * Só fica ligado com PAYMENTS_FAKE_ENABLED=true. Trocar pelo gateway real quando o contrato for fechado.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = 'fake';

  async createCharge(input: CreateChargeInput): Promise<ChargeResult> {
    const externalId = `fake_${randomBytes(8).toString('hex')}`;
    return {
      externalId,
      pixCopyPaste:
        input.method === 'PIX'
          ? `00020126580014BR.GOV.BCB.PIX0136${externalId}5204000053039865406${(input.amountCents / 100).toFixed(2)}5802BR5913DELIVERY360TESTE6009SAO PAULO`
          : undefined,
      expiresAt: new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000),
    };
  }
}
