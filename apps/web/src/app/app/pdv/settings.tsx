'use client';

import { useEffect, useState } from 'react';
import { type ReceiptKind } from '@delivery360/shared';
import { Badge, ErrorBox, Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';

interface Fiscal {
  enabled: boolean;
  provider: string;
  providerLabel: string;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  cnpj: string | null;
  stateRegistration: string | null;
  legalName: string | null;
  uf: string | null;
  taxRegime: number;
  cscId: string | null;
  hasCscToken: boolean;
  series: number;
  nextNumber: number;
  defaultNcm: string;
  defaultCfop: string;
  defaultCsosn: string;
  pdvReceipt: ReceiptKind;
  missing: string[];
}
interface Printers {
  receiptWidthMm: number;
  kitchenWidthMm: number;
  receiptAutoPrint: boolean;
  receiptCopies: number;
  receiptFooter: string | null;
}

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/** Dados fiscais (NFC-e), cupom padrão do PDV e impressoras térmicas. Só dono e gerente. */
export function PdvSettings({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FiscalForm onSaved={onSaved} />
      <PrinterForm />
    </div>
  );
}

function FiscalForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState<Fiscal | null>(null);
  const [csc, setCsc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Fiscal>('/cardapio/pdv/fiscal', { tenant: true }).then(setF).catch((e) => setError((e as Error).message));
  }, []);
  if (!f) return error ? <ErrorBox message={error} /> : <Spinner />;
  const set = (patch: Partial<Fiscal>) => {
    setOk(false);
    setF({ ...f, ...patch });
  };

  async function save() {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Fiscal>('/cardapio/pdv/fiscal', {
        method: 'PUT',
        tenant: true,
        body: {
          enabled: f.enabled,
          environment: f.environment,
          cnpj: f.cnpj?.replace(/\D/g, '') || undefined,
          stateRegistration: f.stateRegistration?.replace(/[^\dA-Za-z]/g, '').toUpperCase() || undefined,
          legalName: f.legalName?.trim() || undefined,
          uf: f.uf || undefined,
          taxRegime: f.taxRegime,
          cscId: f.cscId || undefined,
          cscToken: csc.trim() || undefined,
          series: f.series,
          nextNumber: f.nextNumber,
          defaultNcm: f.defaultNcm,
          defaultCfop: f.defaultCfop,
          defaultCsosn: f.defaultCsosn,
          pdvReceipt: f.pdvReceipt,
        },
      });
      setF(saved);
      setCsc('');
      setOk(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Nota fiscal (NFC-e)</h2>
          <p className="text-sm text-zinc-500">Dados do restaurante para a nota de consumidor. Quem não quer emitir nota usa só o cupom não fiscal.</p>
        </div>
        <Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        <Badge tone="amber">Emissor: {f.providerLabel}</Badge>
        <span>Por enquanto as notas saem em homologação (teste, sem valor fiscal). O emissor real entra quando for contratado.</span>
      </div>
      {f.enabled && f.missing.length > 0 && <p className="text-sm text-amber-700">Falta preencher: {f.missing.join(', ')}.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CNPJ">
          <input className="input" inputMode="numeric" value={f.cnpj ?? ''} onChange={(e) => set({ cnpj: e.target.value })} placeholder="Só números" />
        </Field>
        <Field label="Inscrição estadual">
          <input className="input" value={f.stateRegistration ?? ''} onChange={(e) => set({ stateRegistration: e.target.value })} placeholder="Ou ISENTO" />
        </Field>
        <Field label="Razão social" wide>
          <input className="input" value={f.legalName ?? ''} maxLength={120} onChange={(e) => set({ legalName: e.target.value })} />
        </Field>
        <Field label="UF">
          <select className="input" value={f.uf ?? ''} onChange={(e) => set({ uf: e.target.value || null })}>
            <option value="">Escolha</option>
            {UFS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="Regime tributário">
          <select className="input" value={f.taxRegime} onChange={(e) => set({ taxRegime: Number(e.target.value) })}>
            <option value={1}>Simples Nacional</option>
            <option value={2}>Simples (excesso de sublimite)</option>
            <option value={3}>Regime normal</option>
          </select>
        </Field>
        <Field label="ID do CSC">
          <input className="input" inputMode="numeric" value={f.cscId ?? ''} onChange={(e) => set({ cscId: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 000001" />
        </Field>
        <Field label={f.hasCscToken ? 'CSC (já salvo; preencha para trocar)' : 'CSC (código da SEFAZ)'}>
          <input className="input" type="password" autoComplete="off" value={csc} onChange={(e) => setCsc(e.target.value)} placeholder={f.hasCscToken ? '••••••••' : 'Gerado no site da SEFAZ'} />
        </Field>
        <Field label="Série">
          <input className="input" inputMode="numeric" value={f.series} onChange={(e) => set({ series: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </Field>
        <Field label="Próximo número">
          <input className="input" inputMode="numeric" value={f.nextNumber} onChange={(e) => set({ nextNumber: Number(e.target.value.replace(/\D/g, '')) || 1 })} />
        </Field>
        <Field label="NCM padrão">
          <input className="input" inputMode="numeric" maxLength={8} value={f.defaultNcm} onChange={(e) => set({ defaultNcm: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="CFOP padrão">
          <input className="input" inputMode="numeric" maxLength={4} value={f.defaultCfop} onChange={(e) => set({ defaultCfop: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="CSOSN / CST padrão">
          <input className="input" inputMode="numeric" maxLength={3} value={f.defaultCsosn} onChange={(e) => set({ defaultCsosn: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Cupom que já vem marcado no PDV">
          <select className="input" value={f.pdvReceipt} onChange={(e) => set({ pdvReceipt: e.target.value as ReceiptKind })}>
            <option value="NAO_FISCAL">Cupom não fiscal</option>
            <option value="NFCE">NFC-e</option>
          </select>
        </Field>
      </div>
      <p className="text-xs text-zinc-500">
        NCM e CFOP de cada produto ficam no cadastro do produto (Cardápio). Sem valor próprio, vale o padrão daqui. Confirme os códigos com o seu contador.
      </p>
      <ErrorBox message={error} />
      {ok && <p className="text-sm text-emerald-700">Dados fiscais salvos.</p>}
      <button className="btn-primary" disabled={busy} onClick={save}>
        {busy ? 'Salvando...' : 'Salvar dados fiscais'}
      </button>
    </section>
  );
}

function PrinterForm() {
  const [p, setP] = useState<Printers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Printers>('/cardapio/store', { tenant: true }).then(setP).catch((e) => setError((e as Error).message));
  }, []);
  if (!p) return error ? <ErrorBox message={error} /> : <Spinner />;
  const set = (patch: Partial<Printers>) => {
    setOk(false);
    setP({ ...p, ...patch });
  };
  async function save() {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await api('/cardapio/store', {
        method: 'PUT',
        tenant: true,
        body: { receiptWidthMm: p.receiptWidthMm, kitchenWidthMm: p.kitchenWidthMm, receiptAutoPrint: p.receiptAutoPrint, receiptCopies: p.receiptCopies, receiptFooter: p.receiptFooter ?? '' },
      });
      setOk(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const Width = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="grid grid-cols-2 gap-2">
      {[58, 80].map((w) => (
        <button key={w} type="button" onClick={() => onChange(w)} className={`rounded-xl border px-3 py-2 text-sm ${value === w ? 'border-[var(--brand)] bg-orange-50 font-semibold' : 'border-zinc-200'}`}>
          {w} mm
        </button>
      ))}
    </div>
  );
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold">Impressoras térmicas</h2>
        <p className="text-sm text-zinc-500">
          O cupom e a comanda saem pela janela de impressão do navegador. Na primeira vez, escolha a impressora térmica como padrão: o navegador lembra.
        </p>
      </div>
      <div role="group" aria-label="Papel da impressora do caixa">
        <span className="label">Impressora do caixa (cupom não fiscal e NFC-e)</span>
        <Width value={p.receiptWidthMm} onChange={(v) => set({ receiptWidthMm: v })} />
      </div>
      <div role="group" aria-label="Papel da impressora da cozinha">
        <span className="label">Impressora da cozinha (comanda)</span>
        <Width value={p.kitchenWidthMm} onChange={(v) => set({ kitchenWidthMm: v })} />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>
          <b>Imprimir o cupom ao finalizar a venda</b>
          <span className="block text-xs text-zinc-500">Desligado, o caixa imprime só quando o cliente pedir.</span>
        </span>
        <Toggle checked={p.receiptAutoPrint} onChange={(v) => set({ receiptAutoPrint: v })} />
      </div>
      <Field label="Vias do cupom">
        <select className="input" value={p.receiptCopies} onChange={(e) => set({ receiptCopies: Number(e.target.value) })}>
          <option value={1}>1 via</option>
          <option value={2}>2 vias</option>
          <option value={3}>3 vias</option>
        </select>
      </Field>
      <Field label="Mensagem no rodapé do cupom">
        <input className="input" maxLength={200} value={p.receiptFooter ?? ''} onChange={(e) => set({ receiptFooter: e.target.value })} placeholder="Ex.: Obrigado! Volte sempre" />
      </Field>
      <ErrorBox message={error} />
      {ok && <p className="text-sm text-emerald-700">Impressoras salvas.</p>}
      <button className="btn-primary" disabled={busy} onClick={save}>
        {busy ? 'Salvando...' : 'Salvar impressoras'}
      </button>
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
