'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { AccountGroup } from './shared';

export function Accounts() {
  const [groups, setGroups] = useState<AccountGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ group: number; name: string } | null>(null);

  const load = useCallback(() => api<AccountGroup[]>('/gestao/accounts', { tenant: true }).then(setGroups).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!groups) return error ? <ErrorBox message={error} /> : <Spinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Plano de contas pensado para restaurante. As contas padrão podem ser renomeadas; contas novas podem ser criadas em qualquer grupo.
      </p>
      <ErrorBox message={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.group} className="card space-y-2">
            <header className="flex items-center justify-between">
              <h2 className="font-semibold">
                {g.group}. {g.name}
              </h2>
              {g.kind === 'OFF_DRE' && <span className="text-xs text-zinc-500">fora da DRE</span>}
            </header>
            <ul className="divide-y divide-zinc-100 text-sm">
              {g.accounts.map((a) => (
                <li key={a.id} className={`flex items-center gap-2 py-1.5 ${a.active ? '' : 'text-zinc-400'}`}>
                  <span className="w-10 font-mono text-xs text-zinc-500">{a.code}</span>
                  <span className="flex-1">{a.name}</span>
                  <button
                    className="text-xs text-zinc-500 underline"
                    onClick={() => {
                      const name = window.prompt('Novo nome da conta:', a.name);
                      if (name && name.trim() !== a.name) void act(() => api(`/gestao/accounts/${a.id}`, { method: 'PATCH', tenant: true, body: { name } }));
                    }}
                  >
                    renomear
                  </button>
                  {!a.system && <Toggle checked={a.active} onChange={(v) => void act(() => api(`/gestao/accounts/${a.id}`, { method: 'PATCH', tenant: true, body: { active: v } }))} />}
                </li>
              ))}
            </ul>
            {adding?.group === g.group ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await api('/gestao/accounts', { method: 'POST', tenant: true, body: adding });
                    setAdding(null);
                  });
                }}
              >
                <input className="input py-1" autoFocus required minLength={2} placeholder="Nome da conta" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                <button className="btn-primary py-1">Criar</button>
                <button type="button" className="btn-ghost py-1" onClick={() => setAdding(null)}>✕</button>
              </form>
            ) : (
              <button className="text-sm text-[var(--brand)] underline" onClick={() => setAdding({ group: g.group, name: '' })}>+ Nova conta neste grupo</button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
