'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SalaoTable } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

/** Cadastro das mesas (criar várias de uma vez, renomear, tirar da tela) e taxa de serviço. Dono e gerente. */
export function TablesSetup({ feeBps, onBack, onChanged }: { feeBps: number; onBack: () => void; onChanged: () => void }) {
  const [tables, setTables] = useState<SalaoTable[] | null>(null);
  const [count, setCount] = useState(10);
  const [name, setName] = useState('');
  const [fee, setFee] = useState(String(feeBps / 100).replace('.', ','));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTables((await api<{ tables: SalaoTable[] }>('/cardapio/salao/tables/all', { tenant: true })).tables);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    setSaved(null);
    try {
      await fn();
      if (ok) setSaved(ok);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = tables?.filter((t) => t.active) ?? [];
  const archived = tables?.filter((t) => !t.active) ?? [];

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost px-3" onClick={onBack} aria-label="Voltar">
          ←
        </button>
        <h1 className="text-xl font-bold">Mesas e taxa de serviço</h1>
      </div>
      <ErrorBox message={error} />
      {saved && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{saved}</p>}

      <section className="card mb-4 space-y-3">
        <h2 className="font-semibold">Criar mesas</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-28">
            <label className="label" htmlFor="count">Quantidade</label>
            <input id="count" className="input" inputMode="numeric" value={count} onChange={(e) => setCount(Math.min(200, Number(e.target.value.replace(/\D/g, '')) || 0))} />
          </div>
          <button className="btn-primary" disabled={count < 1} onClick={() => void run(() => api('/cardapio/salao/tables/bulk', { method: 'POST', tenant: true, body: { count } }), `Mesas 1 a ${count} prontas.`)}>
            Criar Mesa 1 a {count || '...'}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="table-name">Ou uma com nome próprio</label>
            <input id="table-name" className="input" placeholder="Ex.: Varanda 1, Balcão" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </div>
          <button
            className="btn-ghost"
            disabled={!name.trim()}
            onClick={() => void run(async () => {
              await api('/cardapio/salao/tables', { method: 'POST', tenant: true, body: { name: name.trim() } });
              setName('');
            })}
          >
            Adicionar
          </button>
        </div>
      </section>

      <section className="card mb-4">
        <h2 className="mb-2 font-semibold">Taxa de serviço</h2>
        <p className="mb-3 text-sm text-zinc-500">Sugerida no fechamento da conta; o cliente pode recusar. Vai para a equipe, fora do resultado da loja. Use 0 para não cobrar.</p>
        <div className="flex items-end gap-2">
          <div className="w-28">
            <label className="label" htmlFor="fee">Percentual</label>
            <input id="fee" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d,.]/g, ''))} />
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              const pct = Number(fee.replace(',', '.'));
              if (!Number.isFinite(pct) || pct < 0 || pct > 20) return setError('Informe um percentual entre 0 e 20.');
              void run(() => api('/cardapio/salao/service-fee', { method: 'PUT', tenant: true, body: { serviceFeeBps: Math.round(pct * 100) } }), 'Taxa de serviço salva.');
            }}
          >
            Salvar
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-2 font-semibold">Mesas ({active.length})</h2>
        {!tables ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {active.map((t) => (
              <TableRow key={t.id} table={t} onRename={(n) => void run(() => api(`/cardapio/salao/tables/${t.id}`, { method: 'PATCH', tenant: true, body: { name: n } }))} onRemove={() => void run(() => api(`/cardapio/salao/tables/${t.id}`, { method: 'DELETE', tenant: true }), `${t.name} removida.`)} />
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <p className="mb-2 text-sm text-zinc-500">Fora da tela (têm contas antigas no histórico)</p>
            <div className="flex flex-wrap gap-2">
              {archived.map((t) => (
                <button key={t.id} className="btn-ghost py-1 text-xs" onClick={() => void run(() => api(`/cardapio/salao/tables/${t.id}`, { method: 'PATCH', tenant: true, body: { active: true } }))}>
                  Voltar {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function TableRow({ table, onRename, onRemove }: { table: SalaoTable; onRename: (name: string) => void; onRemove: () => void }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(table.name);
  return (
    <li className="flex items-center gap-2 py-2">
      {edit ? (
        <>
          <input className="input flex-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Nome da mesa" />
          <button
            className="btn-primary py-1.5"
            disabled={!name.trim()}
            onClick={() => {
              onRename(name.trim());
              setEdit(false);
            }}
          >
            Salvar
          </button>
        </>
      ) : (
        <>
          <span className="flex-1 font-medium">{table.name}</span>
          {table.tab && <span className="text-xs text-orange-700">conta aberta</span>}
          <button className="btn-ghost py-1.5 text-xs" onClick={() => setEdit(true)}>
            Renomear
          </button>
          <button className="btn-ghost py-1.5 text-xs text-red-600" disabled={!!table.tab} onClick={onRemove}>
            Remover
          </button>
        </>
      )}
    </li>
  );
}
