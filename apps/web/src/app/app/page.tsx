'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CHANNEL_LABELS, MODULES, MODULE_CODES, ORDER_STATUS_LABELS, formatBRL, type ModuleCode, type OrderStatus, type SalesChannel } from '@delivery360/shared';
import { HeroSlides, type Slide } from '@/components/hero-slides';
import { ChartArt, PhoneArt, PizzaArt, RouteArt } from '@/components/slide-art';
import { Icon, type IconName } from '@/components/icons';
import { api } from '@/lib/api';
import { useCurrentTenant } from './tenant-context';

interface OrderRow {
  id: string;
  number: number;
  status: OrderStatus;
  customerName: string;
  totalCents: number;
  createdAt: string;
  channel?: SalesChannel;
}
interface Campaign {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  label: string | null;
  participating: boolean;
}

const ACTIVE: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY'];
const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  PAID: 'bg-amber-100 text-amber-800',
  IN_PREPARATION: 'bg-orange-100 text-orange-800',
  READY: 'bg-yellow-100 text-yellow-800',
  OUT_FOR_DELIVERY: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-zinc-100 text-zinc-500',
};
const MODULE_ICON: Record<ModuleCode, IconName> = { gestao: 'wallet', cardapio: 'menu', entregas: 'bike', trafego: 'megaphone' };
const MODULE_GRAD: Record<ModuleCode, string> = {
  gestao: 'from-amber-400 to-orange-500',
  cardapio: 'from-orange-500 to-red-600',
  entregas: 'from-red-500 to-rose-700',
  trafego: 'from-yellow-400 to-amber-600',
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};

export default function RestaurantHome() {
  const tenant = useCurrentTenant();
  const hasMenu = tenant.activeModules.includes('cardapio');
  const canMoney = tenant.role !== 'STAFF';
  const inactive = MODULE_CODES.filter((m) => !tenant.activeModules.includes(m));
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    if (!hasMenu) return;
    const load = () =>
      api<OrderRow[]>('/cardapio/orders', { tenant: true })
        .then(setOrders)
        .catch(() => setOrders([]));
    load();
    api<Campaign[]>('/cardapio/campaigns', { tenant: true })
      .then((c) => setCampaigns(c.filter((x) => x.participating)))
      .catch(() => undefined);
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [hasMenu]);

  const stats = useMemo(() => {
    if (!orders) return null;
    const today = dayKey(new Date());
    const valid = orders.filter((o) => o.status !== 'CANCELLED');
    const todays = valid.filter((o) => dayKey(new Date(o.createdAt)) === today);
    const revenue = todays.reduce((s, o) => s + o.totalCents, 0);
    const week = Array.from({ length: 7 }, (_, k) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - k));
      const key = dayKey(d);
      const list = valid.filter((o) => dayKey(new Date(o.createdAt)) === key);
      return { label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), cents: list.reduce((s, o) => s + o.totalCents, 0), count: list.length };
    });
    return {
      count: todays.length,
      revenue,
      ticket: todays.length ? Math.round(revenue / todays.length) : 0,
      live: orders.filter((o) => ACTIVE.includes(o.status)),
      week,
      max: Math.max(1, ...week.map((w) => w.cents)),
      recent: orders.slice(0, 6),
    };
  }, [orders]);

  const slides: Slide[] = [
    ...(hasMenu
      ? [
          {
            id: 'pedidos',
            eyebrow: 'Operação ao vivo',
            title: 'Cada pedido, do forno à porta.',
            text: 'Painel com alerta sonoro, impressão e cozinha conectados em tempo real.',
            cta: { label: 'Abrir painel de pedidos', href: '/app/pedidos' },
            bg: 'bg-[image:var(--grad-fire)]',
            art: <PizzaArt />,
          },
          {
            id: 'whats',
            eyebrow: 'WhatsApp da loja',
            title: 'Seu cliente avisado em cada etapa.',
            text: 'Aprovado, em preparo, saiu para entrega e entregue, saindo do número da sua loja.',
            cta: { label: 'Conectar WhatsApp', href: '/app/cardapio' },
            bg: 'bg-[image:var(--grad-night)]',
            art: <PhoneArt />,
          },
        ]
      : []),
    ...(tenant.activeModules.includes('entregas')
      ? [
          {
            id: 'entregas',
            eyebrow: 'Entregas',
            title: 'Moto no mapa, código na porta.',
            text: 'O cliente acompanha o motoboy e a entrega só fecha com o código certo.',
            cta: { label: 'Ver entregas', href: '/app/entregas' },
            bg: 'bg-gradient-to-br from-red-600 via-rose-700 to-zinc-900',
            art: <RouteArt />,
          },
        ]
      : []),
    ...(tenant.activeModules.includes('gestao') && canMoney
      ? [
          {
            id: 'gestao',
            eyebrow: 'Financeiro',
            title: 'O que você recebe, do jeito que cai no caixa.',
            text: 'Contas a receber pelo valor pago, taxas separadas e DRE com o resultado real.',
            cta: { label: 'Abrir Gestão', href: '/app/gestao' },
            bg: 'bg-gradient-to-br from-amber-400 via-orange-500 to-red-600',
            art: <ChartArt />,
          },
        ]
      : []),
    ...campaigns.map((c) => ({
      id: `c-${c.id}`,
      eyebrow: c.label || 'Campanha Delivery360',
      title: c.title,
      text: c.subtitle ?? 'Campanha ativa na sua loja.',
      cta: { label: 'Ver campanhas', href: '/app/cardapio' },
      bg: 'bg-zinc-900',
      imageUrl: /^(https?:\/\/|\/)/.test(c.imageUrl) ? c.imageUrl : undefined,
      art: null,
    })),
  ];

  const kpis: { label: string; value: string; icon: IconName; grad: string; hint?: string }[] = stats
    ? [
        { label: 'Pedidos hoje', value: String(stats.count), icon: 'orders', grad: 'from-orange-500 to-red-600' },
        ...(canMoney
          ? [
              { label: 'Vendido hoje', value: formatBRL(stats.revenue), icon: 'money' as IconName, grad: 'from-amber-400 to-orange-500' },
              { label: 'Ticket médio', value: formatBRL(stats.ticket), icon: 'ticket' as IconName, grad: 'from-yellow-400 to-amber-500' },
            ]
          : []),
        { label: 'Em andamento', value: String(stats.live.length), icon: 'flame', grad: 'from-red-500 to-rose-700', hint: stats.live.length ? 'ao vivo' : undefined },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-orange-600">{greeting()} 👋</p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{tenant.name}</h1>
        </div>
        {hasMenu && (
          <Link href="/app/pedidos" className="btn-primary rounded-full px-5 py-2.5">
            <Icon name="orders" className="h-4 w-4" /> Painel de pedidos
          </Link>
        )}
      </div>

      <HeroSlides slides={slides} />

      {hasMenu && (
        <div className={`grid gap-3 sm:gap-4 ${kpis.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
          {(stats ? kpis : Array.from({ length: canMoney ? 4 : 2 }, () => null)).map((k, idx) =>
            k ? (
              <div key={k.label} className="card animate-rise relative overflow-hidden p-4 sm:p-5" style={{ animationDelay: `${idx * 70}ms` }}>
                <div aria-hidden className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-15 ${k.grad}`} />
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ${k.grad}`}>
                  <Icon name={k.icon} />
                </span>
                <div className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">{k.label}</div>
                <div className="flex items-center gap-2 text-xl font-black tracking-tight sm:text-2xl">
                  {k.value}
                  {k.hint && (
                    <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> {k.hint}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div key={idx} className="card h-[124px] animate-pulse bg-zinc-100/70" />
            ),
          )}
        </div>
      )}

      {hasMenu && stats && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {canMoney ? (
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold">Vendas da semana</h2>
                  <p className="text-xs text-zinc-500">Pedidos da loja e dos apps, sem os cancelados</p>
                </div>
                <span className="text-fire text-lg font-black">{formatBRL(stats.week.reduce((s, w) => s + w.cents, 0))}</span>
              </div>
              <div className="mt-5 flex h-44 items-end gap-2 sm:gap-3">
                {stats.week.map((w, k) => (
                  <div key={k} className="group flex h-full flex-1 flex-col items-center gap-2">
                    <div className="relative flex w-full flex-1 items-end">
                      <div
                        className={`w-full origin-bottom rounded-xl ${k === 6 ? 'bg-[image:var(--grad-fire)] shadow-[0_8px_20px_-8px_rgba(255,122,26,0.9)]' : 'bg-orange-100 group-hover:bg-orange-200'}`}
                        style={{ height: `${Math.max(4, (w.cents / stats.max) * 100)}%`, animation: `rise .6s ${k * 60}ms both` }}
                        title={`${formatBRL(w.cents)} · ${w.count} pedidos`}
                      />
                    </div>
                    <span className={`text-[11px] capitalize ${k === 6 ? 'font-bold text-zinc-900' : 'text-zinc-400'}`}>{k === 6 ? 'hoje' : w.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Últimos pedidos</h2>
              <Link href="/app/pedidos" className="text-sm font-semibold text-orange-600 hover:underline">
                Ver todos
              </Link>
            </div>
            {stats.recent.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
                Os pedidos aparecem aqui assim que chegarem.
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100">
                {stats.recent.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-xs font-black text-white">#{o.number}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{o.customerName}</div>
                      <div className="text-xs text-zinc-500">
                        {new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {o.channel && o.channel !== 'LOJA' ? ` · ${CHANNEL_LABELS[o.channel]}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      {canMoney && <div className="text-sm font-bold">{formatBRL(o.totalCents)}</div>}
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[o.status] ?? 'bg-zinc-100'}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 font-bold">Seus módulos</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tenant.activeModules.map((m) => (
            <Link key={m} href={MODULES[m].path} className="card group relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md ${MODULE_GRAD[m]}`}>
                <Icon name={MODULE_ICON[m]} />
              </span>
              <div className="mt-3 flex items-center justify-between font-bold">
                {MODULES[m].name}
                <Icon name="arrow" className="h-4 w-4 text-zinc-300 transition group-hover:translate-x-1 group-hover:text-orange-500" />
              </div>
              <div className="text-xs text-zinc-500">{MODULES[m].description}</div>
            </Link>
          ))}
        </div>
        {inactive.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            Não contratados: {inactive.map((m) => MODULES[m].name).join(', ')}. Fale com seu gestor de conta para ativar.
          </p>
        )}
      </div>
    </div>
  );
}
