'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, type CashSessionView, type ReceiptKind } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';
import { CashPanel, OpenCash } from './cash';
import { SalesList } from './sales';
import { SellView } from './sell';
import { PdvSettings } from './settings';
import { TotemSettings } from './totems';

export interface PdvState {
  session: CashSessionView | null;
  nfce: { available: boolean; defaultReceipt: ReceiptKind; environment: string };
}

type Tab = 'vender' | 'caixa' | 'vendas' | 'totens' | 'config';

/**
 * PDV de balcão: o caixa abre com o fundo de troco, lança a venda, recebe (dividido, com troco)
 * e imprime o cupom não fiscal ou a NFC-e. No fim do turno, fecha o caixa contando a gaveta.
 */
export default function PdvPage() {
  const tenant = useCurrentTenant();
  const canManage = tenant.role === 'OWNER' || tenant.role === 'MANAGER' || tenant.role === null;
  const [state, setState] = useState<PdvState | null>(null);
  const [tab, setTab] = useState<Tab>('vender');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<PdvState>('/cardapio/pdv/caixa', { tenant: true }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!tenant.activeModules.includes('cardapio')) {
    return (
      <div className="card max-w-lg space-y-2">
        <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );
  }
  if (!state) return error ? <ErrorBox message={error} /> : <Spinner />;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'vender', label: 'Vender' },
    { id: 'caixa', label: 'Caixa' },
    { id: 'vendas', label: 'Vendas' },
    ...(canManage ? [{ id: 'totens' as const, label: 'Totens' }, { id: 'config' as const, label: 'Nota fiscal e impressoras' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">PDV (balcão)</h1>
          <p className="text-sm text-zinc-500">
            {state.session
              ? `Caixa aberto por ${state.session.openedByName ?? 'alguém da equipe'} às ${new Date(state.session.openedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${state.session.summary.salesCount} vendas · ${formatBRL(state.session.summary.salesCents)}`
              : 'Caixa fechado. Abra o caixa para começar a vender.'}
          </p>
        </div>
        <nav className="flex gap-1 rounded-xl bg-zinc-100 p-1 text-sm" aria-label="Seções do PDV">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${tab === t.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <ErrorBox message={error} />

      {tab === 'vender' && (state.session ? <SellView state={state} onSold={load} /> : <OpenCash onOpened={load} />)}
      {tab === 'caixa' && <CashPanel session={state.session} onChange={load} />}
      {tab === 'vendas' && <SalesList canManage={canManage} nfceAvailable={state.nfce.available} />}
      {tab === 'totens' && canManage && <TotemSettings />}
      {tab === 'config' && canManage && <PdvSettings onSaved={load} />}
    </div>
  );
}
