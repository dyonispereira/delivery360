'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from './icons';

/** Reduz a foto no navegador (lado maior até `max` px) e devolve em WebP, ou JPEG se o navegador não gerar WebP. */
async function shrink(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('Não consegui abrir esta imagem. Use JPG, PNG ou WebP.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Seu navegador não conseguiu preparar a foto.');
    ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco (como foto de cardápio)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.86);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Campo de imagem: enviar foto do computador ou celular (reduzida antes de subir) ou colar um link.
 * `endpoint`: '/cardapio/uploads' (restaurante) ou '/admin/uploads' (equipe Delivery360).
 */
export function ImageField({
  id,
  value,
  onChange,
  disabled,
  endpoint = '/cardapio/uploads',
  aspect = 'aspect-square',
  max = 1600,
  hint,
}: {
  id?: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  endpoint?: '/cardapio/uploads' | '/admin/uploads';
  /** Formato da prévia (ex.: 'aspect-square', 'aspect-[3/1]'). */
  aspect?: string;
  max?: number;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const hasImage = /^(https?:\/\/|\/)\S+$/.test(value.trim());

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setError('Escolha uma foto (JPG, PNG ou WebP).');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await shrink(file, max);
      const res = await api<{ url: string }>(endpoint, { method: 'POST', body: { dataUrl }, tenant: endpoint === '/cardapio/uploads' });
      onChange(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui enviar a foto.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          className={`group relative w-28 shrink-0 overflow-hidden rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 transition hover:border-orange-300 disabled:opacity-60 ${aspect}`}
          aria-label={hasImage ? 'Trocar foto' : 'Enviar foto'}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-zinc-400">
              <Icon name="spark" className="h-6 w-6" /> Sem foto
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/70">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-[var(--brand)]" />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary py-1.5" disabled={disabled || busy} onClick={() => input.current?.click()}>
              {busy ? 'Enviando...' : hasImage ? 'Trocar foto' : 'Enviar foto'}
            </button>
            {hasImage && !disabled && (
              <button type="button" className="btn-ghost py-1.5" disabled={busy} onClick={() => onChange('')}>
                Remover
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">{hint ?? 'JPG, PNG ou WebP. A foto é reduzida automaticamente antes de enviar.'}</p>
          {!showLink ? (
            <button type="button" className="text-xs font-medium text-orange-600 hover:underline" onClick={() => setShowLink(true)} disabled={disabled}>
              Ou colar o link de uma imagem
            </button>
          ) : (
            <input id={id} className="input" disabled={disabled} placeholder="https://..." value={value} onChange={(e) => onChange(e.target.value)} />
          )}
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}
