'use client';

import { useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { api, session } from '@/lib/api';

type Preview = {
  token: string;
  rows: {
    externalId: string;
    kind: string;
    name: string;
    action: string;
    currentPrice?: number;
    price?: number;
  }[];
};

const path = '/cardapio/canais/ifood/cardapio';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function IfoodCatalogImport() {
  const [revised, setRevised] = useState(false);
  const [preview, setPreview] = useState<(Preview & { tenant: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  async function generatePreview() {
    const tenant = session.getTenantId();
    if (!tenant) return;
    setBusy(true);
    setPreview(null);
    setError('');
    setResult('');
    try {
      const data = await api<Preview>(path + '/previa', { method: 'POST', tenant, body: { revised } });
      if (tenant === session.getTenantId()) setPreview({ ...data, tenant });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || preview.tenant !== session.getTenantId()) {
      setPreview(null);
      setError('O restaurante mudou. Gere uma nova prévia.');
      return;
    }
    setBusy(true);
    setError('');
    setResult('');
    try {
      const response = await api<{ affected: number }>(path + '/confirmar', {
        method: 'POST', tenant: preview.tenant, body: { revised, token: preview.token },
      });
      setResult(response.affected ? `Importação concluída. ${response.affected} registro(s) aplicado(s).` : 'O cardápio já está atualizado.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreview(null);
      setBusy(false);
    }
  }

  const hasChanges = preview?.rows.some((row) => row.action !== 'Ignorar');
  const changesPrice = preview?.rows.some((row) => row.action === 'Atualizar preço');

  return (
    <section className="card max-w-3xl space-y-3">
      <h2 className="font-semibold">Importar cardápio do iFood</h2>
      <p className="text-sm text-zinc-600">Demonstração com dados simulados. Ao confirmar, os itens de demonstração são gravados no cardápio deste restaurante.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={revised} disabled={busy} onChange={(e) => {
            setRevised(e.target.checked);
            setPreview(null);
            setResult('');
            setError('');
          }} />
          Simular nova tabela de preços
        </label>
        <button type="button" className="btn-ghost" disabled={busy} onClick={generatePreview}>Gerar prévia</button>
      </div>
      {error && <ErrorBox message={error} />}
      {result && <p role="status" className="text-sm text-emerald-700">{result}</p>}
      {preview && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th>Item</th><th>Ação</th><th>Preço aplicado</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.kind + row.externalId} className="border-t border-zinc-100">
                    <td className="py-2">{row.kind} · {row.name}</td>
                    <td className="py-2">{row.action}</td>
                    <td className="py-2">
                      {row.currentPrice !== undefined && row.currentPrice !== row.price && (
                        <span className="mr-2 line-through">{brl.format(row.currentPrice / 100)}</span>
                      )}
                      {row.price === undefined ? '—' : brl.format(row.price / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasChanges ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={confirm}>
              {changesPrice ? 'Confirmar importação e novo preço do iFood' : 'Confirmar importação'}
            </button>
          ) : <p className="text-sm text-zinc-600">Nenhuma alteração para aplicar.</p>}
        </>
      )}
    </section>
  );
}
