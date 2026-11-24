'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { MODULES, isModuleCode } from '@delivery360/shared';
import { ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';

/** Próximas entregas de cada módulo (do plano de desenvolvimento). */
const ROADMAP: Record<string, string> = {
  cardapio: 'Loja online, pagamento, painel de pedidos, impressão e cozinha: Sprints 1 a 3.',
  entregas: 'Motoboys, lotes de entrega e app do entregador: Sprints 4 e 5.',
  gestao: 'Funcionários, financeiro, folha, folgas e DRE: Sprints 6 a 9.',
  trafego: 'Campanhas, links UTM e retorno por pedido: Sprint 10.',
};

export default function ModulePage({ params }: { params: Promise<{ modulo: string }> }) {
  const { modulo } = use(params);
  const tenant = useCurrentTenant();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const known = isModuleCode(modulo);
  const active = known && tenant.activeModules.includes(modulo);

  useEffect(() => {
    if (!active) return;
    api(`/${modulo}/status`, { tenant: tenant.id })
      .then(() => setApiOk(true))
      .catch((e) => setError(e.message));
  }, [active, modulo, tenant.id]);

  if (!known) return <ErrorBox message="Página não encontrada." />;
  if (!active)
    return (
      <div className="card max-w-lg space-y-2">
        <h1 className="font-semibold">{MODULES[modulo].name}</h1>
        <p className="text-sm text-zinc-600">Este módulo não está contratado para {tenant.name}.</p>
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{MODULES[modulo].name}</h1>
      <div className="card max-w-xl space-y-2 text-sm">
        <p>{MODULES[modulo].description}</p>
        <p className="text-zinc-500">Em construção. {ROADMAP[modulo]}</p>
        {apiOk && <p className="text-emerald-700">Conexão com a API do módulo: ok.</p>}
        <ErrorBox message={error} />
      </div>
    </div>
  );
}
