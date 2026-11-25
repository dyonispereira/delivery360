'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CHANNEL_LABELS,
  channelSheets,
  COST_KIND_LABELS,
  costSheet,
  DEFAULT_RATES,
  formatBRL,
  parseBRL,
  type ChannelConfig,
  type ChannelPrices,
  type CostItem,
  type CostItemKind,
  type FinanceRates,
} from '@delivery360/shared';

export type RatesInfo = FinanceRates & { configured: boolean; channels?: ChannelConfig[] };

interface Row {
  name: string;
  kind: CostItemKind;
  text: string;
}

const toText = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const pctText = (bps: number) => (bps ? (bps / 100).toString().replace('.', ',') : '');
const fmtPct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/**
 * Ficha técnica do produto: custo de cada item (ingredientes, embalagem, outros), mais impostos,
 * taxas e outras despesas, chegando no lucro em R$ e no % de resultado, ao vivo.
 */
export function CostSheetEditor({
  priceCents,
  items,
  extraCostBps,
  rates,
  channelPrices = {},
  onChange,
}: {
  priceCents: number;
  channelPrices?: ChannelPrices;
  items: CostItem[];
  extraCostBps: number;
  rates: RatesInfo | null;
  onChange: (items: CostItem[], extraCostBps: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => items.map((i) => ({ name: i.name, kind: i.kind, text: toText(i.costCents) })));
  const [extraText, setExtraText] = useState(pctText(extraCostBps));
  const r = rates ?? { ...DEFAULT_RATES, configured: false };

  const parsed = (list: Row[]): CostItem[] => list.map((x) => ({ name: x.name, kind: x.kind, costCents: parseBRL(x.text || '0') ?? 0 }));
  const extraBps = Math.round((Number(extraText.replace(',', '.')) || 0) * 100);
  const update = (list: Row[], extra = extraBps) => {
    setRows(list);
    onChange(parsed(list), extra);
  };
  const s = costSheet(priceCents, parsed(rows), r, extraBps);
  const taxFee = r.salesTaxBps + Math.max(r.pixFeeBps, r.creditFeeBps, r.cardOnDeliveryFeeBps);
  const health = {
    good: ['bg-emerald-50 text-emerald-800', 'CMV saudável (até 30% do preço)'],
    attention: ['bg-amber-50 text-amber-900', 'CMV no limite (30% a 40%): acompanhe'],
    high: ['bg-red-50 text-red-800', 'CMV alto (acima de 40%): reveja preço ou ficha'],
    none: ['bg-zinc-100 text-zinc-600', 'Cadastre os itens para ver o custo'],
  }[s.cmvHealth];

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-3" aria-label="Ficha técnica">
      <div>
        <h3 className="font-semibold">Ficha técnica (CMV)</h3>
        <p className="text-xs text-zinc-500">Custo de cada item usado em 1 unidade. Ex.: pão R$ 3,00, hambúrguer R$ 5,00, queijo R$ 1,00, embalagem R$ 0,30.</p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_7.5rem_5.5rem_auto] items-center gap-1.5">
            <input
              className="input px-2 py-1.5 text-sm"
              aria-label={`Item ${i + 1}`}
              placeholder="Item"
              value={row.name}
              onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <select
              className="input px-1 py-1.5 text-xs"
              aria-label={`Tipo do item ${i + 1}`}
              value={row.kind}
              onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as CostItemKind } : x)))}
            >
              {(Object.keys(COST_KIND_LABELS) as CostItemKind[]).map((k) => (
                <option key={k} value={k}>{COST_KIND_LABELS[k]}</option>
              ))}
            </select>
            <input
              className="input px-2 py-1.5 text-right text-sm"
              aria-label={`Custo do item ${i + 1}`}
              inputMode="decimal"
              placeholder="0,00"
              value={row.text}
              onChange={(e) => update(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
            <button type="button" className="px-1 text-zinc-400 hover:text-red-600" aria-label={`Remover item ${i + 1}`} onClick={() => update(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => update([...rows, { name: '', kind: 'INGREDIENT', text: '' }])}>
            + Ingrediente
          </button>
          <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => update([...rows, { name: 'Embalagem', kind: 'PACKAGING', text: '' }])}>
            + Embalagem
          </button>
          <button type="button" className="text-[var(--brand)] hover:underline" onClick={() => update([...rows, { name: '', kind: 'OTHER', text: '' }])}>
            + Outro custo
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="extra-pct" className="flex-1 text-zinc-600">
          Outras despesas deste produto (%)
          <span className="block text-xs text-zinc-400">Ex.: comissão de garçom, gás do forno. Opcional.</span>
        </label>
        <input
          id="extra-pct"
          className="input w-20 px-2 py-1.5 text-right"
          inputMode="decimal"
          placeholder="0"
          value={extraText}
          onChange={(e) => {
            setExtraText(e.target.value);
            onChange(parsed(rows), Math.round((Number(e.target.value.replace(',', '.')) || 0) * 100));
          }}
        />
      </div>

      <dl className="space-y-1 rounded-lg bg-zinc-50 p-3 text-sm">
        <Line label="Preço de venda" value={formatBRL(priceCents)} />
        <Line label={`Ingredientes`} value={`− ${formatBRL(s.ingredientsCents)}`} />
        {s.packagingCents > 0 && <Line label="Embalagem" value={`− ${formatBRL(s.packagingCents)}`} />}
        {s.otherDirectCents > 0 && <Line label="Outros custos diretos" value={`− ${formatBRL(s.otherDirectCents)}`} />}
        <Line label={`CMV (${fmtPct(s.cmvPct)} do preço)`} value={formatBRL(s.cmvCents)} strong />
        <Line
          label={`Impostos e taxas (${fmtPct(taxFee / 100)})${extraBps ? ` + outras (${fmtPct(extraBps / 100)})` : ''}`}
          value={`− ${formatBRL(s.variableCents)}`}
        />
        <div className="my-1 border-t border-zinc-200" />
        <Line
          label="Lucro por unidade"
          value={formatBRL(s.profitCents)}
          strong
          tone={s.profitCents < 0 ? 'text-red-600' : 'text-emerald-700'}
        />
        <Line label="% de resultado" value={fmtPct(s.resultPct)} strong tone={s.profitCents < 0 ? 'text-red-600' : 'text-emerald-700'} />
      </dl>

      <p className={`rounded-lg px-3 py-2 text-xs font-medium ${health[0]}`}>{health[1]}</p>
      {s.suggestedPriceCents !== null && (
        <p className="text-xs text-zinc-600">
          Preço sugerido para {fmtPct(r.targetMarginBps / 100)} de resultado: <b>{formatBRL(s.suggestedPriceCents)}</b>
          {s.suggestedPriceCents > priceCents ? ' (acima do preço atual)' : ''}
        </p>
      )}
      <ChannelResults priceCents={priceCents} items={parsed(rows)} rates={r} extraBps={extraBps} prices={channelPrices} />
      {!r.configured && (
        <p className="text-xs text-amber-800">
          Impostos e taxas ainda não configurados (contando 0%).{' '}
          <Link href="/app/gestao?aba=impostos" className="underline">Configurar em Gestão</Link>
        </p>
      )}
    </section>
  );
}

function Line({ label, value, strong, tone = '' }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'font-semibold' : 'text-zinc-600'} ${tone}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** Mesmo produto, resultado diferente em cada canal: o app cobra comissão e taxa e pode ter outro preço. */
function ChannelResults({ priceCents, items, rates, extraBps, prices }: { priceCents: number; items: CostItem[]; rates: RatesInfo; extraBps: number; prices: ChannelPrices }) {
  const channels = rates.channels ?? [];
  if (!channels.some((c) => c.active) || items.length === 0) return null;
  const rows = channelSheets(priceCents, items, rates, extraBps, channels, prices);
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">Resultado por canal</h4>
      <table className="w-full text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 text-left font-normal">Canal</th>
            <th className="text-right font-normal">Preço</th>
            <th className="text-right font-normal">Comissão</th>
            <th className="text-right font-normal">Lucro</th>
            <th className="text-right font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ channel, sheet, commissionCents }) => (
            <tr key={channel} className="border-t border-zinc-100">
              <td className="py-1">{CHANNEL_LABELS[channel]}</td>
              <td className="text-right">{formatBRL(sheet.priceCents)}</td>
              <td className="text-right text-zinc-500">{commissionCents ? `− ${formatBRL(commissionCents)}` : '—'}</td>
              <td className={`text-right font-medium ${sheet.profitCents < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatBRL(sheet.profitCents)}</td>
              <td className={`text-right ${sheet.profitCents < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtPct(sheet.resultPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-zinc-500">No app conta a comissão e a taxa de pagamento do app (configure em Cardápio, aba Canais de venda).</p>
    </div>
  );
}
