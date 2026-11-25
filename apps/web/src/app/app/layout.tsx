'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MODULES, TENANT_ROLE_LABELS } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api, session } from '@/lib/api';
import { useSession } from '@/lib/session-context';
import { CurrentTenant, TenantCtx } from './tenant-context';

/** Sistema do restaurante: o menu é montado só com os módulos ativos do restaurante. */
export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [tenant, setTenant] = useState<CurrentTenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTenant = useCallback(async (tenantId: string) => {
    setError(null);
    try {
      setTenant(await api<CurrentTenant>('/tenant/context', { tenant: tenantId }));
    } catch (err) {
      setTenant(null);
      setError(err instanceof Error ? err.message : 'Erro ao carregar o restaurante.');
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const stored = session.getTenantId();
    const tenantId = stored ?? user.tenants[0]?.id;
    if (!tenantId) {
      if (user.staffRole) router.replace('/admin');
      else setError('Seu usuário ainda não está vinculado a nenhum restaurante.');
      return;
    }
    session.setTenantId(tenantId);
    void loadTenant(tenantId);
  }, [user, loading, router, loadTenant]);

  function switchTenant(id: string) {
    session.setTenantId(id);
    void loadTenant(id);
    router.push('/app');
  }

  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <ErrorBox message={error} />
        <button className="btn-ghost" onClick={user?.staffRole ? () => router.push('/admin') : logout}>
          {user?.staffRole ? 'Voltar ao admin' : 'Sair'}
        </button>
      </div>
    );
  if (!tenant || !user) return <Spinner />;

  const nav = [
    { href: '/app', label: 'Início' },
    // Operação do dia a dia primeiro: painel e cozinha fazem parte do módulo Cardápio.
    ...(tenant.activeModules.includes('cardapio')
      ? [
          { href: '/app/pedidos', label: 'Painel de pedidos' },
          { href: '/app/cozinha', label: 'Cozinha' },
        ]
      : []),
    ...tenant.activeModules.map((m) => ({ href: MODULES[m].path, label: MODULES[m].name })),
  ];

  return (
    <TenantCtx.Provider value={tenant}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="border-b border-zinc-200 bg-white md:w-60 md:border-b-0 md:border-r">
          <div className="p-4">
            <div className="text-lg font-bold">
              Delivery<span className="text-[var(--brand)]">360</span>
            </div>
            {user.tenants.length > 1 ? (
              <select className="input mt-2" value={tenant.id} onChange={(e) => switchTenant(e.target.value)}>
                {user.tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            ) : (
              <div className="mt-1 text-sm text-zinc-600">{tenant.name}</div>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
            {nav.map((n) => {
              const active = n.href === '/app' ? pathname === '/app' : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active ? 'bg-zinc-100 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="flex-1">
          {user.staffRole && (
            <div className="flex flex-wrap items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Você está dentro de <strong>{tenant.name}</strong> como equipe. Suas alterações ficam registradas na auditoria.
              <Link href="/admin" className="ml-auto underline">Voltar ao admin</Link>
            </div>
          )}
          <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 text-sm">
            <span className="text-zinc-600">
              {user.name}
              {tenant.role && ` · ${TENANT_ROLE_LABELS[tenant.role]}`}
            </span>
            <button className="btn-ghost ml-auto py-1" onClick={logout}>Sair</button>
          </header>
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TenantCtx.Provider>
  );
}
