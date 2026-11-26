'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ErrorBox } from '@/components/ui';
import { useCurrentTenant } from '../tenant-context';
import { MenuEditor } from './menu-editor';
import { StoreSettings } from './store-settings';
import { ZonesEditor } from './zones-editor';
import { ChannelsEditor } from './channels';
import { CouponsEditor } from './coupons-editor';

const TABS = [
  { id: 'menu', label: 'Cardápio' },
  { id: 'loja', label: 'Loja online' },
  { id: 'cupons', label: 'Cupons' },
  { id: 'bairros', label: 'Bairros e taxas' },
  { id: 'canais', label: 'Canais de venda' },
] as const;

export default function CardapioPage() {
  const tenant = useCurrentTenant();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('menu');

  if (!tenant.activeModules.includes('cardapio')) {
    return (
      <div className="card max-w-lg space-y-2">
        <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );
  }

  const canEdit = tenant.role === null || tenant.role === 'OWNER' || tenant.role === 'MANAGER';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Cardápio e loja</h1>
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1">
          {TABS.filter((t) => t.id !== 'canais' || canEdit).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${tab === t.id ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'menu' && <MenuEditor canEdit={canEdit} />}
      {tab === 'loja' && <StoreSettings canEdit={canEdit} />}
      {tab === 'cupons' && <CouponsEditor canEdit={canEdit} />}
      {tab === 'bairros' && <ZonesEditor canEdit={canEdit} />}
      {tab === 'canais' && canEdit && <ChannelsEditor />}
    </div>
  );
}
