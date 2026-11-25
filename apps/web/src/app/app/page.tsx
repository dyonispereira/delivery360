'use client';

import Link from 'next/link';
import { MODULES, MODULE_CODES } from '@delivery360/shared';
import { useCurrentTenant } from './tenant-context';

export default function RestaurantHome() {
  const tenant = useCurrentTenant();
  const inactive = MODULE_CODES.filter((m) => !tenant.activeModules.includes(m));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Olá, {tenant.name}</h1>
        <p className="text-sm text-zinc-500">Os indicadores do dia aparecem aqui quando os módulos estiverem em uso.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {tenant.activeModules.map((m) => (
          <Link key={m} href={MODULES[m].path} className="card transition hover:border-[var(--brand)]">
            <div className="font-semibold">{MODULES[m].name}</div>
            <div className="text-sm text-zinc-500">{MODULES[m].description}</div>
          </Link>
        ))}
      </div>
      {inactive.length > 0 && (
        <div className="text-sm text-zinc-500">
          Não contratados: {inactive.map((m) => MODULES[m].name).join(', ')}. Fale com seu gestor de conta para ativar.
        </div>
      )}
    </div>
  );
}
