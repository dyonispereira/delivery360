/** Ilustrações dos slides do painel (desenho próprio, sem marcas de terceiros). */

import { Icon } from './icons';

function Chip({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`animate-float absolute rounded-2xl bg-white px-3 py-2 text-xs font-bold text-zinc-900 shadow-xl ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Pizza girando devagar com selos de pedido novo. */
export function PizzaArt({ image = '/vitrine/fornalha/pizza-pepperoni.webp' }: { image?: string }) {
  return (
    <div className="relative h-56 w-56">
      <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/40 animate-spin-slow" />
      <div className="absolute inset-4 overflow-hidden rounded-full shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] ring-4 ring-white/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="h-full w-full scale-110 object-cover animate-spin-slow" />
      </div>
      <Chip className="-left-10 top-6" style={{ ['--r' as string]: '-6deg' }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Novo pedido #128
        </span>
      </Chip>
      <Chip className="-right-6 bottom-8 bg-zinc-900 text-white" style={{ animationDelay: '1.2s', ['--r' as string]: '5deg' }}>
        <span className="text-fire text-base font-black">R$ 89,90</span>
      </Chip>
    </div>
  );
}

/** Celular com as mensagens de status que o cliente recebe. */
export function PhoneArt() {
  const msgs = [
    ['✅', 'Pedido aprovado'],
    ['👨‍🍳', 'Em preparo'],
    ['📦', 'Pronto, aguardando'],
    ['🛵', 'Saiu para entrega'],
  ];
  return (
    <div className="relative">
      <div className="h-60 w-36 rotate-[-6deg] rounded-[28px] border-[6px] border-zinc-900 bg-[#f3ece3] p-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-zinc-900/80" />
        <div className="space-y-1.5">
          {msgs.map(([e, t], k) => (
            <div
              key={t}
              className="w-fit max-w-[95%] rounded-xl rounded-tl-sm bg-white px-2 py-1 text-[9px] font-semibold text-zinc-800 shadow animate-rise"
              style={{ animationDelay: `${0.3 + k * 0.35}s` }}
            >
              {e} {t}
            </div>
          ))}
          <div className="ml-auto w-fit rounded-xl rounded-tr-sm bg-orange-200 px-2 py-1 text-[9px] font-semibold text-zinc-800 animate-rise" style={{ animationDelay: '1.8s' }}>
            Oba! 😋
          </div>
        </div>
      </div>
      <Chip className="-right-10 top-2" style={{ ['--r' as string]: '6deg' }}>
        <span className="flex items-center gap-1.5">
          <Icon name="bell" className="h-4 w-4 text-orange-500" /> Aviso automático
        </span>
      </Chip>
    </div>
  );
}

/** Painel de resultado com barras subindo e o "caixa confere". */
export function ChartArt() {
  const bars = [38, 56, 44, 70, 62, 84, 96];
  return (
    <div className="relative">
      <div className="w-60 rotate-[3deg] rounded-3xl bg-white p-4 text-zinc-900 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Recebido na semana</div>
        <div className="text-xl font-black">R$ 12.480</div>
        <div className="mt-3 flex h-24 items-end gap-1.5">
          {bars.map((h, k) => (
            <div key={k} className="flex-1 origin-bottom rounded-t-md bg-[image:var(--grad-fire)]" style={{ height: `${h}%`, animation: `rise .6s ${0.15 * k}s both` }} />
          ))}
        </div>
      </div>
      <Chip className="-left-12 -bottom-3 bg-emerald-500 text-white" style={{ ['--r' as string]: '-4deg' }}>
        <span className="flex items-center gap-1">
          <Icon name="check" className="h-4 w-4" strokeWidth={3} /> Caixa confere
        </span>
      </Chip>
    </div>
  );
}

/** Mapinha com a rota até o cliente. */
export function RouteArt() {
  return (
    <div className="relative">
      <svg viewBox="0 0 240 200" className="h-52 w-60 drop-shadow-2xl" aria-hidden="true">
        <defs>
          <linearGradient id="route" x1="0" x2="1">
            <stop offset="0" stopColor="#ffb81c" />
            <stop offset="1" stopColor="#e5252a" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="228" height="188" rx="28" fill="#1b1411" />
        <g stroke="#3a2a22" strokeWidth="10" strokeLinecap="round">
          <path d="M20 60h200M20 140h200M70 16v170M170 16v170" />
        </g>
        <g fill="#2a1f19">
          <rect x="84" y="74" width="72" height="52" rx="10" />
          <rect x="184" y="74" width="40" height="52" rx="10" />
          <rect x="18" y="74" width="40" height="52" rx="10" />
        </g>
        <path d="M40 160 C 70 160, 70 100, 120 100 S 170 40, 200 40" fill="none" stroke="url(#route)" strokeWidth="6" strokeLinecap="round" strokeDasharray="10 8">
          <animate attributeName="stroke-dashoffset" from="72" to="0" dur="1.6s" repeatCount="indefinite" />
        </path>
        <circle cx="40" cy="160" r="9" fill="#ffb81c" stroke="#fff" strokeWidth="3" />
        <g transform="translate(200 40)">
          <circle r="16" fill="#e5252a" opacity=".25">
            <animate attributeName="r" values="10;20;10" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle r="9" fill="#e5252a" stroke="#fff" strokeWidth="3" />
        </g>
      </svg>
      <Chip className="-left-8 top-4" style={{ ['--r' as string]: '-5deg' }}>
        <span className="flex items-center gap-1.5">
          <Icon name="bike" className="h-4 w-4 text-orange-500" /> Chega em 12 min
        </span>
      </Chip>
    </div>
  );
}
