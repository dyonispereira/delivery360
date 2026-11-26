'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { STAFF_ROLE_LABELS } from '@delivery360/shared';
import { Spinner } from '@/components/ui';
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
    { href: '/admin', label: 'Restaurantes', show: true },
    { href: '/admin/campanhas', label: 'Campanhas', show: true },
    { href: '/admin/equipe', label: 'Equipe', show: isSuper },
    { href: '/admin/auditoria', label: 'Auditoria', show: isSuper },
  ].filter((l) => l.show);
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/restaurantes') : pathname.startsWith(href));

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="text-lg font-bold">
            Delivery<span className="text-[var(--brand)]">360</span> <span className="text-sm font-normal text-zinc-500">admin</span>
          </Link>
          <nav className="flex gap-1">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 text-sm ${isActive(l.href) ? 'bg-zinc-100 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-600">
              {user.name} · {STAFF_ROLE_LABELS[user.staffRole]}
            </span>
            <button className="btn-ghost py-1" onClick={logout}>Sair</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
