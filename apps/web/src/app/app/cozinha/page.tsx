'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderStatus } from '@delivery360/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { useCurrentTenant } from '../tenant-context';
import { minutesSince, playAlert, primaryAction, readPref, soundUnlocked, unlockSound, useBoard, type BoardOrder } from '../pedidos/board';
import { ChannelTag } from '../pedidos/channel-tag';

const KITCHEN: OrderStatus[] = ['PAID', 'IN_PREPARATION', 'READY'];

/** Tela da cozinha (KDS): letra grande, poucos botões, pensada para tablet ou TV na parede. */
export default function CozinhaPage() {
  const tenant = useCurrentTenant();
  const [now, setNow] = useState(() => Date.now());
  const [, force] = useState(0);
  const { orders, error, move } = useBoard(5000, () => {
    if (readPref('sound', true)) playAlert();
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!tenant.activeModules.includes('cardapio')) {
    return <ErrorBox message={`O módulo Cardápio e pedidos não está contratado para ${tenant.name}.`} />;
  }
  if (!orders) return error ? <ErrorBox message={error} /> : <Spinner />;

  const list = orders.filter((o) => KITCHEN.includes(o.status));

  return (
    <div className="-m-4 min-h-[calc(100vh-4rem)] bg-zinc-900 p-4 text-white md:-m-6 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Cozinha</h1>
        <span className="rounded-full bg-zinc-700 px-3 py-1 text-sm">{list.length} na fila</span>
        <div className="ml-auto flex gap-2">
          {!soundUnlocked() && (
            <button className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-medium text-zinc-900" onClick={() => void unlockSound().then(() => { playAlert(); force((n) => n + 1); })}>
              🔔 Ativar som
            </button>
          )}
          <button className="rounded-lg bg-zinc-700 px-3 py-2 text-sm" onClick={() => void document.documentElement.requestFullscreen?.()}>
            Tela cheia
          </button>
          <Link href="/app/pedidos" className="rounded-lg bg-zinc-700 px-3 py-2 text-sm">Painel</Link>
        </div>
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-900/60 px-3 py-2 text-sm">{error}</div>}

      {list.length === 0 ? (
        <p className="py-24 text-center text-2xl text-zinc-500">Nenhum pedido na fila 🎉</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((o) => (
            <KitchenCard key={o.id} order={o} now={now} withCouriers={tenant.activeModules.includes('entregas')} onMove={(to) => void move(o.id, to)} />
          ))}
        </div>
      )}
    </div>
  );
}

function KitchenCard({ order: o, now, withCouriers, onMove }: { order: BoardOrder; now: number; withCouriers: boolean; onMove: (to: OrderStatus) => void }) {
  const mins = minutesSince(o, now);
  const action = primaryAction(o, withCouriers);
  const header =
    o.status === 'PAID' ? 'bg-red-600' : o.status === 'IN_PREPARATION' ? 'bg-amber-500 text-zinc-900' : 'bg-emerald-600';
  const label = o.status === 'PAID' ? 'NOVO' : o.status === 'IN_PREPARATION' ? 'EM PREPARO' : 'PRONTO';

  return (
    <article className="flex flex-col overflow-hidden rounded-xl bg-zinc-800">
      <header className={`flex items-center justify-between px-4 py-2 ${header}`}>
        <span className="text-2xl font-black">
          #{o.number} <ChannelTag channel={o.channel} code={o.externalCode} className="align-middle text-sm" />
        </span>
        <span className="text-right text-sm font-bold">
          {label}
          <br />
          <span className={mins >= 30 ? 'rounded bg-black/40 px-1' : ''}>{mins} min</span>
        </span>
      </header>
      <div className="flex-1 space-y-2 px-4 py-3">
        <div className="text-sm text-zinc-300">
          {o.customerName.split(' ')[0]} · {o.type === 'DELIVERY' ? 'Entrega' : 'Retirada'}
        </div>
        <ul className="space-y-2">
          {o.items.map((i) => (
            <li key={i.id} className="text-lg leading-tight">
              <b className="text-amber-300">{i.quantity}x</b> {i.name}
              {i.options.map((x) => (
                <div key={x.name} className="pl-6 text-base text-zinc-300">+ {x.name}</div>
              ))}
              {i.notes && <div className="pl-6 text-base font-bold text-amber-300">⚠ {i.notes}</div>}
            </li>
          ))}
        </ul>
        {o.notes && <p className="font-bold text-amber-300">⚠ {o.notes}</p>}
      </div>
      {!action && o.status === 'READY' && <p className="m-3 rounded-lg bg-zinc-700 py-3 text-center font-semibold">Aguardando motoboy</p>}
      {action && (
        <button className="m-3 rounded-lg bg-white py-3 text-lg font-bold text-zinc-900 active:scale-95" onClick={() => onMove(action.to)}>
          {action.label}
        </button>
      )}
    </article>
  );
}
