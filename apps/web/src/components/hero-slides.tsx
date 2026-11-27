'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from './icons';

export interface Slide {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  cta?: { label: string; href: string };
  /** Fundo do slide (classe com degradê). */
  bg: string;
  /** Ilustração do lado direito. */
  art: React.ReactNode;
  /** Imagem de fundo (campanhas da Delivery360). */
  imageUrl?: string;
}

const INTERVAL = 6000;

/** Carrossel de slides com troca automática, setas, bolinhas e arrastar no celular. Pausa com o mouse em cima. */
export function HeroSlides({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<number | null>(null);
  const n = slides.length;
  const go = useCallback((d: number) => setI((v) => (v + d + n) % n), [n]);

  useEffect(() => {
    if (paused || n < 2) return;
    const t = setTimeout(() => go(1), INTERVAL);
    return () => clearTimeout(t);
  }, [i, paused, n, go]);

  if (n === 0) return null;
  const s = slides[Math.min(i, n - 1)];

  return (
    <section
      className="relative overflow-hidden rounded-3xl text-white shadow-[0_24px_60px_-28px_rgba(229,37,42,0.6)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}
      aria-roledescription="carrossel"
    >
      <div key={s.id} className={`relative min-h-[240px] sm:min-h-[260px] ${s.bg}`}>
        {s.imageUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-transparent" />
          </>
        )}
        {!s.imageUrl && (
          <>
            <div aria-hidden className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
            <div aria-hidden className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-black/20 blur-3xl" />
          </>
        )}
        <div className="relative grid min-h-[240px] items-center gap-4 p-6 sm:min-h-[260px] sm:grid-cols-[1.25fr_1fr] sm:p-8">
          <div className="animate-slide-in max-w-md space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] backdrop-blur">
              <Icon name="spark" className="h-3.5 w-3.5" /> {s.eyebrow}
            </span>
            <h2 className="text-2xl font-black leading-[1.1] tracking-tight sm:text-[32px]">{s.title}</h2>
            <p className="text-sm text-white/85 sm:text-base">{s.text}</p>
            {s.cta && (
              <Link
                href={s.cta.href}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-zinc-900 shadow-lg transition hover:-translate-y-0.5"
              >
                {s.cta.label} <Icon name="arrow" className="h-4 w-4" />
              </Link>
            )}
          </div>
          <div className="pointer-events-none hidden h-full items-center justify-center sm:flex" style={{ animation: 'slide-in .8s .1s cubic-bezier(.2,.8,.2,1) both' }}>
            {s.art}
          </div>
        </div>
      </div>

      {n > 1 && (
        <>
          <div className="absolute bottom-4 left-6 flex items-center gap-1.5 sm:left-8">
            {slides.map((x, k) => (
              <button
                key={x.id}
                aria-label={`Slide ${k + 1}`}
                onClick={() => setI(k)}
                className={`relative h-1.5 overflow-hidden rounded-full bg-white/35 transition-all ${k === i ? 'w-8' : 'w-1.5 hover:bg-white/60'}`}
              >
                {k === i && (
                  <span
                    className="absolute inset-0 origin-left rounded-full bg-white"
                    style={{ animation: paused ? 'none' : `progress ${INTERVAL}ms linear both`, transform: paused ? 'none' : undefined }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="absolute bottom-3 right-4 flex gap-2">
            <button aria-label="Anterior" onClick={() => go(-1)} className="rounded-full bg-black/25 p-2 backdrop-blur transition hover:bg-black/40">
              <Icon name="chevronLeft" className="h-4 w-4" />
            </button>
            <button aria-label="Próximo" onClick={() => go(1)} className="rounded-full bg-black/25 p-2 backdrop-blur transition hover:bg-black/40">
              <Icon name="chevronRight" className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
