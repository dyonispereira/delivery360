'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MODULES, TENANT_ROLE_LABELS } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { Icon, Wordmark, type IconName } from '@/components/icons';
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

  const ICONS: Record<string, IconName> = {
    '/app': 'home',
    '/app/pedidos': 'orders',
    '/app/cozinha': 'kitchen',
    '/app/salao': 'table',
    '/app/gestao': 'wallet',
    '/app/cardapio': 'menu',
    '/app/entregas': 'bike',
    '/app/trafego': 'megaphone',
  };
  const nav = [
    { href: '/app', label: 'Início' },
    // Operação do dia a dia primeiro: painel e cozinha fazem parte do módulo Cardápio.
    ...(tenant.activeModules.includes('cardapio')
      ? [
          { href: '/app/pedidos', label: 'Painel de pedidos' },
          { href: '/app/cozinha', label: 'Cozinha' },
          { href: '/app/salao', label: 'Salão (garçom)' },
        ]
      : []),
    // Financeiro (Gestão) é só do dono e do gerente.
    ...tenant.activeModules
      .filter((m) => m !== 'gestao' || tenant.role !== 'STAFF')
      .map((m) => ({ href: MODULES[m].path, label: MODULES[m].name })),
  ];
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <TenantCtx.Provider value={tenant}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="relative overflow-hidden bg-[image:var(--grad-night)] text-zinc-300 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0">
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-orange-500/25 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 hidden h-72 w-72 rounded-full bg-red-600/20 blur-3xl md:block" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 p-4 md:block md:p-5">
              <Link href="/app">
                <Wordmark dark />
              </Link>
              {user.tenants.length > 1 ? (
                <select
                  className="mt-0 w-44 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none md:mt-4 md:w-full [&>option]:text-zinc-900"
                  value={tenant.id}
                  onChange={(e) => switchTenant(e.target.value)}
                >
                  {user.tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              ) : (
                <div className="truncate rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white md:mt-4">{tenant.name}</div>
              )}
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-1.5 md:pb-4">
              {nav.map((n) => {
                const active = n.href === '/app' ? pathname === '/app' : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`group flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition ${
                      active
                        ? 'bg-[image:var(--grad-ember)] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(229,37,42,0.8)]'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon name={ICONS[n.href] ?? 'spark'} className={`h-5 w-5 ${active ? '' : 'text-zinc-500 group-hover:text-orange-300'}`} />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="hidden p-4 md:block">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[image:var(--grad-fire)] text-sm font-bold text-zinc-900">{initials}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{user.name}</div>
                    <div className="text-xs text-zinc-400">{tenant.role ? TENANT_ROLE_LABELS[tenant.role] : 'Equipe Delivery360'}</div>
                  </div>
                  <button className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white" onClick={logout} title="Sair" aria-label="Sair">
                    <Icon name="logout" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          {user.staffRole && (
            <div className="flex flex-wrap items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
              Você está dentro de <strong>{tenant.name}</strong> como equipe. Suas alterações ficam registradas na auditoria.
              <Link href="/admin" className="ml-auto font-semibold underline">Voltar ao admin</Link>
            </div>
          )}
          <header className="flex items-center gap-3 border-b border-zinc-200/70 bg-white/70 px-4 py-3 text-sm backdrop-blur md:hidden">
            <span className="text-zinc-600">
              {user.name}
              {tenant.role && ` · ${TENANT_ROLE_LABELS[tenant.role]}`}
            </span>
            <button className="btn-ghost ml-auto py-1" onClick={logout}>Sair</button>
          </header>
          <main className="p-4 md:p-8">{children}</main>
        </div>
      </div>
    </TenantCtx.Provider>
  );
}
