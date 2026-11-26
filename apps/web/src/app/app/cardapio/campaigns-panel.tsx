'use client';

import { useEffect, useState } from 'react';
import { Badge, ErrorBox, Toggle } from '@/components/ui';
import { BannerPreview, splitLabel } from '@/components/campaign-banner';
import { api } from '@/lib/api';

interface TenantCampaign {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  startsAt: string | null;
  endsAt: string | null;
  couponCode: string | null;
  label: string | null;
  platformShareBps: number;
  participating: boolean;
  canOptOut: boolean;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Campanhas da Delivery360 que passam nesta loja. O restaurante não edita nenhuma;
 * só pode sair (e voltar) das que têm cupom com custo para ele.
 */
export function CampaignsPanel({ canEdit }: { canEdit: boolean }) {
  const [list, setList] = useState<TenantCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<TenantCampaign[]>('/cardapio/campaigns', { tenant: true })
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(c: TenantCampaign, participating: boolean) {
    setError(null);
    try {
      await api(`/cardapio/campaigns/${c.id}/participation`, { method: 'PUT', body: { participating }, tenant: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro.');
    }
  }

  if (!list || list.length === 0) return error ? <ErrorBox message={error} /> : null;

  return (
    <div className="card max-w-3xl space-y-4">
      <div>
        <h2 className="font-semibold">Campanhas da Delivery360 na sua loja</h2>
        <p className="text-sm text-zinc-500">
          A Delivery360 cria os banners que aparecem no topo da sua loja. Os de divulgação ficam sempre. Se a campanha tem cupom com custo para você, dá para
          recusar aqui.
        </p>
      </div>
      <ErrorBox message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <div key={c.id} className={`space-y-2 ${c.participating ? '' : 'opacity-60'}`}>
            <BannerPreview title={c.title} subtitle={c.subtitle ?? ''} imageUrl={c.imageUrl} code={c.couponCode} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {c.couponCode ? <Badge tone={c.canOptOut ? 'amber' : 'green'}>{splitLabel(c.platformShareBps)}</Badge> : <Badge tone="green">Divulgação</Badge>}
              {c.label && <span className="text-zinc-600">{c.label}</span>}
              {c.endsAt && <span className="text-xs text-zinc-500">até {shortDate(c.endsAt)}</span>}
            </div>
            {c.canOptOut ? (
              <label className="flex items-center gap-3 text-sm">
                <Toggle checked={c.participating} disabled={!canEdit} onChange={(v) => void toggle(c, v)} />
                {c.participating ? 'Participando' : 'Você recusou esta campanha'}
              </label>
            ) : (
              <p className="text-xs text-zinc-500">Sem custo para você: fica sempre na loja.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
