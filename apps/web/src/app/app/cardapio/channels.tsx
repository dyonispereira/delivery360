'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CHANNEL_LABELS, type ChannelConfig } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import type { Category } from './types';

const pctText = (bps: number) => (bps / 100).toString().replace('.', ',');
const pctBps = (t: string) => {
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

/** Exemplos de mercado para ajudar a preencher (cada restaurante confere no seu contrato). */
const HINTS: Record<string, string> = {
  IFOOD: 'Plano Básico (entrega própria) costuma ser 12% + 3,2% do pagamento online; Plano Entrega, 23% + 3,2%.',
  FOOD99: 'Confira a comissão e a taxa no contrato da 99Food.',
  KEETA: 'Confira a comissão e a taxa no contrato da Keeta.',
};

/**
 * Canais de venda: iFood, 99Food e Keeta. Cada pedido de app entra pelo código PDV do produto,
 * vai para a cozinha como os outros e gera a receita na conta do app, com comissão e repasse.
 */
export function ChannelsEditor() {
  const [channels, setChannels] = useState<ChannelConfig[] | null>(null);
  const [withoutPdv, setWithoutPdv] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ChannelConfig[]>('/cardapio/canais', { tenant: true }).then(setChannels).catch((e) => setError(e.message));
    api<Category[]>('/cardapio/menu', { tenant: true })
      .then((menu) => setWithoutPdv(menu.flatMap((c) => c.products).filter((p) => p.active && !p.pdvCode).map((p) => p.name)))
      .catch(() => undefined);
  }, []);

  if (!channels) return error ? <ErrorBox message={error} /> : <Spinner />;
  return (
    <div className="space-y-4">
      <div className="card max-w-3xl space-y-2 text-sm text-zinc-700">
        <h2 className="font-semibold text-zinc-900">Como funciona</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Cadastre o <b>código PDV</b> em cada produto (aba Cardápio) e use o mesmo código no portal do iFood, da 99Food e da Keeta.
          </li>
          <li>Ative abaixo os apps em que você vende e informe a comissão, a taxa do pagamento online e em quantos dias o app repassa.</li>
          <li>
            O pedido do app entra no painel e na cozinha como os outros. No financeiro, a venda vai para a conta do app (iFood, 99Food ou Keeta), com a comissão e a
            taxa lançadas e o recebimento previsto para o dia do repasse.
          </li>
        </ol>
        {withoutPdv.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {withoutPdv.length} produto(s) ainda sem código PDV: {withoutPdv.slice(0, 6).join(', ')}
            {withoutPdv.length > 6 ? '...' : ''}
          </p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {channels.map((c) => (
          <ChannelCard key={c.channel} config={c} onSaved={setChannels} />
        ))}
      </div>
    </div>
  );
}

function ChannelCard({ config, onSaved }: { config: ChannelConfig; onSaved: (list: ChannelConfig[]) => void }) {
  const label = CHANNEL_LABELS[config.channel];
  const [form, setForm] = useState({
    active: config.active,
    merchantId: config.merchantId ?? '',
    commission: pctText(config.commissionBps),
    fee: pctText(config.paymentFeeBps),
    payoutDays: String(config.payoutDays),
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const commissionBps = pctBps(form.commission || '0');
    const paymentFeeBps = pctBps(form.fee || '0');
    const payoutDays = Number(form.payoutDays || '0');
    if ([commissionBps, paymentFeeBps].some(Number.isNaN) || !Number.isInteger(payoutDays)) return setError('Confira os números.');
    setBusy(true);
    try {
      onSaved(
        await api<ChannelConfig[]>(`/cardapio/canais/${config.channel}`, {
          method: 'PUT',
          tenant: true,
          body: { active: form.active, merchantId: form.merchantId, commissionBps, paymentFeeBps, payoutDays },
        }),
      );
      setNotice('Salvo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ number: number; unmatched: string[] }>(`/cardapio/canais/${config.channel}/simular`, { method: 'POST', tenant: true });
      setNotice(`Pedido de teste #${r.number} do ${label} criado. Veja em Pedidos e no financeiro.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao simular.');
    }
  }

  return (
    <form onSubmit={save} className="card space-y-3" aria-label={label}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-semibold">{label}</h3>
        <span className="text-xs text-zinc-500">{form.active ? 'Ativo' : 'Desligado'}</span>
        <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-zinc-500" htmlFor={`com-${config.channel}`}>Comissão (%)</label>
          <input id={`com-${config.channel}`} className="input" inputMode="decimal" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-zinc-500" htmlFor={`fee-${config.channel}`}>Taxa pagamento online (%)</label>
          <input id={`fee-${config.channel}`} className="input" inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-zinc-500" htmlFor={`days-${config.channel}`}>Repasse em (dias)</label>
          <input id={`days-${config.channel}`} className="input" inputMode="numeric" value={form.payoutDays} onChange={(e) => setForm({ ...form, payoutDays: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-zinc-500" htmlFor={`mid-${config.channel}`}>Código da loja no app</label>
          <input id={`mid-${config.channel}`} className="input" placeholder="merchant id" value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-zinc-500">{HINTS[config.channel]}</p>
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        Integração automática: pronta para conectar assim que tivermos o acesso de parceiro do {label}. Até lá, use o pedido de teste para ver o caminho completo.
      </p>
      <ErrorBox message={error} />
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
        <button type="button" className="btn-ghost" onClick={simulate}>Simular pedido</button>
        <Link href="/app/gestao?aba=canais" className="btn-ghost">Ver resultado</Link>
      </div>
    </form>
  );
}
