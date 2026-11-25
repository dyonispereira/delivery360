'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MODULES,
  TENANT_ROLES,
  TENANT_ROLE_LABELS,
  type PlanSummary,
  type TenantModuleState,
  type TenantRole,
  type TenantSummary,
} from '@delivery360/shared';
import { Badge, ErrorBox, STATUS_LABEL, STATUS_TONE, Spinner, Toggle } from '@/components/ui';
import { api, session } from '@/lib/api';
import { useSession } from '@/lib/session-context';

interface TenantDetail extends TenantSummary {
  phone: string | null;
  email: string | null;
  modules: TenantModuleState[];
  users: { id: string; name: string; email: string; active: boolean; role: TenantRole }[];
  accountManagers: { id: string; name: string; email: string }[];
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null);

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useSession();
  const router = useRouter();
  const isSuper = user?.staffRole === 'SUPER_ADMIN';
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTenant(await api<TenantDetail>(`/admin/tenants/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    api<PlanSummary[]>('/admin/plans').then(setPlans).catch(() => setPlans([]));
  }, [load]);

  async function run(fn: () => Promise<TenantDetail>) {
    setBusy(true);
    setError(null);
    try {
      setTenant(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  const toggleModule = (m: TenantModuleState, active: boolean) =>
    run(() => api(`/admin/tenants/${id}/modules/${m.code}`, { method: 'PUT', body: { active } }));
  const setPlan = (planId: string) => run(() => api(`/admin/tenants/${id}/plan`, { method: 'PUT', body: { planId } }));
  const setStatus = (status: string) => run(() => api(`/admin/tenants/${id}`, { method: 'PATCH', body: { status } }));
  const removeUser = (userId: string) => {
    if (!window.confirm('Remover o acesso deste usuário ao restaurante?')) return;
    void run(() => api(`/admin/tenants/${id}/users/${userId}`, { method: 'DELETE' }));
  };

  function enterAsClient() {
    session.setTenantId(id);
    router.push('/app');
  }

  if (!tenant) return error ? <ErrorBox message={error} /> : <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-800">← Restaurantes</Link>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tenant.name}</h1>
          <p className="text-sm text-zinc-500">
            {[tenant.legalName, tenant.cnpj && `CNPJ ${tenant.cnpj}`, tenant.phone, tenant.email].filter(Boolean).join(' · ') || 'Sem dados cadastrais'}
          </p>
        </div>
        <Badge tone={STATUS_TONE[tenant.status]}>{STATUS_LABEL[tenant.status]}</Badge>
        <button className="btn-primary ml-auto" onClick={enterAsClient}>Entrar como cliente</button>
      </div>

      <ErrorBox message={error} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">Plano e módulos</h2>
            <p className="text-sm text-zinc-500">
              Trocar o plano liga os módulos dele e desliga os demais. Desligar um módulo não apaga dados.
            </p>
          </div>
          <div>
            <label className="label">Plano</label>
            <select className="input" value={tenant.plan?.id ?? ''} disabled={!isSuper || busy} onChange={(e) => e.target.value && setPlan(e.target.value)}>
              <option value="" disabled>Sem plano</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <ul className="divide-y divide-zinc-100">
            {tenant.modules.map((m) => (
              <li key={m.code} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-zinc-500">{MODULES[m.code].description}</div>
                  {m.endsAt && <div className="text-xs text-amber-700">Termina em {fmtDate(m.endsAt)}</div>}
                </div>
                <Toggle checked={m.active} disabled={!isSuper || busy} onChange={(v) => toggleModule(m, v)} />
              </li>
            ))}
          </ul>
          {!isSuper && <p className="text-xs text-zinc-500">Só o super admin altera plano e módulos.</p>}
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">Usuários do restaurante</h2>
            <p className="text-sm text-zinc-500">Quem acessa o sistema deste restaurante.</p>
          </div>
          {tenant.users.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum usuário ainda. Cadastre o dono abaixo.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {tenant.users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{u.name}</div>
                    <div className="truncate text-xs text-zinc-500">{u.email}</div>
                  </div>
                  <Badge>{TENANT_ROLE_LABELS[u.role]}</Badge>
                  <button className="text-xs text-red-600 hover:underline" disabled={busy} onClick={() => removeUser(u.id)}>Remover</button>
                </li>
              ))}
            </ul>
          )}
          <AddUserForm tenantId={id} onDone={setTenant} />
        </section>

        {isSuper && (
          <section className="card space-y-3">
            <h2 className="font-semibold">Status do restaurante</h2>
            <p className="text-sm text-zinc-500">Suspenso ou cancelado: os usuários do restaurante perdem o acesso; a equipe continua entrando.</p>
            <div className="flex flex-wrap gap-2">
              {(['ACTIVE', 'SUSPENDED', 'CANCELLED'] as const).map((s) => (
                <button key={s} className={tenant.status === s ? 'btn-primary' : 'btn-ghost'} disabled={busy || tenant.status === s} onClick={() => setStatus(s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card space-y-2">
          <h2 className="font-semibold">Gestores de conta</h2>
          {tenant.accountManagers.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum gestor na carteira deste restaurante.</p>
          ) : (
            <ul className="text-sm">
              {tenant.accountManagers.map((a) => (
                <li key={a.id}>{a.name} <span className="text-zinc-500">({a.email})</span></li>
              ))}
            </ul>
          )}
          {isSuper && <AccountManagersEditor tenantId={id} current={tenant.accountManagers.map((a) => a.id)} onDone={setTenant} />}
        </section>
      </div>
    </div>
  );
}

function AddUserForm({ tenantId, onDone }: { tenantId: string; onDone: (t: TenantDetail) => void }) {
  const empty = { name: '', email: '', password: '', role: 'OWNER' as TenantRole };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, password: form.password || undefined };
      onDone(await api<TenantDetail>(`/admin/tenants/${tenantId}/users`, { method: 'POST', body }));
      setForm(empty);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2">
      <input className="input" placeholder="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className="input" type="email" placeholder="E-mail" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input className="input" type="password" placeholder="Senha (mín. 8; vazio se já tem conta)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TenantRole })}>
        {TENANT_ROLES.map((r) => (
          <option key={r} value={r}>{TENANT_ROLE_LABELS[r]}</option>
        ))}
      </select>
      <div className="space-y-2 sm:col-span-2">
        <ErrorBox message={error} />
        <button className="btn-ghost" disabled={busy}>{busy ? 'Salvando...' : 'Adicionar usuário'}</button>
      </div>
    </form>
  );
}

function AccountManagersEditor({ tenantId, current, onDone }: { tenantId: string; current: string[]; onDone: (t: TenantDetail) => void }) {
  const [staff, setStaff] = useState<{ id: string; name: string; staffRole: string }[]>([]);
  const [selected, setSelected] = useState<string[]>(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string; staffRole: string }[]>('/admin/staff')
      .then((s) => setStaff(s.filter((u) => u.staffRole === 'ACCOUNT_MANAGER')))
      .catch(() => setStaff([]));
  }, []);

  if (staff.length === 0) return <p className="text-xs text-zinc-500">Cadastre gestores de conta em Equipe para atribuí-los.</p>;

  async function save() {
    setError(null);
    try {
      onDone(await api<TenantDetail>(`/admin/tenants/${tenantId}/account-managers`, { method: 'PUT', body: { userIds: selected } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  }

  return (
    <div className="space-y-2 border-t border-zinc-100 pt-3">
      {staff.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
          {s.name}
        </label>
      ))}
      <ErrorBox message={error} />
      <button className="btn-ghost" onClick={save}>Salvar carteira</button>
    </div>
  );
}
