/** Desenho do banner de campanha (o mesmo da loja), usado no admin e no painel do restaurante. */

const pct = (bps: number) => `${String(bps / 100).replace('.', ',')}%`;

/** "50% Delivery360 · 50% restaurante". */
export const splitLabel = (bps: number) =>
  bps >= 10_000 ? '100% Delivery360' : bps <= 0 ? '100% restaurante' : `${pct(bps)} Delivery360 · ${pct(10_000 - bps)} restaurante`;

/** O mesmo desenho do banner na loja. */
export function BannerPreview({ title, subtitle, imageUrl, code }: { title: string; subtitle: string; imageUrl: string; code: string | null }) {
  return (
    <div className="relative aspect-[16/7] w-full overflow-hidden rounded-2xl bg-zinc-200">
      {/^(https?:\/\/|\/)/.test(imageUrl) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
      <div className="relative flex h-full max-w-[70%] flex-col justify-end gap-1 p-4 text-white">
        <p className="text-lg font-bold leading-tight">{title}</p>
        {subtitle && <p className="text-sm text-white/90">{subtitle}</p>}
        {code && <span className="mt-1 w-fit rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-900">Usar cupom {code}</span>}
      </div>
    </div>
  );
}
