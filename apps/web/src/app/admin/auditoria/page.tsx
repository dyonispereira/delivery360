'use client';

import { useEffect, useState } from 'react';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface Log {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  'tenant.create': 'Cadastrou restaurante',
  'tenant.update': 'Alterou restaurante',
  'tenant.set_plan': 'Trocou plano',
  'tenant.set_module': 'Ligou/desligou módulo',
  'tenant.set_account_managers': 'Alterou gestores de conta',
  'membership.create': 'Deu acesso a usuário',
  'membership.delete': 'Removeu acesso de usuário',
  'staff.create': 'Cadastrou membro da equipe',
};

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Log[]>('/admin/audit-logs?take=200').then(setLogs).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Auditoria</h1>
      <ErrorBox message={error} />
      {!logs ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-2 font-medium">Quando</th>
                <th className="px-4 py-2 font-medium">Quem</th>
                <th className="px-4 py-2 font-medium">O quê</th>
                <th className="px-4 py-2 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-2">{l.user?.name ?? 'Sistema'}</td>
                  <td className="px-4 py-2">{ACTION_LABEL[l.action] ?? l.action}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">{l.entity}{l.entityId ? ` · ${l.entityId}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
