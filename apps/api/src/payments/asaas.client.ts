/** Erro devolvido pela API do Asaas, com a mensagem dela (em português). */
export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export const ASAAS_URL = { sandbox: 'https://api-sandbox.asaas.com/v3', production: 'https://api.asaas.com/v3' };

export interface AsaasPayment {
  id: string;
  status: string;
  value: number;
  netValue?: number;
  billingType: string;
  /** Página de pagamento do Asaas (fatura); no cartão, é onde o cliente digita os dados. */
  invoiceUrl?: string;
}

/**
 * Cliente mínimo da API v3 do Asaas (só o que o Pix e o cartão da loja usam).
 * Docs: https://docs.asaas.com/reference — autenticação pelo header access_token; User-Agent obrigatório.
 */
export class AsaasClient {
  private readonly base: string;

  constructor(
    private readonly apiKey: string,
    sandbox: boolean,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.base = sandbox ? ASAAS_URL.sandbox : ASAAS_URL.production;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Delivery360', access_token: this.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AsaasError('Não foi possível falar com o Asaas agora. Tente de novo em instantes.', 503);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      if (res.status === 401) throw new AsaasError('Chave da API do Asaas inválida ou de outro ambiente (sandbox x produção).', 401);
      const errors = (json.errors as { description?: string }[] | undefined) ?? [];
      throw new AsaasError(errors.map((e) => e.description).filter(Boolean).join(' ') || `Erro do Asaas (${res.status}).`, res.status);
    }
    return json as T;
  }

  accountInfo() {
    return this.call<{ name?: string; companyName?: string; tradingName?: string }>('GET', '/myAccount/commercialInfo/');
  }

  async findCustomerByDocument(cpfCnpj: string) {
    const r = await this.call<{ data: { id: string }[] }>('GET', `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`);
    return r.data[0]?.id ?? null;
  }

  async createCustomer(input: { name: string; cpfCnpj: string; mobilePhone: string; externalReference?: string }) {
    const r = await this.call<{ id: string }>('POST', '/customers', { ...input, notificationDisabled: true });
    return r.id;
  }

  createPayment(input: { customer: string; billingType: 'PIX' | 'CREDIT_CARD'; value: number; dueDate: string; description: string; externalReference?: string }) {
    return this.call<AsaasPayment>('POST', '/payments', input);
  }

  getPayment(id: string) {
    return this.call<AsaasPayment>('GET', `/payments/${encodeURIComponent(id)}`);
  }

  pixQrCode(id: string) {
    return this.call<{ encodedImage: string; payload: string; expirationDate?: string }>('GET', `/payments/${encodeURIComponent(id)}/pixQrCode`);
  }

  deletePayment(id: string) {
    return this.call<{ deleted: boolean }>('DELETE', `/payments/${encodeURIComponent(id)}`);
  }

  async createWebhook(input: { url: string; email: string; authToken: string }) {
    const r = await this.call<{ id: string }>('POST', '/webhooks', {
      name: 'Delivery360',
      url: input.url,
      email: input.email,
      authToken: input.authToken,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'],
    });
    return r.id;
  }

  deleteWebhook(id: string) {
    return this.call<{ deleted: boolean }>('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }
}
