'use client';

import { useEffect, useState } from 'react';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface Rates {
  salesTaxBps: number;
  pixFeeBps: number;
  creditFeeBps: number;
  cardOnDeliveryFeeBps: number;
  targetMarginBps: number;
  taxDueDay: number;
}

const FIELDS: { key: keyof Rates; label: string; hint: string; pct: boolean }[] = [
  { key: 'salesTaxBps', label: 'Imposto sobre a venda (%)', hint: 'Ex.: alíquota do Simples Nacional. Confirme com o seu contador.', pct: true },
  { key: 'pixFeeBps', label: 'Taxa do PIX (%)', hint: 'Cobrada pelo banco ou gateway.', pct: true },
  { key: 'creditFeeBps', label: 'Taxa do cartão online (%)', hint: 'Cartão pago pela loja online.', pct: true },
  { key: 'cardOnDeliveryFeeBps', label: 'Taxa da maquininha (%)', hint: 'Cartão na entrega ou no balcão.', pct: true },
  { key: 'targetMarginBps', label: 'Meta de resultado por produto (%)', hint: 'Usada no preço sugerido da ficha técnica.', pct: true },
  { key: 'taxDueDay', label: 'Dia do vencimento do imposto', hint: 'No mês seguinte à venda (ex.: DAS no dia 20).', pct: false },
];

const toText = (v: number, pct: boolean) => (pct ? (v / 100).toString().replace('.', ',') : String(v));
const fromText = (t: string, pct: boolean) => {
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? (pct ? Math.round(n * 100) : Math.round(n)) : NaN;
};

/** Impostos e taxas: entram na ficha técnica dos produtos e viram lançamentos em cada venda. */
export function Settings() {
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Rates>('/gestao/settings', { tenant: true })
      .then((r) => setForm(Object.fromEntries(FIELDS.map((f) => [f.key, toText(r[f.key], f.pct)]))))
      .catch((e) => setError(e.message));
  }, []);

  if (!form) return error ? <ErrorBox message={error} /> : <Spinner />;
  return (
    <form
      className="card max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        const body: Record<string, number> = {};
        for (const f of FIELDS) {
          const v = fromText(form[f.key] || '0', f.pct);
          if (Number.isNaN(v)) return setError(`Valor inválido em "${f.label}".`);
          body[f.key] = v;
        }
        try {
          await api('/gestao/settings', { method: 'PUT', tenant: true, body });
          setSaved(true);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div>
        <h2 className="font-semibold">Impostos e taxas</h2>
        <p className="text-sm text-zinc-500">
          Usados na ficha técnica (lucro de cada produto) e lançados sozinhos a cada venda: a taxa conforme a forma de pagamento que o cliente escolheu e o imposto
          como conta a pagar no mês seguinte.
        </p>
      </div>
      {FIELDS.map((f) => (
        <div key={f.key} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem]">
          <label htmlFor={`s-${f.key}`} className="text-sm">
            {f.label}
            <span className="block text-xs text-zinc-500">{f.hint}</span>
          </label>
          <input
            id={`s-${f.key}`}
            className="input text-right"
            inputMode="decimal"
            value={form[f.key]}
            onChange={(e) => {
              setSaved(false);
              setForm({ ...form, [f.key]: e.target.value });
            }}
          />
        </div>
      ))}
      <ErrorBox message={error} />
      <div className="flex items-center gap-3">
        <button className="btn-primary">Salvar</button>
        {saved && <span className="text-sm text-emerald-700">Salvo. Vale para as próximas vendas.</span>}
      </div>
    </form>
  );
}
