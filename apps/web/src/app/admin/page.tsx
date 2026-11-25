'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MODULES, type PlanSummary, type TenantSummary } from '@delivery360/shared';
import { Badge, ErrorBox, STATUS_LABEL, STATUS_TONE, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session-context';

export default function TenantsPage() {
  const { user } = useSession();
  const isSuper = user?.staffRole === 'SUPER_ADMIN';
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (search: string) => {
    try {
      setTenants(await api<TenantSummary[]>(`/admin/tenants${search ? `?q=${encodeURIComponent(search)}` : ''}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  useEffect(() => {
    api<PlanSummary[]>('/admin/plans').then(setPlans).catch(() => setPlans([]));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Restaurantes</h1>
        <input className="input max-w-xs" placeholder="Buscar por nome ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} />
        {isSuper && (
          <button className="btn-primary ml-auto" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Fechar' : 'Novo restaurante'}
          </button>
        )}
      </div>

      {showForm && (
        <NewTenantForm
          plans={plans}
          onCreated={() => {
            setShowForm(false);
            void load(q);
          }}
        />
      )}

      <ErrorBox message={error} />
      {!tenants ? (
        <Spinner />
      ) : tenants.length === 0 ? (
        <div className="card text-sm text-zinc-500">
          {isSuper ? 'Nenhum restaurante cadastrado ainda.' : 'Nenhum restaurante na sua carteira.'}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
              <tr>
                <th className="px-4 py-2 font-medium">Restaurante</th>
                <th className="px-4 py-2 font-medium">Plano</th>
                <th className="px-4 py-2 font-medium">Módulos ativos</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/restaurantes/${t.id}`} className="font-medium text-zinc-900 hover:text-[var(--brand)]">
                      {t.name}
                    </Link>
                    {t.cnpj && <div className="text-xs text-zinc-500">CNPJ {t.cnpj}</div>}
                  </td>
                  <td className="px-4 py-3">{t.plan?.name ?? <span className="text-zinc-400">Sem plano</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.activeModules.length === 0 ? <span className="text-zinc-400">Nenhum</span> : t.activeModules.map((m) => <Badge key={m}>{MODULES[m].name}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewTenantForm({ plans, onCreated }: { plans: PlanSummary[]; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', legalName: '', cnpj: '', phone: '', email: '', planId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(
      Object.entries({ ...form, cnpj: form.cnpj.replace(/\D/g, '') }).filter(([, v]) => v.trim() !== ''),
    );
    try {
      await api('/admin/tenants', { method: 'POST', body });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label">Nome do restaurante *</label>
        <input className="input" required value={form.name} onChange={set('name')} />
      </div>
      <div>
        <label className="label">Razão social</label>
        <input className="input" value={form.legalName} onChange={set('legalName')} />
      </div>
      <div>
        <label className="label">CNPJ</label>
        <input className="input" inputMode="numeric" placeholder="Somente números" value={form.cnpj} onChange={set('cnpj')} />
      </div>
      <div>
        <label className="label">Telefone</label>
        <input className="input" value={form.phone} onChange={set('phone')} />
      </div>
      <div>
        <label className="label">E-mail</label>
        <input className="input" type="email" value={form.email} onChange={set('email')} />
      </div>
      <div>
        <label className="label">Plano</label>
        <select className="input" value={form.planId} onChange={set('planId')}>
          <option value="">Sem plano (ligar módulos depois)</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.modules.map((m) => MODULES[m].name).join(', ')})
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2 space-y-3">
        <ErrorBox message={error} />
        <button className="btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Cadastrar restaurante'}</button>
      </div>
    </form>
  );
}
