'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorBox } from '@/components/ui';
import { BrandMark } from '@/components/icons';
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[image:var(--grad-night)] px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-500/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-red-600/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute right-1/4 top-10 h-40 w-40 rounded-full bg-yellow-400/15 blur-3xl" />
      <div className="relative w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center text-white animate-rise">
          <BrandMark className="h-14 w-14 rounded-2xl" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              Delivery<span className="text-fire">360</span>
            </h1>
            <p className="text-sm text-zinc-400">Seu restaurante inteiro, num lugar só.</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="card animate-rise space-y-4 rounded-3xl p-6" style={{ animationDelay: '120ms' }}>
          <div>
            <h2 className="text-lg font-bold">Entrar</h2>
            <p className="text-sm text-zinc-500">Use seu e-mail e senha.</p>
          </div>
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" className="input py-2.5" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Senha</label>
            <input id="password" type="password" className="input py-2.5" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <ErrorBox message={error} />
          <button className="btn-primary w-full py-3 text-base" disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </div>
    </main>
  );
}
