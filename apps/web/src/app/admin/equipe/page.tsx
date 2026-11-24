'use client';

import { useEffect, useState } from 'react';
import { STAFF_ROLE_LABELS, type StaffRole } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface Staff {
  id: string;
  name: string;
  email: string;
  staffRole: StaffRole;
  active: boolean;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', staffRole: 'ACCOUNT_MANAGER' as StaffRole });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Staff[]>('/admin/staff').then(setStaff).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/admin/staff', { method: 'POST', body: form });
      setForm({ name: '', email: '', password: '', staffRole: 'ACCOUNT_MANAGER' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Equipe</h1>
      <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input" placeholder="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" type="email" placeholder="E-mail" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input" type="password" placeholder="Senha (mín. 8)" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="input" value={form.staffRole} onChange={(e) => setForm({ ...form, staffRole: e.target.value as StaffRole })}>
          <option value="ACCOUNT_MANAGER">Gestor de conta</option>
          <option value="SUPER_ADMIN">Super admin</option>
        </select>
        <button className="btn-primary" disabled={busy}>Adicionar</button>
        <div className="sm:col-span-2 lg:col-span-5"><ErrorBox message={error} /></div>
      </form>
      {!staff ? (
        <Spinner />
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-zinc-100">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-zinc-500">{s.email}</div>
                </div>
                <Badge tone={s.staffRole === 'SUPER_ADMIN' ? 'amber' : 'zinc'}>{STAFF_ROLE_LABELS[s.staffRole]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
