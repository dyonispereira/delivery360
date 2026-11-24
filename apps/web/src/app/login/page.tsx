'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorBox } from '@/components/ui';
import { useSession } from '@/lib/session-context';

export default function LoginPage() {
  const { login } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      router.replace(user.staffRole ? '/admin' : '/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-bold">
            Delivery<span className="text-[var(--brand)]">360</span>
          </h1>
          <p className="text-sm text-zinc-500">Entre com seu e-mail e senha.</p>
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha</label>
          <input id="password" type="password" className="input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorBox message={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </main>
  );
}
