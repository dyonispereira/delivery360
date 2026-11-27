import { randomInt } from 'node:crypto';
import { accessKey, consultUrl, qrCodeUrl } from './nfce';

export interface EmitRequest {
  ref: string;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  uf: string;
  cnpj: string;
  series: number;
  number: number;
  issuedAt: Date;
  cscId: string;
  csc: string;
  body: Record<string, unknown>;
}

export interface EmitResult {
  status: 'AUTHORIZED' | 'REJECTED' | 'PROCESSING';
  accessKey?: string;
  protocol?: string;
  qrCodeUrl?: string;
  consultUrl?: string;
  message?: string;
  authorizedAt?: Date;
}

/**
 * Emissor de NFC-e (o serviço que assina com o certificado A1 e fala com a SEFAZ).
 * Para ligar um emissor real (Focus NFe, Nuvem Fiscal, PlugNotas...) basta outra classe com esta interface.
 */
export interface NfceProvider {
  readonly name: string;
  emit(req: EmitRequest): Promise<EmitResult>;
  cancel(req: { ref: string; accessKey: string; reason: string }): Promise<{ ok: boolean; protocol?: string; message?: string }>;
}

/**
 * Emissor simulado: autoriza na hora, com chave de acesso e QR Code no formato oficial, mas sem mandar nada à SEFAZ.
 * Serve para o restaurante testar o PDV e o cupom antes de contratar o emissor.
 */
export class SimulatedNfceProvider implements NfceProvider {
  readonly name = 'simulado';

  async emit(req: EmitRequest): Promise<EmitResult> {
    const key = accessKey({ uf: req.uf, issuedAt: req.issuedAt, cnpj: req.cnpj, series: req.series, number: req.number, code: randomInt(1, 99_999_999) });
    return {
      status: 'AUTHORIZED',
      accessKey: key,
      protocol: `${key.slice(0, 2)}${Date.now().toString().slice(-13)}`,
      qrCodeUrl: qrCodeUrl({ key, environment: req.environment, cscId: req.cscId, csc: req.csc || 'SIMULADO', uf: req.uf }),
      consultUrl: consultUrl(req.uf, req.environment),
      message: 'Autorizado o uso da NFC-e (simulado, sem envio à SEFAZ)',
      authorizedAt: new Date(),
    };
  }

  async cancel() {
    return { ok: true, protocol: `CANC${Date.now().toString().slice(-11)}`, message: 'Cancelamento homologado (simulado)' };
  }
}

export function providerFor(name: string): NfceProvider {
  switch (name) {
    case 'simulado':
    default:
      return new SimulatedNfceProvider();
  }
}
