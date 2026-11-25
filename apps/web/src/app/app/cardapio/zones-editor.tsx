'use client';

import { useEffect, useState } from 'react';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Zone } from './types';

export function ZonesEditor({ canEdit }: { canEdit: boolean }) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Zone[]>('/cardapio/zones', { tenant: true }).then(setZones).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const feeCents = parseBRL(fee || '0');
    if (feeCents === null) return setError('Taxa inválida.');
    await run(() => api('/cardapio/zones', { method: 'POST', body: { name, feeCents }, tenant: true }));
    setName('');
    setFee('');
  }

  if (!zones) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="card max-w-2xl space-y-4">
      <p className="text-sm text-zinc-500">O cliente escolhe o bairro no checkout e a taxa entra no pedido. Bairro desligado não aparece.</p>
      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="Bairro" required value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input w-32" placeholder="Taxa (R$)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          <button className="btn-primary">Adicionar</button>
        </form>
      )}
      <ErrorBox message={error} />
      {zones.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum bairro cadastrado. Sem bairro, a loja só aceita retirada.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 font-medium">{z.name}</span>
              <span className="text-zinc-600">{formatBRL(z.feeCents)}</span>
              <Toggle checked={z.active} disabled={!canEdit} onChange={(v) => run(() => api(`/cardapio/zones/${z.id}`, { method: 'PATCH', body: { active: v }, tenant: true }))} />
              {canEdit && (
                <button className="text-xs text-red-600 hover:underline" onClick={() => window.confirm(`Apagar ${z.name}?`) && run(() => api(`/cardapio/zones/${z.id}`, { method: 'DELETE', tenant: true }))}>
                  Apagar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
