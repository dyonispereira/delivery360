'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import { useSession } from '@/lib/session-context';

/** Página inicial: manda a equipe para o admin e o restaurante para o sistema. */
export default function Home() {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else router.replace(user.staffRole ? '/admin' : '/app');
  }, [user, loading, router]);

  return <Spinner />;
}
