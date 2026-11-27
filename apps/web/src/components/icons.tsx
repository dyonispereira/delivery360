/** Ícones de traço simples (desenho próprio da Delivery360). */

const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  orders: 'M6 3h12a1 1 0 0 1 1 1v17l-3-2-2.5 2-2.5-2-2.5 2L6 19l-1 .7V4a1 1 0 0 1 1-1zm3 5h6m-6 4h6m-6 4h3',
  kitchen: 'M6 14a4 4 0 1 1 1.5-7.7A5 5 0 0 1 16.5 6.3 4 4 0 1 1 18 14M6 14h12v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm3 3h6',
  menu: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 16V5m4 2h7m-7 4h5',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zm13 7h1',
  bike: 'M5 18a3 3 0 1 0 0-.01M19 18a3 3 0 1 0 0-.01M5 18h4l4-7h4l2 7M9 11h4M15 7h3l1 4',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1zm14-2a5 5 0 0 1 0 8M7 15l1 5h3',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10',
  store: 'M4 9 5.5 4h13L20 9M4 9h16M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M5 11v9h14v-9M10 20v-5h4v5',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 10a6 6 0 0 1 12 0m1-10a3 3 0 1 0 0-6m2 16h3a5 5 0 0 0-4-5',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zm-3 9 2 2 4-4',
  chart: 'M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2',
  flame: 'M12 21c-4 0-7-2.7-7-6.5 0-3 2-5 3.5-6.5.3 2 1.5 3 2.5 3.5C11 8 12 5 15 3c-.5 3 3.5 5.5 4 9 .6 4.6-2.6 9-7 9zm0 0c-1.7 0-3-1.2-3-3 0-1.5 1-2.5 2-3.5.2 1 .8 1.5 1.5 1.5.3-1 .7-2 1.5-2.5.3 1.2 1 2 1 3.5 0 2.3-1.3 4-3 4z',
  chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm4 5h8m-8 3h5',
  ticket: 'M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H3zm11-2v12',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zm0 0v14m6-12v14',
  check: 'M5 12.5 10 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 15h2',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 3a2 2 0 0 0 4 0',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4m5-1v5l3 2',
  money: 'M3 6h18v12H3zm9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.8 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/** Marca Delivery360: chama estilizada dentro de um quadrado com degradê quente. */
export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-xl bg-[image:var(--grad-fire)] text-white shadow-[0_6px_16px_-6px_rgba(255,122,26,0.8)] ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22c-4.2 0-7.5-2.9-7.5-7 0-3.4 2.3-5.6 4-7.2.2 2 1.3 3.2 2.4 3.8C11 8.2 12.3 5 15.5 2.8c-.4 3.4 3.8 5.9 4.2 9.6.6 5-2.9 9.6-7.7 9.6z"
          opacity=".95"
        />
        <path fill="#14110f" opacity=".35" d="M12 22c-1.9 0-3.3-1.3-3.3-3.2 0-1.6 1-2.7 2.1-3.7.2 1 .8 1.6 1.6 1.6.3-1.1.8-2.1 1.6-2.7.4 1.3 1.1 2.2 1.1 3.8 0 2.4-1.4 4.2-3.1 4.2z" />
      </svg>
    </span>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className={`text-lg font-extrabold tracking-tight ${dark ? 'text-white' : 'text-zinc-900'}`}>
        Delivery<span className="text-fire">360</span>
      </span>
    </span>
  );
}
