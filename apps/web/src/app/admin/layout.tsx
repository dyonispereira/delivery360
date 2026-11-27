'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { STAFF_ROLE_LABELS } from '@delivery360/shared';
import { Spinner } from '@/components/ui';
import { Icon, Wordmark, type IconName } from '@/components/icons';
import { useSession } from '@/lib/session-context';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (!user.staffRole) router.replace('/app');
  }, [user, loading, router]);

  if (loading || !user?.staffRole) return <Spinner />;

  const isSuper = user.staffRole === 'SUPER_ADMIN';
  const links = [
    { href: '/admin', label: 'Restaurantes', icon: 'store' as IconName, show: true },
    { href: '/admin/campanhas', label: 'Campanhas', icon: 'megaphone' as IconName, show: true },
    { href: '/admin/equipe', label: 'Equipe', icon: 'users' as IconName, show: isSuper },
    { href: '/admin/auditoria', label: 'Auditoria', icon: 'shield' as IconName, show: isSuper },
  ].filter((l) => l.show);
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/restaurantes') : pathname.startsWith(href));

  return (
    <div className="min-h-screen">
      <header className="relative overflow-hidden bg-[image:var(--grad-night)] text-zinc-300">
        <div aria-hidden className="pointer-events-none absolute -left-20 -top-32 h-72 w-72 rounded-full bg-orange-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-20 h-60 w-60 rounded-full bg-red-600/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <Wordmark dark />
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-orange-300">admin</span>
          </Link>
          <nav className="flex gap-1 overflow-x-auto">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition ${
                  isActive(l.href) ? 'bg-[image:var(--grad-ember)] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(229,37,42,0.8)]' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon name={l.icon} className="h-4 w-4" />
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right sm:block">
              <span className="block font-semibold text-white">{user.name}</span>
              <span className="block text-xs text-zinc-400">{STAFF_ROLE_LABELS[user.staffRole]}</span>
            </span>
            <button className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white" onClick={logout} title="Sair" aria-label="Sair">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
