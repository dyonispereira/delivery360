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

  const active = tenants?.filter((t) => t.status === 'ACTIVE').length ?? 0;
  const modulesOn = tenants?.reduce((n, t) => n + t.activeModules.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-[image:var(--grad-fire)] p-6 text-white shadow-[0_24px_60px_-28px_rgba(229,37,42,0.6)] sm:p-8">
        <div aria-hidden className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/15 blur-2xl" />
        <div aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-black/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="animate-slide-in">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">Carteira Delivery360</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Restaurantes</h1>
            <p className="mt-1 max-w-md text-sm text-white/85">Ative módulos, acompanhe o plano e entre no sistema de cada cliente.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              ['Clientes', tenants?.length ?? '–'],
              ['Ativos', tenants ? active : '–'],
              ['Módulos ligados', tenants ? modulesOn : '–'],
            ].map(([label, value], k) => (
              <div key={label} className="animate-rise rounded-2xl bg-black/20 px-4 py-3 backdrop-blur" style={{ animationDelay: `${k * 80}ms` }}>
                <div className="text-2xl font-black">{value}</div>
                <div className="text-[11px] font-medium text-white/80">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Buscar por nome ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} />
        {isSuper && (
          <button className="btn-primary ml-auto rounded-full px-5" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Fechar' : '+ Novo restaurante'}
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
            <thead className="border-b border-zinc-100 bg-zinc-50/70 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Restaurante</th>
                <th className="px-4 py-3 font-semibold">Plano</th>
                <th className="px-4 py-3 font-semibold">Módulos ativos</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 transition last:border-0 hover:bg-orange-50/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/restaurantes/${t.id}`} className="group flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[image:var(--grad-fire)] text-sm font-black text-white shadow-sm">
                        {t.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-semibold text-zinc-900 group-hover:text-[var(--brand)]">{t.name}</span>
                        {t.cnpj && <span className="block text-xs text-zinc-500">CNPJ {t.cnpj}</span>}
                      </span>
                    </Link>
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
