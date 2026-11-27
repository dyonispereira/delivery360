'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface WaStatus {
  available: boolean;
  connected: boolean;
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED' | null;
  phone: string | null;
  notifyEnabled: boolean;
  connectedAt: string | null;
  qr?: string | null;
  pairingCode?: string | null;
}

const formatPhone = (p: string) => {
  const d = p.replace(/^55/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p;
};

const STEPS = [
  'Pedido aprovado',
  'Em preparo',
  'Aguardando entregador (ou pronto para retirar)',
  'Saiu para entrega',
  'Entregue, com o link para avaliar',
];

/** WhatsApp do próprio restaurante, conectado por QR Code, para avisar o cliente de cada etapa do pedido. */
export function WhatsappAccount({ canDisconnect }: { canDisconnect: boolean }) {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qr, setQr] = useState<{ image: string | null; code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  const load = useCallback(() => {
    api<WaStatus>('/cardapio/whatsapp', { tenant: true })
      .then((s) => {
        setStatus(s);
        if (s.connected) setQr(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Enquanto o QR está na tela, confere a cada 3 segundos se o celular já leu.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [qr, load]);

  async function run(fn: () => Promise<WaStatus>) {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      setStatus(s);
      setQr(s.connected ? null : s.qr || s.pairingCode ? { image: s.qr ?? null, code: s.pairingCode ?? null } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    try {
      await api('/cardapio/whatsapp/test', { method: 'POST', tenant: true });
      setTested(true);
      setTimeout(() => setTested(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="card max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h2 className="font-semibold">WhatsApp da loja (status do pedido)</h2>
          <p className="text-sm text-zinc-500">
            Conecte o WhatsApp do restaurante e o cliente recebe uma mensagem a cada etapa do pedido, saindo do número que ele já conhece.
          </p>
        </div>
        {status.connected ? (
          <Badge tone="green">Conectado</Badge>
        ) : status.status === 'DISCONNECTED' ? (
          <Badge tone="red">Desconectado</Badge>
        ) : (
          <Badge tone="amber">Não conectado</Badge>
        )}
      </div>

      <ul className="grid gap-1 text-sm text-zinc-600 sm:grid-cols-2">
        {STEPS.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className="text-emerald-600">✓</span> {s}
          </li>
        ))}
      </ul>

      {!status.available && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">O envio pelo WhatsApp ainda não está ligado neste servidor. Fale com a Delivery360.</p>
      )}

      {status.status === 'DISCONNECTED' && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          O WhatsApp foi desconectado (pelo celular ou por falta de internet). Os avisos estão parados: conecte de novo lendo o QR Code.
        </p>
      )}

      <ErrorBox message={error} />

      {status.connected && (
        <div className="space-y-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">Número conectado</dt>
              <dd className="font-medium">{status.phone ? formatPhone(status.phone) : '—'}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Avisos para o cliente</dt>
              <dd>
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={status.notifyEnabled}
                    disabled={busy}
                    onChange={(e) => void run(() => api<WaStatus>('/cardapio/whatsapp', { method: 'PUT', body: { notifyEnabled: e.target.checked }, tenant: true }))}
                  />
                  {status.notifyEnabled ? 'Ligados' : 'Desligados'}
                </label>
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={busy} onClick={() => void test()}>
              {tested ? 'Mensagem enviada! Confira o WhatsApp da loja' : 'Enviar mensagem de teste'}
            </button>
            {canDisconnect && (
              <button
                className="btn-ghost text-red-700"
                disabled={busy}
                onClick={() => void run(() => api<WaStatus>('/cardapio/whatsapp', { method: 'DELETE', tenant: true }))}
              >
                Desconectar
              </button>
            )}
          </div>
        </div>
      )}

      {!status.connected && status.available && !qr && (
        <button className="btn-primary" disabled={busy} onClick={() => void run(() => api<WaStatus>('/cardapio/whatsapp/connect', { method: 'POST', tenant: true }))}>
          {busy ? 'Gerando QR Code...' : status.status === 'DISCONNECTED' ? 'Conectar de novo' : 'Conectar WhatsApp'}
        </button>
      )}

      {qr && !status.connected && (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-start">
          {qr.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.image} alt="QR Code para conectar o WhatsApp" className="h-56 w-56 shrink-0 self-center rounded-lg border border-zinc-200 bg-white p-2" />
          )}
          <div className="space-y-2 text-sm text-zinc-600">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Abra o WhatsApp no celular da loja.</li>
              <li>
                Toque em <b>Configurações</b> (ou nos três pontinhos) &gt; <b>Aparelhos conectados</b> &gt; <b>Conectar um aparelho</b>.
              </li>
              <li>Aponte a câmera para o QR Code.</li>
            </ol>
            {qr.code && (
              <p>
                Sem câmera? Escolha <b>Conectar com número de telefone</b> e digite o código <span className="font-mono font-semibold">{qr.code}</span>.
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-[var(--brand)]" /> Esperando a leitura. O QR Code muda a cada minuto: se expirar, gere outro.
            </p>
            <button className="btn-ghost" disabled={busy} onClick={() => void run(() => api<WaStatus>('/cardapio/whatsapp/connect', { method: 'POST', tenant: true }))}>
              Gerar outro QR Code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
