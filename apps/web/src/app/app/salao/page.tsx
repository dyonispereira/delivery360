'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatBRL,
  ORDER_STATUS_LABELS,
  serviceFee,
  splitBill,
  TAB_PAYMENT_METHODS,
  type PaymentMethod,
  type PublicProduct,
  type SalaoTable,
  type TabDetail,
  type TabRound,
} from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';
import { lineOptions, lineUnit, MenuPicker, type CartLine } from './menu-picker';
import { TablesSetup } from './tables-setup';

type Menu = { categories: { id: string; name: string; products: PublicProduct[] }[]; topProductIds: string[] };
type View = { kind: 'tables' } | { kind: 'table'; table: SalaoTable } | { kind: 'add'; table: SalaoTable } | { kind: 'close'; table: SalaoTable } | { kind: 'setup' };

const sinceLabel = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};

/**
 * Salão (garçom): escolhe a mesa, lança os itens e manda para a cozinha; acompanha o que ficou pronto
 * e fecha a conta. Pensada para o celular do garçom, com botões grandes.
 */
export default function SalaoPage() {
  const tenant = useCurrentTenant();
  const canManage = tenant.role !== 'STAFF';
  const [view, setView] = useState<View>({ kind: 'tables' });
  const [tables, setTables] = useState<SalaoTable[] | null>(null);
  const [feeBps, setFeeBps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadTables = useCallback(async () => {
    try {
      const res = await api<{ tables: SalaoTable[]; serviceFeeBps: number }>('/cardapio/salao/tables', { tenant: true });
      setTables(res.tables);
      setFeeBps(res.serviceFeeBps);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadTables();
    const t = setInterval(loadTables, 10_000);
    return () => clearInterval(t);
  }, [loadTables]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!tenant.activeModules.includes('cardapio')) {
    return <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />;
  }

  const back = () => {
    setView({ kind: 'tables' });
    void loadTables();
  };

  return (
    <div className="mx-auto max-w-3xl pb-28">
      {toast && (
        <div className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-2xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg" role="status">
          {toast}
        </div>
      )}
      {view.kind === 'tables' && (
        <TablesGrid
          tables={tables}
          error={error}
          canManage={canManage}
          onOpen={(table) => setView(table.tab ? { kind: 'table', table } : { kind: 'add', table })}
          onSetup={() => setView({ kind: 'setup' })}
        />
      )}
      {view.kind === 'setup' && (
        <TablesSetup
          feeBps={feeBps}
          onBack={back}
          onChanged={() => void loadTables()}
        />
      )}
      {view.kind === 'table' && (
        <TableView table={view.table} onBack={back} onAdd={() => setView({ kind: 'add', table: view.table })} onClose={() => setView({ kind: 'close', table: view.table })} />
      )}
      {view.kind === 'add' && (
        <AddItems
          table={view.table}
          onBack={() => (view.table.tab ? setView({ kind: 'table', table: view.table }) : back())}
          onSent={(number) => {
            setToast(`Pedido #${number} enviado para a cozinha`);
            void loadTables().then(() => undefined);
            setView({ kind: 'table', table: { ...view.table, tab: view.table.tab ?? { id: '', openedAt: new Date().toISOString(), people: null, subtotalCents: 0, rounds: 1, readyCount: 0, kitchenCount: 1 } } });
          }}
        />
      )}
      {view.kind === 'close' && (
        <CloseTab
          table={view.table}
          feeBps={feeBps}
          onBack={() => setView({ kind: 'table', table: view.table })}
          onClosed={(total) => {
            setToast(`${view.table.name} liberada · ${formatBRL(total)} recebido`);
            back();
          }}
        />
      )}
    </div>
  );
}

// ---------- Mesas ----------

function TablesGrid({
  tables,
  error,
  canManage,
  onOpen,
  onSetup,
}: {
  tables: SalaoTable[] | null;
  error: string | null;
  canManage: boolean;
  onOpen: (t: SalaoTable) => void;
  onSetup: () => void;
}) {
  const busy = tables?.filter((t) => t.tab) ?? [];
  const ready = busy.reduce((s, t) => s + (t.tab?.readyCount ?? 0), 0);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Salão</h1>
          <p className="text-sm text-zinc-500">
            {tables ? `${busy.length} de ${tables.length} mesas ocupadas` : 'Toque na mesa para lançar o pedido'}
            {ready > 0 && <span className="ml-2 font-semibold text-emerald-700">· {ready} pronto{ready > 1 ? 's' : ''} para servir</span>}
          </p>
        </div>
        {canManage && (
          <button className="btn-ghost ml-auto" onClick={onSetup}>
            Mesas e taxa de serviço
          </button>
        )}
      </div>
      <ErrorBox message={error} />
      {!tables ? (
        <Spinner />
      ) : tables.length === 0 ? (
        <div className="card text-center">
          <p className="mb-1 text-lg font-semibold">Nenhuma mesa cadastrada</p>
          <p className="mb-4 text-sm text-zinc-500">{canManage ? 'Crie as mesas do salão para o garçom começar a lançar pedidos.' : 'Peça ao dono ou gerente para cadastrar as mesas.'}</p>
          {canManage && (
            <button className="btn-primary" onClick={onSetup}>
              Cadastrar mesas
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t)}
              className={`relative flex min-h-28 flex-col justify-between rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                t.tab ? 'border-transparent bg-[image:var(--grad-ember)] text-white shadow-[0_10px_24px_-12px_rgba(229,37,42,0.8)]' : 'border-zinc-200 bg-white'
              }`}
            >
              <span className="text-lg font-bold leading-tight">{t.name}</span>
              {t.tab ? (
                <span className="text-sm">
                  <span className="block text-xl font-black">{formatBRL(t.tab.subtotalCents)}</span>
                  <span className="text-white/85">
                    {sinceLabel(t.tab.openedAt)}
                    {t.tab.people ? ` · ${t.tab.people} pessoas` : ''}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-zinc-400">Livre</span>
              )}
              {t.tab && t.tab.readyCount > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-emerald-400 px-2 py-0.5 text-xs font-bold text-emerald-950">
                  {t.tab.readyCount} pronto{t.tab.readyCount > 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <button className="btn-ghost px-3" onClick={onBack} aria-label="Voltar">
        ←
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>
    </div>
  );
}

// ---------- Mesa aberta ----------

const ROUND_TONE: Record<string, string> = {
  PAID: 'bg-red-100 text-red-700',
  IN_PREPARATION: 'bg-amber-100 text-amber-800',
  READY: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-zinc-100 text-zinc-600',
  CANCELLED: 'bg-zinc-100 text-zinc-400 line-through',
};
const roundLabel = (s: TabRound['status']) => (s === 'PAID' ? 'Na cozinha' : s === 'COMPLETED' ? 'Servido' : s === 'READY' ? 'Pronto para servir' : ORDER_STATUS_LABELS[s]);

function useTab(tableId: string) {
  const [tab, setTab] = useState<TabDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setTab(await api<TabDetail | null>(`/cardapio/salao/tables/${tableId}/tab`, { tenant: true }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tableId]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  return { tab, error, reload: load };
}

function TableView({ table, onBack, onAdd, onClose }: { table: SalaoTable; onBack: () => void; onAdd: () => void; onClose: () => void }) {
  const { tab, error, reload } = useTab(table.id);
  const [busy, setBusy] = useState<string | null>(null);

  async function served(id: string) {
    setBusy(id);
    try {
      await api(`/cardapio/salao/orders/${id}/served`, { method: 'POST', tenant: true });
    } finally {
      setBusy(null);
      await reload();
    }
  }

  if (tab === undefined) return <Spinner />;
  if (tab === null)
    return (
      <>
        <Header title={table.name} subtitle="Mesa livre" onBack={onBack} />
        <button className="btn-primary w-full py-4 text-base" onClick={onAdd}>
          Lançar pedido
        </button>
      </>
    );

  return (
    <>
      <Header title={table.name} subtitle={`Aberta há ${sinceLabel(tab.openedAt)}${tab.people ? ` · ${tab.people} pessoas` : ''}`} onBack={onBack} />
      <ErrorBox message={error} />
      <div className="space-y-3">
        {tab.rounds.map((r) => (
          <article key={r.id} className={`card p-4 ${r.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <b>#{r.number}</b>
              <span className="text-zinc-500">
                {new Date(r.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {r.waiterName ? ` · ${r.waiterName}` : ''}
              </span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${ROUND_TONE[r.status]}`}>{roundLabel(r.status)}</span>
            </div>
            <ul className="space-y-1 text-sm">
              {r.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span>
                    <b>{i.quantity}x</b> {i.name}
                    {i.options.length > 0 && <span className="block pl-5 text-zinc-500">{i.options.map((o) => o.name).join(', ')}</span>}
                    {i.notes && <span className="block pl-5 font-medium text-amber-700">⚠ {i.notes}</span>}
                  </span>
                  <span className="shrink-0 text-zinc-600">{formatBRL(i.totalCents)}</span>
                </li>
              ))}
            </ul>
            {r.status === 'READY' && (
              <button className="btn mt-3 w-full bg-emerald-600 py-3 text-white" disabled={busy === r.id} onClick={() => void served(r.id)}>
                Levei à mesa (servido)
              </button>
            )}
          </article>
        ))}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="mr-auto">
            <div className="text-xs text-zinc-500">Consumo</div>
            <div className="text-xl font-black">{formatBRL(tab.subtotalCents)}</div>
          </div>
          <button className="btn-ghost py-3" onClick={onClose}>
            Fechar conta
          </button>
          <button className="btn-primary py-3" onClick={onAdd}>
            + Itens
          </button>
        </div>
      </div>
    </>
  );
}

// ---------- Lançar itens ----------

function AddItems({ table, onBack, onSent }: { table: SalaoTable; onBack: () => void; onSent: (number: number) => void }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [review, setReview] = useState(false);
  const [notes, setNotes] = useState('');
  const [people, setPeople] = useState<number | ''>(table.tab?.people ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Menu>('/cardapio/salao/menu', { tenant: true }).then(setMenu, (e) => setError((e as Error).message));
  }, []);

  const count = cart.reduce((s, l) => s + l.quantity, 0);
  const total = cart.reduce((s, l) => s + lineUnit(l) * l.quantity, 0);

  function add(line: Omit<CartLine, 'key'>) {
    setCart((cur) => {
      const same = cur.find((l) => l.product.id === line.product.id && l.notes === line.notes && l.optionIds.join() === line.optionIds.join());
      if (same) return cur.map((l) => (l === same ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l));
      return [...cur, { ...line, key: `${line.product.id}-${Date.now()}-${Math.random()}` }];
    });
  }
  const setQty = (key: string, q: number) => setCart((cur) => (q <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, q) } : l))));

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await api<{ number: number }>(`/cardapio/salao/tables/${table.id}/orders`, {
        method: 'POST',
        tenant: true,
        body: {
          items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes || undefined })),
          notes: notes.trim() || undefined,
          people: people || undefined,
        },
      });
      onSent(res.number);
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <>
      <Header title={`${table.name} · lançar pedido`} subtitle={table.tab ? `Conta aberta · ${formatBRL(table.tab.subtotalCents)}` : 'Abre a conta da mesa'} onBack={onBack} />
      <ErrorBox message={error} />
      {!menu ? (
        !error && <Spinner />
      ) : (
        <MenuPicker categories={menu.categories} topIds={menu.topProductIds} cart={cart} onAdd={add} />
      )}

      {count > 0 && !review && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 md:left-64">
          <button className="btn-primary mx-auto flex w-full max-w-3xl justify-between py-4 text-base" onClick={() => setReview(true)}>
            <span>Ver pedido · {count} {count > 1 ? 'itens' : 'item'}</span>
            <span>{formatBRL(total)}</span>
          </button>
        </div>
      )}

      {review && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setReview(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Conferir pedido">
            <h3 className="mb-3 text-lg font-bold">Conferir e enviar · {table.name}</h3>
            <ul className="mb-4 divide-y divide-zinc-100">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">{l.product.name}</div>
                    {lineOptions(l).length > 0 && <div className="text-zinc-500">{lineOptions(l).join(', ')}</div>}
                    {l.notes && <div className="font-medium text-amber-700">⚠ {l.notes}</div>}
                    <div className="text-zinc-500">{formatBRL(lineUnit(l) * l.quantity)}</div>
                  </div>
                  <div className="flex items-center rounded-xl border border-zinc-200">
                    <button className="px-3 py-2 text-lg" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Menos">−</button>
                    <span className="w-6 text-center font-bold">{l.quantity}</span>
                    <button className="px-3 py-2 text-lg" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Mais">+</button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mb-4 grid grid-cols-[1fr_7rem] gap-3">
              <div>
                <label className="label" htmlFor="round-notes">Observação do pedido</label>
                <input id="round-notes" className="input" placeholder="Ex.: servir junto" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="people">Pessoas</label>
                <input id="people" className="input" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value ? Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 0) || '' : '')} />
              </div>
            </div>
            <ErrorBox message={error} />
            <button className="btn-primary mt-2 w-full py-4 text-base" disabled={sending || count === 0} onClick={() => void send()}>
              {sending ? 'Enviando...' : `Enviar para a cozinha · ${formatBRL(total)}`}
            </button>
            <button className="btn-ghost mt-2 w-full" onClick={() => setReview(false)}>
              Continuar escolhendo
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Fechar conta ----------

function CloseTab({ table, feeBps, onBack, onClosed }: { table: SalaoTable; feeBps: number; onBack: () => void; onClosed: (total: number) => void }) {
  const { tab, error: loadError } = useTab(table.id);
  const [withFee, setWithFee] = useState(feeBps > 0);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [split, setSplit] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab?.people) setSplit(tab.people);
  }, [tab?.people]);

  if (tab === undefined) return <Spinner />;
  if (tab === null) {
    return (
      <>
        <Header title={table.name} subtitle="Esta conta já foi fechada" onBack={onBack} />
      </>
    );
  }

  const live = tab.rounds.filter((r) => r.status !== 'CANCELLED');
  const inKitchen = live.filter((r) => r.status === 'PAID' || r.status === 'IN_PREPARATION');
  // Itens somados (o mesmo prato em rodadas diferentes vira uma linha só).
  const lines = new Map<string, { name: string; quantity: number; totalCents: number }>();
  for (const r of live)
    for (const i of r.items) {
      const key = `${i.name}|${i.options.map((o) => o.name).join(',')}`;
      const cur = lines.get(key);
      lines.set(key, { name: i.options.length ? `${i.name} (${i.options.map((o) => o.name).join(', ')})` : i.name, quantity: (cur?.quantity ?? 0) + i.quantity, totalCents: (cur?.totalCents ?? 0) + i.totalCents });
    }
  const fee = withFee ? serviceFee(tab.subtotalCents, feeBps) : 0;
  const total = tab.subtotalCents + fee;
  const parts = splitBill(total, split);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await api(`/cardapio/salao/tabs/${tab!.id}/close`, { method: 'POST', tenant: true, body: { serviceFee: withFee, paymentMethod: total > 0 ? method : undefined } });
      onClosed(total);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <Header title={`Fechar conta · ${table.name}`} subtitle={`Aberta há ${sinceLabel(tab.openedAt)}`} onBack={onBack} />
      <ErrorBox message={loadError} />
      <div className="card mb-4 p-4">
        <ul className="mb-3 space-y-1 text-sm">
          {[...lines.values()].map((l) => (
            <li key={l.name} className="flex justify-between gap-3">
              <span>
                <b>{l.quantity}x</b> {l.name}
              </span>
              <span className="shrink-0">{formatBRL(l.totalCents)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-dashed border-zinc-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Consumo</span>
            <span>{formatBRL(tab.subtotalCents)}</span>
          </div>
          {feeBps > 0 && (
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} />
                Taxa de serviço ({(feeBps / 100).toLocaleString('pt-BR')}%)
              </span>
              <span>{formatBRL(fee)}</span>
            </label>
          )}
          <div className="flex justify-between pt-1 text-xl font-black">
            <span>Total</span>
            <span>{formatBRL(total)}</span>
          </div>
        </div>
      </div>

      {total > 0 && (
        <>
          <div className="card mb-4 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Dividir a conta</span>
              <div className="flex items-center rounded-xl border border-zinc-200">
                <button className="px-3 py-2 text-lg" onClick={() => setSplit(Math.max(1, split - 1))} aria-label="Menos pessoas">−</button>
                <span className="w-8 text-center font-bold">{split}</span>
                <button className="px-3 py-2 text-lg" onClick={() => setSplit(Math.min(50, split + 1))} aria-label="Mais pessoas">+</button>
              </div>
            </div>
            <p className="text-sm text-zinc-600">
              {split === 1 ? 'Uma pessoa paga tudo.' : parts[0] === parts[parts.length - 1] ? `${formatBRL(parts[0])} por pessoa` : `${formatBRL(parts[1])} por pessoa (uma paga ${formatBRL(parts[0])})`}
            </p>
          </div>

          <p className="mb-2 font-semibold">Como pagou?</p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {TAB_PAYMENT_METHODS.map((m) => (
              <button
                key={m.method}
                onClick={() => setMethod(m.method)}
                className={`rounded-2xl border px-2 py-4 text-sm font-semibold transition ${method === m.method ? 'border-[var(--brand)] bg-orange-50 text-[var(--brand)]' : 'border-zinc-200 bg-white'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      {inKitchen.length > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {inKitchen.length === 1 ? `O pedido #${inKitchen[0].number} ainda está na cozinha e` : `${inKitchen.length} pedidos ainda estão na cozinha e`} será{inKitchen.length > 1 ? 'ão' : ''} finalizado{inKitchen.length > 1 ? 's' : ''} junto com a conta.
        </p>
      )}
      <ErrorBox message={error} />
      <button className="btn-primary mt-2 w-full py-4 text-base" disabled={saving || (total > 0 && !method)} onClick={() => void confirm()}>
        {saving ? 'Fechando...' : total > 0 ? (method ? `Recebi ${formatBRL(total)} · liberar mesa` : 'Escolha a forma de pagamento') : 'Liberar mesa'}
      </button>
    </>
  );
}
