'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TotemView } from '@delivery360/shared';
import { ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Cadastro dos totens da loja (dono e gerente). Cada totem tem o seu endereço; abra no aparelho
 * em tela cheia. Sem maquininha integrada: o cliente pega a senha e paga no caixa.
 */
export function TotemSettings() {
  const [list, setList] = useState<TotemView[] | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api<TotemView[]>('/cardapio/pdv/totens', { tenant: true }), api<{ slug: string }>('/cardapio/store', { tenant: true })]);
      setList(t);
      setSlug(s.slug);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const url = (t: TotemView) => `${typeof window !== 'undefined' ? window.location.origin : ''}/totem/${slug}?t=${t.id}`;

  async function save(id: string | null, body: Partial<TotemView>) {
    setError(null);
    try {
      await api(id ? `/cardapio/pdv/totens/${id}` : '/cardapio/pdv/totens', { method: id ? 'PATCH' : 'POST', tenant: true, body });
      if (!id) setName('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!list) return error ? <ErrorBox message={error} /> : <Spinner />;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-2 text-sm text-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900">Como funciona</h2>
        <p>1. O cliente monta o pedido no totem e recebe uma <b>senha</b>.</p>
        <p>2. Ele paga no caixa (maquininha comum, Pix ou dinheiro). O pedido aparece no topo da tela <b>Vender</b>.</p>
        <p>3. O caixa toca em <b>Receber</b> e registra o que entrou. Só aí o pedido vai para o painel e a cozinha.</p>
        <p className="text-xs text-zinc-500">No cupom e na comanda sai "Origem: Totem (autoatendimento)", a senha e se é para comer aqui ou levar.</p>
      </div>

      <ErrorBox message={error} />
      <ul className="space-y-3">
        {list.map((t) => (
          <li key={t.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t.name}</h3>
              <span className="flex items-center gap-2 text-sm">
                {t.active ? 'Ligado' : 'Desligado'} <Toggle checked={t.active} onChange={(v) => void save(t.id, { active: v })} />
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-2">Comer aqui <Toggle checked={t.eatIn} onChange={(v) => void save(t.id, { eatIn: v })} /></span>
              <span className="flex items-center gap-2">Levar <Toggle checked={t.takeaway} onChange={(v) => void save(t.id, { takeaway: v })} /></span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-zinc-100 px-2 py-1 text-xs">{url(t)}</code>
              <button
                className="btn-ghost px-3 py-1 text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(url(t));
                  setCopied(t.id);
                }}
              >
                {copied === t.id ? 'Copiado' : 'Copiar endereço'}
              </button>
              <a className="btn-ghost px-3 py-1 text-sm" href={url(t)} target="_blank" rel="noreferrer">
                Abrir
              </a>
            </div>
          </li>
        ))}
      </ul>

      <form
        className="card flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(null, { name });
        }}
      >
        <label className="block min-w-48 flex-1">
          <span className="label">Novo totem</span>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Totem da entrada" />
        </label>
        <button className="btn-primary" disabled={name.trim().length < 2}>
          Cadastrar
        </button>
      </form>
      <p className="text-xs text-zinc-500">Sem cadastro, /totem/{slug || 'sua-loja'} continua abrindo o modo demonstração (não cria pedido).</p>
    </div>
  );
}
