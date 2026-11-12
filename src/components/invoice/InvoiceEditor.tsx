import React from 'react';
import { ClipboardList, User, Car, Wrench, Package, Settings2, StickyNote, Plus, X, ListChecks } from 'lucide-react';
import type { FeeKind, FeeLine, Invoice, InvoiceStatus, LaborItem, PartItem } from '../../invoice/types';
import { FEE_KINDS, INVOICE_STATUSES, statusLabel } from '../../invoice/types';
import { addLaborItem, addPartItem, createId, removeLaborItem, removePartItem, updateLaborItem, updatePartItem } from '../../invoice/model';
import { calculateTotals } from '../../invoice/totals';
import { formatCurrency } from '../../invoice/format';
import { validateVin } from '../../invoice/vin';
import { geOf } from '../../invoice/ge';
import { detailSetFor, type DetailSet, type FeeTemplate } from '../../invoice/settings';
import { applyDetailSet } from '../../invoice/detailSets';
import type { JobIntake } from '../../invoice/intake';
import { Btn, Card, Field, NumIn, TextIn, inputCls, StatusBadge } from './ui';

/**
 * The editor column: the document's details, customer, the user's own detail fields (or the original vehicle box for old-format
 * documents), labor and parts tables, discount / tax / **fee lines**, with the live breakdown. The shop is NOT edited here: it comes from
 * Settings → Invoices. Notes and terms are a separate card (`NotesCard`) so the workspace can place them under the preview.
 * `onChange` receives an updater over the immutable model functions. When `readOnly` (a member viewing the owner's invoice) every
 * control is disabled.
 */
export interface EditorProps {
  invoice: Invoice;
  onChange: (fn: (i: Invoice) => Invoice) => void;
  readOnly?: boolean;
  hourlyRate: number;
  /** Fields that came from the website's quote, shown as a marker. */
  fromWebsite?: { rates?: boolean };
  /** The user's saved fees, offered in "Add a saved fee". */
  feeTemplates?: FeeTemplate[];
  labels?: { travel: string; supplies: string };
  /** The user's detail-field presets, offered in "Apply detail fields". */
  detailSets?: DetailSet[];
  /** The job's intake, used to fill blanks of a preset when it is applied. */
  intake?: JobIntake | null;
}

const set = <K extends keyof Invoice>(k: K, patch: Partial<Invoice[K]>) => (i: Invoice): Invoice => ({ ...i, [k]: { ...(i[k] as object), ...patch } } as Invoice);
const KIND_LABEL: Record<FeeKind, string> = { flat: 'Flat amount ($)', percentOfLabor: '% of labor', percentOfSubtotal: '% of subtotal' };

export function VinBadge({ vin }: { vin: string }) {
  const r = validateVin(vin);
  if (!vin.trim()) return <p className="text-[11px] text-gray-500 mt-1">17 alphanumeric characters (excludes I, O, Q)</p>;
  return <p className={`text-[11px] mt-1 ${r.valid ? 'text-emerald-400' : 'text-red-400'}`}><span className="font-bold mr-1">{r.valid ? 'VALID VIN' : 'INVALID VIN'}</span>{r.valid ? 'Valid 17-character VIN' : (r as { reason: string }).reason}</p>;
}

export function NotesCard({ invoice: inv, onChange, readOnly = false }: Pick<EditorProps, 'invoice' | 'onChange' | 'readOnly'>) {
  return (
    <Card title="Notes & Terms" icon={<StickyNote className="w-4 h-4 text-[#7c3bed]" />}>
      <div className="space-y-3">
        <Field label="Customer Notes / Recommendations"><textarea disabled={readOnly} rows={3} className={inputCls} value={inv.notes.customerNotes} onChange={e => onChange(set('notes', { customerNotes: e.target.value }))} /></Field>
        <Field label="Terms & Conditions"><textarea disabled={readOnly} rows={4} className={inputCls} value={inv.notes.termsAndConditions} onChange={e => onChange(set('notes', { termsAndConditions: e.target.value }))} /></Field>
      </div>
    </Card>
  );
}

function FeesEditor({ invoice: inv, onChange, readOnly, feeTemplates = [] }: Pick<EditorProps, 'invoice' | 'onChange' | 'readOnly' | 'feeTemplates'>) {
  const fees = inv.fees ?? [];
  const upd = (id: string, patch: Partial<FeeLine>) => onChange(i => ({ ...i, fees: (i.fees ?? []).map(f => (f.id === id ? { ...f, ...patch } : f)) }));
  const have = new Set(fees.map(f => f.label.trim().toLowerCase()));
  const addable = feeTemplates.filter(t => !have.has(t.label.trim().toLowerCase()));
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" />Fees</span>
        <span className="flex gap-1.5">
          {addable.length > 0 && !readOnly && (
            <select aria-label="Add a saved fee" className={`${inputCls} !w-auto !py-1 text-xs`} value="" onChange={e => { const t = feeTemplates.find(x => x.id === e.target.value); if (t) onChange(i => ({ ...i, fees: [...(i.fees ?? []), { id: createId('fee'), label: t.label, kind: t.kind, value: t.value, cap: t.cap, taxable: t.taxable }] })); }}>
              <option value="">Add a saved fee…</option>{addable.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>)}
          <Btn size="sm" disabled={readOnly} onClick={() => onChange(i => ({ ...i, fees: [...(i.fees ?? []), { id: createId('fee'), label: 'Fee', kind: 'flat', value: 0, cap: 0, taxable: false }] }))}><Plus className="w-3.5 h-3.5" />Add fee</Btn>
        </span>
      </div>
      {fees.length === 0 && <p className="text-xs text-gray-500 py-2">No fees on this document. Add one, or save your usual fees in Settings → Invoices so they are added automatically.</p>}
      <div className="space-y-2">{fees.map(f => (
        <div key={f.id} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-12 sm:col-span-4"><TextIn disabled={readOnly} aria-label="Fee name" placeholder="Fee name" value={f.label} onChange={v => upd(f.id, { label: v })} /></div>
          <div className="col-span-5 sm:col-span-3"><select disabled={readOnly} aria-label="Fee type" className={inputCls} value={f.kind} onChange={e => upd(f.id, { kind: e.target.value as FeeKind })}>{FEE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="col-span-3 sm:col-span-2"><NumIn disabled={readOnly} aria-label="Fee value" step="0.01" min="0" value={f.value} onChange={v => upd(f.id, { value: v })} /></div>
          <div className="col-span-4 sm:col-span-2">{f.kind === 'flat' ? <label className="flex items-center gap-1.5 text-xs text-gray-300"><input disabled={readOnly} type="checkbox" checked={f.taxable} onChange={e => upd(f.id, { taxable: e.target.checked })} />taxable</label> : <NumIn disabled={readOnly} aria-label="Fee cap" step="1" min="0" placeholder="cap" title="Maximum amount (0 = no cap)" value={f.cap} onChange={v => upd(f.id, { cap: v })} />}</div>
          <button disabled={readOnly} aria-label="Remove fee" className="col-span-12 sm:col-span-1 text-gray-500 hover:text-red-400 flex justify-end" onClick={() => onChange(i => ({ ...i, fees: (i.fees ?? []).filter(x => x.id !== f.id) }))}><X className="w-4 h-4" /></button>
        </div>))}</div>
      {fees.some(f => f.kind !== 'flat') && <p className="text-[11px] text-gray-500 mt-1.5">Percentages apply to the labor subtotal or the subtotal before discount; the cap is the most the fee can be.</p>}
    </div>
  );
}

/**
 * "Apply detail fields…": choose one of the user's presets for this document. The preset that matches the document's number is marked.
 * Values already entered are kept, blanks are filled from the job, and typed values the preset has no field for stay below it.
 */
function DetailSetPicker({ invoice, sets, intake, onChange }: { invoice: Invoice; sets: DetailSet[]; intake: JobIntake | null; onChange: (fn: (i: Invoice) => Invoice) => void }) {
  if (sets.length === 0) return <span className="text-[11px] text-gray-500">Make presets in Settings → Invoices</span>;
  const linked = detailSetFor(sets, [invoice.meta.invoiceNumber]);
  const current = invoice.details?.setId;
  return (
    <select aria-label="Apply detail fields" className={`${inputCls} !w-auto !py-1 text-xs`} value="" onChange={e => { const set = sets.find(x => x.id === e.target.value); if (set) onChange(i => applyDetailSet(i, set, intake)); }}>
      <option value="">Apply detail fields…</option>
      {sets.map(x => <option key={x.id} value={x.id}>{x.name}{x.id === current ? ' (applied)' : ''}{x.id === linked?.id && x.id !== current ? ' (matches this number)' : ''}</option>)}
    </select>
  );
}

export function InvoiceEditor({ invoice: inv, onChange, readOnly = false, hourlyRate, fromWebsite, feeTemplates, labels, detailSets = [], intake = null }: EditorProps) {
  const totals = calculateTotals(inv);
  const aiIds = new Set(geOf(inv).ai?.lineIds ?? []);
  const dis = { disabled: readOnly };
  const money = formatCurrency;
  const docWord = inv.meta.docType === 'estimate' ? 'Estimate' : 'Invoice';
  const dynamic = Array.isArray(inv.fees);
  const setDetail = (key: string, value: string) => onChange(i => (i.details ? { ...i, details: { ...i.details, fields: i.details.fields.map(f => (f.key === key ? { ...f, value } : f)) } } : i));

  return (
    <div className="space-y-4">
      <Card title={`${docWord} Details`} icon={<ClipboardList className="w-4 h-4 text-[#7c3bed]" />} right={<StatusBadge status={inv.meta.status} docType={inv.meta.docType} />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label={`${docWord} #`}><TextIn {...dis} className="font-mono" value={inv.meta.invoiceNumber} onChange={v => onChange(set('meta', { invoiceNumber: v }))} /></Field>
          <Field label={`${docWord} Date`}><TextIn {...dis} type="date" value={inv.meta.date} onChange={v => onChange(set('meta', { date: v }))} /></Field>
          <Field label={inv.meta.docType === 'estimate' ? 'Valid Until' : 'Due Date'}><TextIn {...dis} type="date" value={inv.meta.dueDate} onChange={v => onChange(set('meta', { dueDate: v }))} /></Field>
          <Field label="Status">
            <select {...dis} className={inputCls} value={inv.meta.status} onChange={e => onChange(set('meta', { status: e.target.value as InvoiceStatus }))}>
              {INVOICE_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s, inv.meta.docType)}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Customer Information" icon={<User className="w-4 h-4 text-[#7c3bed]" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Customer Name"><TextIn {...dis} value={inv.customer.name} onChange={v => onChange(set('customer', { name: v }))} /></Field>
          <Field label="Phone"><TextIn {...dis} type="tel" value={inv.customer.phone} onChange={v => onChange(set('customer', { phone: v }))} /></Field>
          <Field label="Email"><TextIn {...dis} type="email" value={inv.customer.email} onChange={v => onChange(set('customer', { email: v }))} /></Field>
          <Field label="Street Address"><TextIn {...dis} value={inv.customer.address} onChange={v => onChange(set('customer', { address: v }))} /></Field>
        </div>
      </Card>

      {inv.details ? (
        // The user's own detail fields (Settings → Invoices → Detail field presets). The card shows when it has fields or presets exist to choose from.
        (inv.details.fields.length > 0 || (detailSets.length > 0 && !readOnly)) && (
          <Card title={inv.details.title || 'Details'} icon={<Car className="w-4 h-4 text-[#7c3bed]" />} right={readOnly ? undefined : <DetailSetPicker invoice={inv} sets={detailSets} intake={intake} onChange={onChange} />}>
            {inv.details.fields.length === 0 && <p className="text-xs text-gray-500">No detail fields on this document yet. Choose a preset above.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {inv.details.fields.map(f => (
                <div key={f.key}>
                  <Field label={f.label}><TextIn {...dis} className={f.type === 'vin' ? 'font-mono' : ''} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} maxLength={f.type === 'vin' ? 17 : 200} value={f.value} onChange={v => setDetail(f.key, v)} /></Field>
                  {f.type === 'vin' && <VinBadge vin={f.value} />}
                </div>))}
            </div>
          </Card>)
      ) : (
        <Card title="Vehicle Details" icon={<Car className="w-4 h-4 text-[#7c3bed]" />} right={readOnly ? undefined : <DetailSetPicker invoice={inv} sets={detailSets} intake={intake} onChange={onChange} />}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Field label="Year"><TextIn {...dis} value={inv.vehicle.year} onChange={v => onChange(set('vehicle', { year: v }))} /></Field>
            <Field label="Make"><TextIn {...dis} value={inv.vehicle.make} onChange={v => onChange(set('vehicle', { make: v }))} /></Field>
            <Field label="Model"><TextIn {...dis} value={inv.vehicle.model} onChange={v => onChange(set('vehicle', { model: v }))} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div><Field label="VIN (17 Characters)"><TextIn {...dis} className="font-mono" maxLength={17} value={inv.vehicle.vin} onChange={v => onChange(set('vehicle', { vin: v }))} /></Field><VinBadge vin={inv.vehicle.vin} /></div>
            <Field label="License Plate"><TextIn {...dis} className="font-mono" value={inv.vehicle.licensePlate} onChange={v => onChange(set('vehicle', { licensePlate: v }))} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Mileage (Odometer)"><TextIn {...dis} value={inv.vehicle.mileage} onChange={v => onChange(set('vehicle', { mileage: v }))} /></Field>
            <Field label="Engine / Trim"><TextIn {...dis} value={inv.vehicle.engine} onChange={v => onChange(set('vehicle', { engine: v }))} /></Field>
            <Field label="Service Advisor"><TextIn {...dis} value={inv.vehicle.serviceAdvisor} onChange={v => onChange(set('vehicle', { serviceAdvisor: v }))} /></Field>
          </div>
        </Card>
      )}

      <Card flush title="Labor & Services" icon={<Wrench className="w-4 h-4 text-[#7c3bed]" />}
        right={<Btn size="sm" {...dis} onClick={() => onChange(i => addLaborItem(i, { rate: hourlyRate }))}><Plus className="w-3.5 h-3.5" />Add Labor</Btn>}>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="px-3 py-2">Service Description</th><th className="px-2 py-2 w-36">Technician</th><th className="px-2 py-2 w-20">Hours</th><th className="px-2 py-2 w-24">Rate ($)</th><th className="px-2 py-2 w-24 text-right">Line Total</th><th className="w-10" /></tr></thead>
          <tbody>{inv.laborItems.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-gray-500 text-xs">No labor services added. Click “Add Labor” or choose a service package.</td></tr>}
            {inv.laborItems.map((l: LaborItem) => (
              <tr key={l.id} className={`border-t border-white/5 ${aiIds.has(l.id) ? 'border-l-2 border-l-violet-400 bg-violet-500/5' : ''}`}>
                <td className="px-3 py-1.5"><TextIn {...dis} placeholder="Service description" value={l.description} onChange={v => onChange(i => updateLaborItem(i, l.id, { description: v }))} /></td>
                <td className="px-2 py-1.5"><TextIn {...dis} placeholder="Technician" value={l.technician} onChange={v => onChange(i => updateLaborItem(i, l.id, { technician: v }))} /></td>
                <td className="px-2 py-1.5"><NumIn {...dis} step="0.1" min="0" value={l.hours} onChange={v => onChange(i => updateLaborItem(i, l.id, { hours: v }))} /></td>
                <td className="px-2 py-1.5"><NumIn {...dis} step="1" min="0" value={l.rate} onChange={v => onChange(i => updateLaborItem(i, l.id, { rate: v }))} /></td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-200">{money(l.hours * l.rate)}</td>
                <td className="px-1"><button {...dis} aria-label="Remove service row" className="text-gray-500 hover:text-red-400 p-1" onClick={() => onChange(i => removeLaborItem(i, l.id))}><X className="w-4 h-4" /></button></td>
              </tr>))}</tbody></table></div>
      </Card>

      <Card flush title="Parts & Materials" icon={<Package className="w-4 h-4 text-[#7c3bed]" />}
        right={<Btn size="sm" {...dis} onClick={() => onChange(i => addPartItem(i))}><Plus className="w-3.5 h-3.5" />Add Part</Btn>}>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="px-3 py-2 w-32">Part #</th><th className="px-2 py-2">Description</th><th className="px-2 py-2 w-20">Qty</th><th className="px-2 py-2 w-28">Unit Price ($)</th><th className="px-2 py-2 w-24 text-right">Line Total</th><th className="w-10" /></tr></thead>
          <tbody>{inv.partItems.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-gray-500 text-xs">No parts or materials added. Click “Add Part”.</td></tr>}
            {inv.partItems.map((p: PartItem) => (
              <tr key={p.id} className={`border-t border-white/5 ${aiIds.has(p.id) ? 'border-l-2 border-l-violet-400 bg-violet-500/5' : ''}`}>
                <td className="px-3 py-1.5"><TextIn {...dis} className="font-mono" placeholder="Part #" value={p.partNumber} onChange={v => onChange(i => updatePartItem(i, p.id, { partNumber: v }))} /></td>
                <td className="px-2 py-1.5"><TextIn {...dis} placeholder="Part description" value={p.description} onChange={v => onChange(i => updatePartItem(i, p.id, { description: v }))} /></td>
                <td className="px-2 py-1.5"><NumIn {...dis} step="1" min="0" value={p.quantity} onChange={v => onChange(i => updatePartItem(i, p.id, { quantity: v }))} /></td>
                <td className="px-2 py-1.5"><NumIn {...dis} step="0.01" min="0" value={p.unitPrice} onChange={v => onChange(i => updatePartItem(i, p.id, { unitPrice: v }))} /></td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-200">{money(p.quantity * p.unitPrice)}</td>
                <td className="px-1"><button {...dis} aria-label="Remove part row" className="text-gray-500 hover:text-red-400 p-1" onClick={() => onChange(i => removePartItem(i, p.id))}><X className="w-4 h-4" /></button></td>
              </tr>))}</tbody></table></div>
      </Card>

      <Card title="Fees, Tax & Totals" icon={<Settings2 className="w-4 h-4 text-[#7c3bed]" />}
        right={fromWebsite?.rates ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300">rates from website</span> : undefined}>
        {dynamic && <FeesEditor invoice={inv} onChange={onChange} readOnly={readOnly} feeTemplates={feeTemplates} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Sales Tax Rate (%)" hint="0 = no sales tax"><NumIn {...dis} step="0.01" min="0" max="100" value={inv.settings.taxRate} onChange={v => onChange(set('settings', { taxRate: v }))} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-300"><input {...dis} type="checkbox" checked={inv.settings.taxLabor} onChange={e => onChange(set('settings', { taxLabor: e.target.checked }))} /><span>Tax labor (in addition to parts)</span></label>
          <Field label="Discount Type"><select {...dis} className={inputCls} value={inv.settings.discountType} onChange={e => onChange(set('settings', { discountType: e.target.value as 'percent' | 'fixed' }))}><option value="percent">Percentage (%)</option><option value="fixed">Fixed Dollar ($)</option></select></Field>
          <Field label="Discount Value"><NumIn {...dis} step="0.01" min="0" value={inv.settings.discountValue} onChange={v => onChange(set('settings', { discountValue: v }))} /></Field>
          {!dynamic && <>
            <Field label="Shop Supplies Rate (% of Labor)"><NumIn {...dis} step="0.1" min="0" max="100" value={inv.settings.shopSuppliesRate} onChange={v => onChange(set('settings', { shopSuppliesRate: v }))} /></Field>
            <Field label="Shop Supplies Cap ($)"><NumIn {...dis} step="1" min="0" value={inv.settings.shopSuppliesCap} onChange={v => onChange(set('settings', { shopSuppliesCap: v }))} /></Field>
            <Field label="Hazardous Waste Fee ($)" className="sm:col-span-2"><NumIn {...dis} step="0.5" min="0" value={inv.settings.hazardousWasteFee} onChange={v => onChange(set('settings', { hazardousWasteFee: v }))} /></Field>
            <Field label={`${labels?.travel || 'Travel Fee'} ($)`}><NumIn {...dis} step="0.01" min="0" value={inv.settings.travelFee} onChange={v => onChange(set('settings', { travelFee: v }))} /></Field>
            <Field label="Misc. Fee ($)"><NumIn {...dis} step="0.01" min="0" value={inv.settings.miscFee} onChange={v => onChange(set('settings', { miscFee: v }))} /></Field>
          </>}
        </div>
        <dl className="rounded-xl border border-white/10 bg-black/20 divide-y divide-white/5 text-sm" aria-label="Totals breakdown">
          {(dynamic
            ? [['Labor Subtotal', money(totals.laborSubtotal)], ['Parts Subtotal', money(totals.partsSubtotal)], ['Subtotal', money(totals.subtotal)],
               ...(totals.discountAmount > 0 ? [['Discount', `-${money(totals.discountAmount)}`]] : []),
               ...(totals.fees ?? []).map(f => [f.label || 'Fee', money(f.amount)]),
               ...(inv.settings.taxRate > 0 || totals.taxAmount > 0 ? [['Sales Tax', money(totals.taxAmount)]] : [])]
            : [['Labor Subtotal', money(totals.laborSubtotal)], ['Parts Subtotal', money(totals.partsSubtotal)], ['Subtotal', money(totals.subtotal)], ['Discount', totals.discountAmount > 0 ? `-${money(totals.discountAmount)}` : money(0)],
               [labels?.supplies || 'Shop Supplies Fee', money(totals.shopSuppliesFee)], ['Hazardous Waste Fee', money(totals.hazardousWasteFee)], [labels?.travel || 'Travel Fee', money(totals.travelFee)], ['Misc. Fee', money(totals.miscFee)], ['Sales Tax', money(totals.taxAmount)]]
          ).map(([k, v], idx) => (
            <div key={`${k}-${idx}`} className="flex justify-between px-3 py-1.5 text-gray-300"><dt>{k}:</dt><dd className="tabular-nums">{v}</dd></div>))}
          <div className="flex justify-between px-3 py-2.5 font-bold text-white bg-[#7c3bed]/20"><dt>Grand Total:</dt><dd className="tabular-nums">{money(totals.grandTotal)}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
export default InvoiceEditor;
