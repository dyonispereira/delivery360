'use client';

import { useEffect, useState } from 'react';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface AccountStatus {
  connected: boolean;
  provider: string | null;
  sandbox: boolean;
  apiKeyLast4: string | null;
  accountName: string | null;
  webhookActive: boolean;
  connectedAt: string | null;
  testPixAvailable: boolean;
  webhookUrlConfigured: boolean;
}

/**
 * Pix e cartão pelo site com a conta Asaas do próprio restaurante: o dinheiro cai direto nela.
 * Só o dono conecta (a chave da API dá acesso à conta dele).
 */
export function PaymentAccount({ canConnect }: { canConnect: boolean }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AccountStatus>('/cardapio/payments/account', { tenant: true })
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  async function run(fn: () => Promise<AccountStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
      setEditing(false);
      setApiKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return error ? <ErrorBox message={error} /> : <Spinner />;
  const showForm = canConnect && (!status.connected || editing);

  return (
    <div className="card max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h2 className="font-semibold">Pagamento online (Pix e cartão)</h2>
          <p className="text-sm text-zinc-500">
            O cliente paga o Pix pelo QR Code ou copia e cola, ou digita o cartão de crédito na própria loja (checkout transparente, sem sair do site). O pedido entra sozinho quando o pagamento
            é confirmado. O dinheiro cai direto na sua conta Asaas, e a taxa do Asaas entra no financeiro em 2.3. Para oferecer cartão, marque também
            &quot;Cartão de crédito (online)&quot; nas formas de pagamento da loja.
          </p>
        </div>
        {status.connected ? (
          <Badge tone="green">Conectado{status.sandbox ? ' (sandbox)' : ''}</Badge>
        ) : (
          <Badge tone="amber">Não conectado</Badge>
        )}
      </div>

      {status.connected && (
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-zinc-500">Conta Asaas</dt>
            <dd className="font-medium">{status.accountName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Chave da API</dt>
            <dd className="font-mono">•••• {status.apiKeyLast4}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Aviso de pagamento</dt>
            <dd className="font-medium">{status.webhookActive ? 'Ativo' : 'Inativo'}</dd>
          </div>
        </dl>
      )}

      {!status.connected && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {status.testPixAvailable
            ? 'Sem conta conectada, a loja usa um Pix de teste, que não recebe dinheiro de verdade.'
            : 'Sem conta conectada, a loja não oferece Pix nem cartão pelo site, só pagamento na entrega.'}
        </p>
      )}

      {!status.webhookUrlConfigured && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">O endereço público da API não está configurado. Fale com a Delivery360 antes de conectar.</p>
      )}

      <ErrorBox message={error} />

      {showForm && (
        <form
          className="space-y-3 rounded-xl border border-zinc-200 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim().length < 20) return setError('Cole a chave da API do Asaas.');
            void run(() => api<AccountStatus>('/cardapio/payments/account/asaas', { method: 'PUT', body: { apiKey: apiKey.trim(), sandbox }, tenant: true }));
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600">
            <li>Entre na sua conta Asaas e cadastre uma chave Pix (Pix &gt; Minhas chaves).</li>
            <li>Vá em Integrações &gt; Chaves de API e gere uma chave.</li>
            <li>Cole a chave aqui. A gente confere com o Asaas e liga o aviso de pagamento sozinho.</li>
          </ol>
          <label className="block text-sm">
            Chave da API do Asaas
            <input
              className="input mt-1 font-mono"
              type="password"
              autoComplete="off"
              placeholder="$aact_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
            É uma chave de teste (sandbox do Asaas)
          </label>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Conferindo com o Asaas...' : status.connected ? 'Trocar chave' : 'Conectar Asaas'}
            </button>
            {editing && (
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">A chave fica guardada cifrada e não aparece de novo, nem para a equipe Delivery360.</p>
        </form>
      )}

      {status.connected && canConnect && !editing && (
        <div className="flex gap-4 text-sm">
          <button className="text-[var(--brand)]" onClick={() => setEditing(true)}>
            Trocar chave
          </button>
          <button
            className="text-red-600"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Desconectar o Asaas? A loja deixa de receber Pix e cartão pelo site até você conectar de novo.')) {
                void run(() => api<AccountStatus>('/cardapio/payments/account', { method: 'DELETE', tenant: true }));
              }
            }}
          >
            Desconectar
          </button>
        </div>
      )}
      {!canConnect && <p className="text-xs text-zinc-500">Só o dono da loja conecta ou troca a conta de pagamento.</p>}
    </div>
  );
}
