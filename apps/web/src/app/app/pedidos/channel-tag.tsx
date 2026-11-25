'use client';

import { CHANNEL_LABELS, type SalesChannel } from '@delivery360/shared';

const TONES: Record<SalesChannel, string> = {
  LOJA: '',
  IFOOD: 'bg-red-600 text-white',
  FOOD99: 'bg-yellow-400 text-black',
  KEETA: 'bg-orange-500 text-white',
};

/** Etiqueta do app de onde veio o pedido (pedido da loja própria não tem etiqueta). */
export function ChannelTag({ channel, code, className = '' }: { channel?: SalesChannel; code?: string | null; className?: string }) {
  if (!channel || channel === 'LOJA') return null;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${TONES[channel]} ${className}`}>
      {CHANNEL_LABELS[channel]}
      {code ? ` ${code}` : ''}
    </span>
  );
}
