'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';
import { Accounts } from './accounts';
import { Dre } from './dre';
import { Entries } from './entries';
import { monthLabel } from './shared';

type Tab = 'resumo' | 'pagar' | 'receber' | 'dre' | 'contas';
const TABS: { key: Tab; label: string }[] = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'pagar', label: 'Contas a pagar' },
  { key: 'receber', label: 'Contas a receber' },
  { key: 'dre', label: 'DRE (resultado)' },
  { key: 'contas', label: 'Plano de contas' },
];

interface Bucket {
  count: number;
  cents: number;
}
interface Summary {
  today: string;
  payable: { overdue: Bucket; today: Bucket; next7: Bucket; total: Bucket };
  receivable: { overdue: Bucket; today: Bucket; next7: Bucket; total: Bucket };
  month: { from: string; grossCents: number; netProfitCents: number; cashInCents: number; cashOutCents: number; orders: { count: number; ticketCents: number } };
}

export default function GestaoPage() {
  const tenant = useCurrentTenant();
  const [tab, setTab] = useState<Tab>('resumo');

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('aba') as Tab | null;
    if (t && TABS.some((x) => x.key === t)) setTab(t);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', `?aba=${t}`);
  };

  if (!tenant.activeModules.includes('gestao')) {
    return (
      <div className="card max-w-lg space-y-2">
        <ErrorBox message={`O módulo Gestão não está contratado para ${tenant.name}.`} />
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );
  }
  if (tenant.role === 'STAFF') return <ErrorBox message="O financeiro é visto só pelo dono e pelo gerente." />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Gestão</h1>
        <nav className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => go(t.key)} className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? 'bg-white font-medium shadow-sm' : 'text-zinc-600'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === 'resumo' && <Resumo go={go} />}
      {tab === 'pagar' && <Entries type="PAYABLE" />}
      {tab === 'receber' && <Entries type="RECEIVABLE" />}
      {tab === 'dre' && <Dre />}
      {tab === 'contas' && <Accounts />}
    </div>
  );
}

function Resumo({ go }: { go: (t: Tab) => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Summary>('/gestao/summary', { tenant: true }).then(setS).catch((e) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!s) return error ? <ErrorBox message={error} /> : <Spinner />;

  const m = s.month;
  const profit = m.netProfitCents;
  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Vendas em ${monthLabel(m.from).toLowerCase()}`} value={formatBRL(m.grossCents)} hint={`${m.orders.count} pedidos entregues · ticket médio ${formatBRL(m.orders.ticketCents)}`} />
        <Kpi
          label="Resultado do mês até hoje"
          value={formatBRL(profit)}
          tone={profit < 0 ? 'text-red-600' : 'text-emerald-700'}
          hint={profit < 0 ? 'Prejuízo: veja a DRE' : 'Lucro líquido pela DRE'}
          onClick={() => go('dre')}
        />
        <Kpi label="Entrou no caixa no mês" value={formatBRL(m.cashInCents)} tone="text-emerald-700" hint="Recebimentos com baixa" />
        <Kpi label="Saiu do caixa no mês" value={formatBRL(m.cashOutCents)} tone="text-red-600" hint={`Saldo do mês: ${formatBRL(m.cashInCents - m.cashOutCents)}`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DueCard title="Contas a pagar" data={s.payable} onOpen={() => go('pagar')} danger />
        <DueCard title="Contas a receber" data={s.receivable} onOpen={() => go('receber')} />
      </section>

      <p className="text-xs text-zinc-500">
        Vendas da loja online, custo dos motoboys, devoluções e gorjetas entram aqui sozinhos. Aluguel, fornecedores, salários e outras contas você lança em
        Contas a pagar.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, tone = '', onClick }: { label: string; value: string; hint?: string; tone?: string; onClick?: () => void }) {
  return (
    <div className={`card space-y-1 ${onClick ? 'cursor-pointer hover:border-zinc-300' : ''}`} onClick={onClick}>
      <p className="text-sm text-zinc-500 first-letter:uppercase">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function DueCard({ title, data, onOpen, danger }: { title: string; data: Summary['payable']; onOpen: () => void; danger?: boolean }) {
  const row = (label: string, b: Bucket, tone = '') => (
    <div className="flex items-center justify-between py-1.5">
      <span className={tone}>{label}</span>
      <span className={`font-medium ${tone}`}>
        {formatBRL(b.cents)} <span className="text-xs font-normal text-zinc-500">({b.count})</span>
      </span>
    </div>
  );
  return (
    <section className="card">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <button className="text-sm text-[var(--brand)] underline" onClick={onOpen}>Ver todas</button>
      </header>
      <div className="divide-y divide-zinc-100 text-sm">
        {row('Vencidas', data.overdue, data.overdue.count ? (danger ? 'text-red-600' : 'text-amber-700') : '')}
        {row('Vencem hoje', data.today, data.today.count ? 'text-amber-700' : '')}
        {row('Próximos 7 dias', data.next7)}
        {row('Total em aberto', data.total, 'font-semibold')}
      </div>
    </section>
  );
}
