import React, { useMemo, useState } from 'react';
import { FolderOpen, Trash2, Zap, Sparkles, Save } from 'lucide-react';
import type { InvoiceRecord } from '../../invoice/client';
import { calculateTotals } from '../../invoice/totals';
import { formatCurrency } from '../../invoice/format';
import { suggestPackages, type ServicePackage } from '../../invoice/packages';
import { salesTaxCollected } from '../../invoice/salestax';
import { Btn, StatusBadge } from './ui';

/** The history drawer: every invoice the user can read (members see read-only entries; only the owner can delete). */
export function HistoryDrawer({ records, jobTitles, currentId, onOpen, onDelete, onClose }: {
  records: InvoiceRecord[]; jobTitles: Record<string, string>; currentId: string | null; onOpen: (r: InvoiceRecord) => void; onDelete: (r: InvoiceRecord) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const year = new Date().getFullYear();
  // Sales tax collected from recorded payments (owner's documents), for remittance. Not income when your setting excludes it.
  const tax = useMemo(() => salesTaxCollected(records.filter(r => r.can_edit).map(r => r.invoice), `${year}-01-01`, `${year}-12-31`), [records, year]);
  const shown = useMemo(() => records.filter(r => !q.trim() || [r.invoice.meta.invoiceNumber, r.invoice.customer.name, jobTitles[r.job_id] || ''].some(f => f.toLowerCase().includes(q.toLowerCase()))), [records, q, jobTitles]);
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[70] no-print" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-md z-[75] bg-[#1c172d] border-l border-white/10 shadow-2xl flex flex-col no-print" aria-label="Saved invoices">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10"><h2 className="font-semibold text-white flex items-center gap-2"><FolderOpen className="w-4 h-4" />Saved documents ({records.length})</h2><button aria-label="Close" onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button></div>
        {tax.total > 0 && <div className="mx-3 mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">Sales tax collected in {year}: <b className="tabular-nums">{formatCurrency(tax.total)}</b> across {tax.byInvoice.length} invoice{tax.byInvoice.length === 1 ? '' : 's'} (for remittance; not counted as income when excluded in Settings).</div>}
        <div className="p-3"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, customer or job" className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500" /></div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
          {shown.length === 0 && <p className="text-sm text-gray-500 text-center py-10">{records.length ? 'Nothing matches.' : 'No saved invoices yet. Build one and press Save.'}</p>}
          {shown.map(r => {
            const i = r.invoice; const veh = i.details ? i.details.fields.map(f => f.value.trim()).filter(Boolean).slice(0, 3).join(' ') : [i.vehicle.year, i.vehicle.make, i.vehicle.model].filter(Boolean).join(' ');
            return (
              <div key={r.id} className={`rounded-xl border p-3 ${r.id === currentId ? 'border-[#7c3bed]/60 bg-[#7c3bed]/10' : 'border-white/10 bg-white/5'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm text-white truncate">{i.meta.invoiceNumber || '(no number)'}</span><span className="flex gap-1.5 items-center"><span className="text-[10px] uppercase text-gray-400">{i.meta.docType}</span><StatusBadge status={i.meta.status} docType={i.meta.docType} /></span></div>
                <div className="text-xs text-gray-400 mt-1 space-y-0.5"><div>{i.customer.name || 'Walk-in Customer'}{veh ? ` · ${veh}` : ''}</div><div className="truncate">{jobTitles[r.job_id] || 'Job'} · {i.meta.date || '—'}</div></div>
                <div className="flex items-center justify-between mt-2"><span className="font-mono text-sm text-gray-100">{formatCurrency(calculateTotals(i).grandTotal)}</span>
                  <span className="flex gap-1.5"><Btn size="sm" onClick={() => onOpen(r)}>{r.can_edit ? 'Load' : 'View'}</Btn>{r.can_edit && <Btn size="sm" variant="danger" onClick={() => onDelete(r)} aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></Btn>}</span></div>
              </div>);
          })}
        </div>
      </aside>
    </>
  );
}

/** Service Packages bar: apply a package, see which match the job's requested services, and save the current lines as a new package. */
export function PackageBar({ packages, services, readOnly, onApply, onApplyAll, onSaveAs, onSeedStarter, onSeedSite, siteServices }: {
  packages: ServicePackage[]; services: string[]; readOnly: boolean; onApply: (p: ServicePackage) => void; onApplyAll: (ps: ServicePackage[]) => void; onSaveAs: () => void;
  onSeedStarter: () => void; onSeedSite: () => void; siteServices: string[];
}) {
  const [more, setMore] = useState(false);
  const suggested = useMemo(() => new Set(suggestPackages(services, packages).map(p => p.id)), [services, packages]);
  const sorted = useMemo(() => [...packages].sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.order - b.order), [packages, suggested]);
  const visible = sorted.slice(0, 12), rest = sorted.slice(12);
  return (
    <div className="rounded-2xl border border-white/10 bg-[#1c172d]/60 p-3 no-print">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-bold tracking-wide text-gray-300 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" />SERVICE PACKAGES <span className="font-normal text-gray-500">Click to append labor &amp; parts</span></span>
        <span className="flex gap-1.5">
          {suggested.size > 0 && !readOnly && <Btn size="sm" variant="primary" onClick={() => onApplyAll(packages.filter(p => suggested.has(p.id)))}><Sparkles className="w-3.5 h-3.5" />Add all suggested ({suggested.size})</Btn>}
          {!readOnly && <Btn size="sm" onClick={onSaveAs} title="Save the current labor and parts lines as a new package"><Save className="w-3.5 h-3.5" />Save lines as package</Btn>}
        </span>
      </div>
      {packages.length === 0 ? (
        <div className="text-xs text-gray-400 flex flex-wrap items-center gap-2">No packages yet.
          {!readOnly && <><Btn size="sm" onClick={onSeedStarter}>Add the automotive starter set</Btn>{siteServices.length > 0 && <Btn size="sm" onClick={onSeedSite}>Create packages from my website’s services</Btn>}<span className="text-gray-500">Or build your own in Settings → Invoices.</span></>}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map(p => <button key={p.id} disabled={readOnly} onClick={() => onApply(p)} className={`px-3 py-1.5 rounded-xl text-xs border transition-colors disabled:opacity-50 ${suggested.has(p.id) ? 'border-[#7c3bed] bg-[#7c3bed]/20 text-white' : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'}`}>{p.icon && <span className="mr-1">{p.icon}</span>}{p.name}{suggested.has(p.id) && <span className="ml-1.5 text-[10px] text-violet-300">Suggested</span>}</button>)}
          {rest.length > 0 && <div className="relative"><Btn size="sm" onClick={() => setMore(m => !m)}>More ({rest.length})</Btn>{more && <div className="absolute z-20 mt-1 w-64 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1c172d] shadow-xl p-1">{rest.map(p => <button key={p.id} disabled={readOnly} onClick={() => { onApply(p); setMore(false); }} className="block w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 rounded-lg">{p.icon} {p.name}</button>)}</div>}</div>}
        </div>
      )}
    </div>
  );
}
