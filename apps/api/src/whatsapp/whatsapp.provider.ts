/** Erro do servidor de WhatsApp, com mensagem para o painel. */
export class WhatsappError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export type WaState = 'open' | 'connecting' | 'close';

export interface WaConnect {
  state: WaState;
  /** QR Code em PNG (data URL), enquanto espera a leitura. */
  qr?: string;
  /** Código para conectar pelo número, sem câmera (WhatsApp > Aparelhos conectados > Conectar com número). */
  pairingCode?: string;
}

/**
 * Servidor que mantém o WhatsApp de cada restaurante conectado por QR Code.
 * Cada loja é uma "instância" com o nome guardado em whatsapp_accounts.
 */
export interface WhatsappProvider {
  readonly name: string;
  connect(instance: string): Promise<WaConnect>;
  /** null: a instância não existe mais no servidor. */
  state(instance: string): Promise<WaState | null>;
  ownerPhone(instance: string): Promise<string | null>;
  sendText(instance: string, number: string, text: string): Promise<void>;
  remove(instance: string): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Evolution API (código aberto, roda num servidor próprio): WHATSAPP_API_URL + WHATSAPP_API_KEY.
 * Rotas da v2: /instance/create, /instance/connect/:i, /instance/connectionState/:i, /message/sendText/:i.
 */
export class EvolutionProvider implements WhatsappProvider {
  readonly name = 'evolution';
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    let res;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new WhatsappError('Não foi possível falar com o servidor de WhatsApp agora. Tente de novo em instantes.', 503);
    }
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (res.status === 401 || res.status === 403) {
      // 403 também é "nome de instância em uso" na criação; quem chama trata.
      const msg = JSON.stringify(json);
      if (/already in use/i.test(msg)) return { status: 409, json: json as T };
      throw new WhatsappError('Chave do servidor de WhatsApp inválida.', res.status);
    }
    if (!res.ok && res.status !== 404) {
      const r = json as { response?: { message?: unknown }; message?: unknown };
      const m = r.response?.message ?? r.message;
      throw new WhatsappError(`Servidor de WhatsApp: ${Array.isArray(m) ? m.join(' ') : String(m ?? res.status)}`, res.status);
    }
    return { status: res.status, json: json as T };
  }

  private enc(i: string) {
    return encodeURIComponent(i);
  }

  async connect(instance: string): Promise<WaConnect> {
    type Qr = { base64?: string; pairingCode?: string | null; code?: string };
    const created = await this.call<{ qrcode?: Qr }>('POST', '/instance/create', { instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    if (created.status < 300 && created.json.qrcode?.base64) {
      return { state: 'connecting', qr: created.json.qrcode.base64, pairingCode: created.json.qrcode.pairingCode ?? undefined };
    }
    // Já existe: pede um QR novo (ou descobre que já está conectada).
    const r = await this.call<Qr & { instance?: { state?: WaState }; error?: boolean; message?: string }>('GET', `/instance/connect/${this.enc(instance)}`);
    if (r.json.error) throw new WhatsappError(`Servidor de WhatsApp: ${r.json.message ?? 'erro ao gerar o QR Code'}`);
    if (r.json.instance?.state === 'open') return { state: 'open' };
    if (r.json.base64) return { state: 'connecting', qr: r.json.base64, pairingCode: r.json.pairingCode ?? undefined };
    return { state: (await this.state(instance)) ?? 'close' };
  }

  async state(instance: string): Promise<WaState | null> {
    const r = await this.call<{ instance?: { state?: WaState } }>('GET', `/instance/connectionState/${this.enc(instance)}`);
    if (r.status === 404) return null;
    return r.json.instance?.state ?? 'close';
  }

  async ownerPhone(instance: string): Promise<string | null> {
    const r = await this.call<{ ownerJid?: string; owner?: string }[]>('GET', `/instance/fetchInstances?instanceName=${this.enc(instance)}`);
    const jid = Array.isArray(r.json) ? (r.json[0]?.ownerJid ?? r.json[0]?.owner) : undefined;
    return jid ? jid.split('@')[0].replace(/\D/g, '') || null : null;
  }

  async sendText(instance: string, number: string, text: string) {
    const r = await this.call('POST', `/message/sendText/${this.enc(instance)}`, { number, text });
    if (r.status === 404) throw new WhatsappError('WhatsApp da loja não encontrado no servidor.', 404);
  }

  async remove(instance: string) {
    await this.call('DELETE', `/instance/logout/${this.enc(instance)}`).catch(() => undefined);
    await this.call('DELETE', `/instance/delete/${this.enc(instance)}`).catch(() => undefined);
  }
}

/**
 * WhatsApp de teste (WHATSAPP_FAKE_ENABLED=true): o QR "conecta" sozinho na primeira consulta
 * e as mensagens ficam guardadas em memória (os testes leem FakeWhatsapp.sent).
 */
export class FakeWhatsapp implements WhatsappProvider {
  readonly name = 'fake';
  static readonly instances = new Map<string, WaState>();
  static readonly sent: { instance: string; number: string; text: string }[] = [];
  /** Os testes ligam para simular a queda da conexão. */
  static failSend = false;

  // QR de mentira (PNG 1x1) só para a tela ter o que mostrar.
  private static readonly QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  async connect(instance: string): Promise<WaConnect> {
    if (FakeWhatsapp.instances.get(instance) === 'open') return { state: 'open' };
    FakeWhatsapp.instances.set(instance, 'connecting');
    return { state: 'connecting', qr: FakeWhatsapp.QR, pairingCode: 'TEST-1234' };
  }

  async state(instance: string) {
    const s = FakeWhatsapp.instances.get(instance);
    if (!s) return null;
    // Simula o dono lendo o QR Code.
    if (s === 'connecting') FakeWhatsapp.instances.set(instance, 'open');
    return FakeWhatsapp.instances.get(instance)!;
  }

  async ownerPhone() {
    return '5511999990000';
  }

  async sendText(instance: string, number: string, text: string) {
    if (FakeWhatsapp.failSend || FakeWhatsapp.instances.get(instance) !== 'open') throw new WhatsappError('WhatsApp desconectado.', 400);
    FakeWhatsapp.sent.push({ instance, number, text });
  }

  async remove(instance: string) {
    FakeWhatsapp.instances.delete(instance);
  }
}
