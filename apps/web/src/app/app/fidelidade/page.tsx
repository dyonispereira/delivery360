'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatBRL, parseBRL } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useCurrentTenant } from '../tenant-context';

type RewardType = 'FIXED' | 'FREE_DELIVERY' | 'PRODUCT';

interface Program {
  enabled: boolean;
  pointsPerReal: number;
  expireDays: number;
  clubEnabled: boolean;
  referralEnabled: boolean;
  referralFriendCents: number;
  referralMinOrderCents: number;
  referralReferrerPoints: number;
}
interface Reward {
  id: string;
  name: string;
  pointsCost: number;
  type: RewardType;
  valueCents: number;
  productId: string | null;
  minOrderCents: number;
  active: boolean;
}
interface Level {
  id: string;
  name: string;
  minPoints: number;
  discountBps: number;
  freeDelivery: boolean;
}
interface Overview {
  program: Program;
  rewards: Reward[];
  levels: Level[];
  month: {
    pointsIssued: number;
    pointsRedeemed: number;
    redemptions: number;
    orders: number;
    salesCents: number;
    discountCents: number;
    rewardCents: number;
    clubCents: number;
    referralCents: number;
    newReferred: number;
  };
}
interface Customer {
  id: string;
  name: string;
  phone: string;
  referralCode: string | null;
  referredBy: string | null;
  orders: number;
  referrals: number;
  points: number;
  earned12m: number;
  level: string | null;
}
interface Move {
  id: string;
  points: number;
  kind: 'EARN' | 'REDEEM' | 'REFUND' | 'REFERRAL' | 'ADJUST' | 'EXPIRE';
  note: string | null;
  createdAt: string;
}
interface MenuCategory {
  name: string;
  products: { id: string; name: string; priceCents: number }[];
}

const KIND_LABEL: Record<Move['kind'], string> = {
  EARN: 'Pedido',
  REDEEM: 'Troca por prêmio',
  REFUND: 'Devolvido',
  REFERRAL: 'Indicação',
  ADJUST: 'Ajuste',
  EXPIRE: 'Venceu',
};
const money = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const phoneLabel = (p: string) => (p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p);
const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function rewardText(r: Reward, products: Map<string, string>) {
  if (r.type === 'FIXED') return `${formatBRL(r.valueCents)} de desconto`;
  if (r.type === 'FREE_DELIVERY') return 'Entrega grátis';
  return `${products.get(r.productId ?? '') ?? 'Produto'} grátis`;
}

/** Fidelidade: pontos por pedido, prêmios, clube de benefícios e Indique e Ganhe. Tudo bancado pelo restaurante. */
export default function FidelidadePage() {
  const tenant = useCurrentTenant();
  const canEdit = tenant.role === null || tenant.role === 'OWNER' || tenant.role === 'MANAGER';
  const [data, setData] = useState<Overview | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/cardapio/fidelidade', { tenant: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    api<MenuCategory[]>('/cardapio/menu', { tenant: true })
      .then((m) => setProducts(m.flatMap((c) => c.products.map((p) => ({ id: p.id, name: p.name })))))
      .catch(() => setProducts([]));
  }, [load]);

  if (!tenant.activeModules.includes('cardapio')) {
    return (
      <div className="card max-w-lg space-y-2">
        <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />
        <Link href="/app" className="text-sm text-[var(--brand)] underline">Voltar ao início</Link>
      </div>
    );
  }
  if (!data) return error ? <ErrorBox message={error} /> : <Spinner />;
  const names = new Map(products.map((p) => [p.id, p.name]));
  const m = data.month;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Fidelidade</h1>
        <p className="text-sm text-zinc-500">Pontos por pedido, prêmios, clube de benefícios e Indique e Ganhe. O cliente é reconhecido pelo telefone.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pontos dados no mês" value={m.pointsIssued.toLocaleString('pt-BR')} hint={`${m.pointsRedeemed.toLocaleString('pt-BR')} trocados em ${m.redemptions} prêmios`} />
        <Stat label="Pedidos com benefício" value={String(m.orders)} hint={`${formatBRL(m.salesCents)} recebidos nesses pedidos`} />
        <Stat
          label="Custo da fidelidade"
          value={formatBRL(m.discountCents)}
          hint={`Prêmios ${formatBRL(m.rewardCents)} · clube ${formatBRL(m.clubCents)} · indicação ${formatBRL(m.referralCents)}`}
        />
        <Stat label="Clientes novos por indicação" value={String(m.newReferred)} hint="Neste mês" />
      </div>
      <p className="text-xs text-zinc-500">
        No financeiro, o caixa recebe o que o cliente pagou. O valor dos benefícios aparece só no DRE, em &quot;Descontos e cupons&quot;.
      </p>

      <ProgramForm program={data.program} canEdit={canEdit} onSaved={load} />
      {data.program.enabled && <Rewards rewards={data.rewards} products={products} names={names} canEdit={canEdit} onChange={load} />}
      {data.program.clubEnabled && <Levels levels={data.levels} canEdit={canEdit} onChange={load} />}
      <Customers canEdit={canEdit} onChange={load} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function ProgramForm({ program, canEdit, onSaved }: { program: Program; canEdit: boolean; onSaved: () => void }) {
  const [p, setP] = useState(program);
  const [friend, setFriend] = useState(money(program.referralFriendCents));
  const [min, setMin] = useState(money(program.referralMinOrderCents));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Program>(k: K, v: Program[K]) => {
    setP({ ...p, [k]: v });
    setSaved(false);
  };

  async function save() {
    setError(null);
    const referralFriendCents = parseBRL(friend || '0');
    const referralMinOrderCents = parseBRL(min || '0');
    if (referralFriendCents === null || referralMinOrderCents === null) return setError('Confira os valores da indicação.');
    try {
      await api('/cardapio/fidelidade', { method: 'PUT', tenant: true, body: { ...p, referralFriendCents, referralMinOrderCents } });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Regras</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Pontos por pedido</p>
              <p className="text-xs text-zinc-500">Entram quando o pedido é entregue ou retirado.</p>
            </div>
            <Toggle checked={p.enabled} disabled={!canEdit} onChange={(v) => set('enabled', v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="ppr">Pontos por R$ 1</label>
              <input id="ppr" className="input" type="number" min={1} max={100} disabled={!canEdit} value={p.pointsPerReal} onChange={(e) => set('pointsPerReal', Number(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="exp">Vencem após (dias)</label>
              <input id="exp" className="input" type="number" min={0} disabled={!canEdit} value={p.expireDays} onChange={(e) => set('expireDays', Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-zinc-500">A taxa de entrega não conta. Vencimento 0 = não vencem. Com 90, vencem se o cliente ficar 90 dias sem pedir.</p>
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Clube de benefícios</p>
              <p className="text-xs text-zinc-500">Níveis pelos pontos ganhos em 12 meses, com desconto automático.</p>
            </div>
            <Toggle checked={p.clubEnabled} disabled={!canEdit} onChange={(v) => set('clubEnabled', v)} />
          </div>
          <p className="text-xs text-zinc-500">O desconto do clube não soma com cupom: se o cliente usar cupom, vale o cupom. Os prêmios por pontos somam com tudo.</p>
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Indique e Ganhe</p>
              <p className="text-xs text-zinc-500">Cada cliente ganha um link para mandar aos amigos.</p>
            </div>
            <Toggle checked={p.referralEnabled} disabled={!canEdit} onChange={(v) => set('referralEnabled', v)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="rf">Amigo ganha (R$)</label>
              <input id="rf" className="input" inputMode="decimal" disabled={!canEdit} value={friend} onChange={(e) => setFriend(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rm">Pedido mín. (R$)</label>
              <input id="rm" className="input" inputMode="decimal" disabled={!canEdit} value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="rp">Quem indicou (pts)</label>
              <input id="rp" className="input" type="number" min={0} disabled={!canEdit} value={p.referralReferrerPoints} onChange={(e) => set('referralReferrerPoints', Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-zinc-500">O desconto vale só no primeiro pedido do amigo. Quem indicou ganha os pontos quando esse pedido é entregue.</p>
        </div>
      </div>
      <ErrorBox message={error} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Salvar regras</button>
          {saved && <span className="text-sm text-emerald-700">Salvo.</span>}
        </div>
      )}
    </section>
  );
}

function Rewards({
  rewards,
  products,
  names,
  canEdit,
  onChange,
}: {
  rewards: Reward[];
  products: { id: string; name: string }[];
  names: Map<string, string>;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [points, setPoints] = useState('100');
  const [type, setType] = useState<RewardType>('FIXED');
  const [value, setValue] = useState('10,00');
  const [productId, setProductId] = useState('');
  const [min, setMin] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const valueCents = type === 'FIXED' ? parseBRL(value) : 0;
    if (type === 'FIXED' && !valueCents) return setError('Informe o valor do desconto.');
    const auto = type === 'FIXED' ? `${formatBRL(valueCents ?? 0)} de desconto` : type === 'FREE_DELIVERY' ? 'Entrega grátis' : `${names.get(productId) ?? 'Produto'} grátis`;
    try {
      await api('/cardapio/fidelidade/premios', {
        method: 'POST',
        tenant: true,
        body: { name: name.trim() || auto, pointsCost: Number(points), type, valueCents: valueCents ?? 0, productId: type === 'PRODUCT' ? productId || undefined : undefined, minOrderCents: min ? (parseBRL(min) ?? 0) : 0 },
      });
      setName('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const call = async (path: string, method: 'PATCH' | 'DELETE', body?: unknown) => {
    try {
      await api(path, { method, tenant: true, body });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Prêmios</h2>
        <p className="text-sm text-zinc-500">O cliente escolhe no carrinho e os pontos saem na hora. Se o pedido for cancelado, os pontos voltam.</p>
      </div>
      {rewards.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum prêmio ainda. Crie o primeiro abaixo.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rewards.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-20 shrink-0 font-bold text-amber-700">{r.pointsCost} pts</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.name}</span>
                <span className="text-zinc-500">
                  {' '}
                  · {rewardText(r, names)}
                  {r.minOrderCents > 0 ? ` · pedido a partir de ${formatBRL(r.minOrderCents)}` : ''}
                </span>
              </span>
              {!r.active && <Badge tone="amber">Pausado</Badge>}
              {canEdit && (
                <>
                  <Toggle
                    checked={r.active}
                    onChange={(v) => call(`/cardapio/fidelidade/premios/${r.id}`, 'PATCH', { name: r.name, pointsCost: r.pointsCost, type: r.type, valueCents: r.valueCents, productId: r.productId, minOrderCents: r.minOrderCents, active: v })}
                  />
                  <button className="text-xs text-red-600 underline" onClick={() => call(`/cardapio/fidelidade/premios/${r.id}`, 'DELETE')}>
                    Excluir
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="grid gap-2 rounded-xl bg-zinc-50 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="rw-type">Tipo</label>
            <select id="rw-type" className="input" value={type} onChange={(e) => setType(e.target.value as RewardType)}>
              <option value="FIXED">Desconto em R$</option>
              <option value="FREE_DELIVERY">Entrega grátis</option>
              <option value="PRODUCT">Produto grátis</option>
            </select>
          </div>
          {type === 'FIXED' && (
            <div>
              <label className="label" htmlFor="rw-val">Desconto (R$)</label>
              <input id="rw-val" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
          {type === 'PRODUCT' && (
            <div>
              <label className="label" htmlFor="rw-prod">Produto</label>
              <select id="rw-prod" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Escolha</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="rw-pts">Custa (pontos)</label>
            <input id="rw-pts" className="input" type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rw-min">Pedido mín. (R$)</label>
            <input id="rw-min" className="input" inputMode="decimal" placeholder="opcional" value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div className="lg:col-span-1">
            <label className="label" htmlFor="rw-name">Nome (opcional)</label>
            <input id="rw-name" className="input" placeholder="automático" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={add}>Criar prêmio</button>
          </div>
        </div>
      )}
      <ErrorBox message={error} />
    </section>
  );
}

function Levels({ levels, canEdit, onChange }: { levels: Level[]; canEdit: boolean; onChange: () => void }) {
  const [name, setName] = useState('');
  const [min, setMin] = useState('300');
  const [discount, setDiscount] = useState('5');
  const [free, setFree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const d = Number(discount.replace(',', '.') || '0');
    if (!(d >= 0 && d <= 50)) return setError('O desconto vai de 0 a 50%.');
    try {
      await api('/cardapio/fidelidade/niveis', { method: 'POST', tenant: true, body: { name: name.trim(), minPoints: Number(min), discountBps: Math.round(d * 100), freeDelivery: free } });
      setName('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/cardapio/fidelidade/niveis/${id}`, { method: 'DELETE', tenant: true });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Clube de benefícios</h2>
        <p className="text-sm text-zinc-500">O cliente sobe de nível com os pontos que ganhou nos últimos 12 meses (trocar pontos por prêmio não faz cair de nível).</p>
      </div>
      {levels.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum nível ainda. Exemplo: Prata a partir de 300 pontos com 5%, Ouro a partir de 1.000 com 10% e entrega grátis.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {levels.map((l) => (
            <li key={l.id} className="rounded-xl border border-zinc-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-amber-300">{l.name}</span>
                {canEdit && (
                  <button className="text-xs text-red-600 underline" onClick={() => remove(l.id)}>
                    Excluir
                  </button>
                )}
              </div>
              <p className="mt-2 font-medium">{[l.discountBps > 0 ? `${pct(l.discountBps)} em todo pedido` : null, l.freeDelivery ? 'entrega grátis' : null].filter(Boolean).join(' + ')}</p>
              <p className="text-xs text-zinc-500">A partir de {l.minPoints.toLocaleString('pt-BR')} pontos em 12 meses</p>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="grid gap-2 rounded-xl bg-zinc-50 p-3 sm:grid-cols-5">
          <div>
            <label className="label" htmlFor="lv-name">Nome</label>
            <input id="lv-name" className="input" placeholder="Ouro" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lv-min">A partir de (pontos)</label>
            <input id="lv-min" className="input" type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lv-d">Desconto (%)</label>
            <input id="lv-d" className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} className="accent-[var(--brand)]" />
            Entrega grátis
          </label>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={add}>Criar nível</button>
          </div>
        </div>
      )}
      <ErrorBox message={error} />
    </section>
  );
}

function Customers({ canEdit, onChange }: { canEdit: boolean; onChange: () => void }) {
  const [list, setList] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [adjPoints, setAdjPoints] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      setList(await api<Customer[]>(`/cardapio/fidelidade/clientes${q ? `?busca=${encodeURIComponent(q)}` : ''}`, { tenant: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    setMoves(null);
    setAdjPoints('');
    setAdjNote('');
    try {
      setMoves(await api<Move[]>(`/cardapio/fidelidade/clientes/${id}/extrato`, { tenant: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function adjust(id: string) {
    setError(null);
    try {
      await api(`/cardapio/fidelidade/clientes/${id}/ajuste`, { method: 'POST', tenant: true, body: { points: Number(adjPoints), note: adjNote } });
      await load(search.trim());
      setMoves(await api<Move[]>(`/cardapio/fidelidade/clientes/${id}/extrato`, { tenant: true }));
      setAdjPoints('');
      setAdjNote('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Clientes</h2>
          <p className="text-sm text-zinc-500">Quem tem mais pontos primeiro. Toque no cliente para ver o extrato.</p>
        </div>
        <input className="input max-w-xs" type="search" placeholder="Buscar por nome ou telefone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox message={error} />
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum cliente encontrado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2">Cliente</th>
                <th>Pontos</th>
                <th>Nível</th>
                <th>Pedidos</th>
                <th>Indicou</th>
                <th>Veio por</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <Fragment key={c.id}>
                  <tr className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50" onClick={() => toggle(c.id)}>
                    <td className="py-2">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-zinc-500">{phoneLabel(c.phone)}</p>
                    </td>
                    <td className="font-bold text-amber-700">{c.points.toLocaleString('pt-BR')}</td>
                    <td>{c.level ? <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-amber-300">{c.level}</span> : <span className="text-zinc-400">—</span>}</td>
                    <td>{c.orders}</td>
                    <td>{c.referrals > 0 ? `${c.referrals} ${c.referrals === 1 ? 'amigo' : 'amigos'}` : '—'}</td>
                    <td className="text-zinc-500">{c.referredBy ?? '—'}</td>
                  </tr>
                  {open === c.id && (
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <td colSpan={6} className="p-3">
                        {!moves ? (
                          <Spinner />
                        ) : moves.length === 0 ? (
                          <p className="text-sm text-zinc-500">Ainda sem movimentos.</p>
                        ) : (
                          <ul className="space-y-1">
                            {moves.map((mv) => (
                              <li key={mv.id} className="flex justify-between gap-3">
                                <span>
                                  <span className="text-zinc-500">{new Date(mv.createdAt).toLocaleDateString('pt-BR')}</span> · {KIND_LABEL[mv.kind]}
                                  {mv.note ? ` · ${mv.note}` : ''}
                                </span>
                                <span className={mv.points >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                                  {mv.points >= 0 ? '+' : ''}
                                  {mv.points}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {canEdit && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <div>
                              <label className="label" htmlFor={`adj-${c.id}`}>Ajustar pontos</label>
                              <input id={`adj-${c.id}`} className="input w-28" type="number" placeholder="+50 ou -20" value={adjPoints} onChange={(e) => setAdjPoints(e.target.value)} />
                            </div>
                            <div className="min-w-48 flex-1">
                              <label className="label" htmlFor={`adjn-${c.id}`}>Motivo</label>
                              <input id={`adjn-${c.id}`} className="input" placeholder="Ex.: aniversário" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
                            </div>
                            <button className="btn-ghost" disabled={!adjPoints || !adjNote.trim()} onClick={() => adjust(c.id)}>
                              Lançar ajuste
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
