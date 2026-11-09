import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Plus, Save, FolderOpen, Download, Upload, Printer, FileDown, Send, BadgeCheck, DollarSign, RefreshCw, Sparkles, RotateCcw, AlertTriangle, Package as PackageIcon } from 'lucide-react';
import type { Invoice } from '../../invoice/types';
import { calculateTotals } from '../../invoice/totals';
import { formatCurrency } from '../../invoice/format';
import { exportInvoiceJson, importInvoiceJson } from '../../invoice/normalize';
import { createEmptyInvoice } from '../../invoice/model';
import { buildNewInvoice, partsFromExpenses, refreshFromJob } from '../../invoice/prefill';
import { parseIntakeText } from '../../invoice/intake';
import { applyPackage, automotiveStarter, normalizePackage, packagesFromServices, type ServicePackage } from '../../invoice/packages';
import { confirmEstimate, reopenAsEstimate } from '../../invoice/review';
import { applyPending, needsPending } from '../../invoice/pending';
import { recordPayment, summarizePayments } from '../../invoice/salestax';
import { addEvent, geOf, withGe } from '../../invoice/ge';
import { effectiveRates, defaultSettings, type InvoicingSettings } from '../../invoice/settings';
import { medianBilledHours, verifyAiLines } from '../../invoice/aiDraft';
import { renderPdf, renderSheet } from '../../invoice/render';
import { addIncomeEntry, downloadBytes, invoicesApi, jobsApi, packagesApi, settingsApi, type InvoiceRecord } from '../../invoice/client';
import { deterministicUuid } from '../../e2ee/store';
import type { JobView } from '../../e2ee/store';
import { Btn, Notice, StatusBadge } from './ui';
import { InvoiceEditor, NotesCard } from './InvoiceEditor';
import { InvoiceSheet } from './InvoiceSheet';
import { HistoryDrawer, PackageBar } from './panels';
import { AiDraftModal, NamePrompt, NewDocumentModal, RecordPaymentModal, ReviewConfirmModal, SendInvoiceModal } from './modals';

interface Current { recordId: string | null; jobId: string; rev: number; canEdit: boolean }
const workingKey = (c: Current) => `ge.invoice.working.${c.recordId ?? `new-${c.jobId}`}`;
const uid = () => globalThis.crypto.randomUUID();
const isNative = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

export default function InvoiceWorkspace({ jobId, openId }: { jobId?: string | null; openId?: string | null }) {
  const [settings, setSettings] = useState<InvoicingSettings>(defaultSettings());
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<Current | null>(null);
  const [invoice, setInvoiceState] = useState<Invoice>(() => createEmptyInvoice());
  const [saved, setSaved] = useState('');
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [fromWebsite, setFromWebsite] = useState(false);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | 'history' | 'new' | 'review' | 'pay' | 'send' | 'ai' | 'savepkg'>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const say = useCallback((m: string) => { setFlash(m); window.setTimeout(() => setFlash(f => (f === m ? '' : f)), 3500); }, []);
  const json = (i: Invoice) => JSON.stringify(i);
  const dirty = json(invoice) !== saved;
  const canEdit = current ? current.canEdit : true;
  const setInvoice = useCallback((fn: (i: Invoice) => Invoice) => setInvoiceState(prev => fn(prev)), []);

  // ── load everything ────────────────────────────────────────────────────────
  const reloadAll = useCallback(async () => {
    const [s, p, j, r] = await Promise.all([settingsApi.get(), packagesApi.get(), jobsApi.list(), invoicesApi.list()]);
    setSettings(s); setPackages(p); setJobs(j); setRecords(r);
    return { s, p, j, r };
  }, []);

  const job = useMemo(() => jobs.find(j => j.id === current?.jobId) ?? null, [jobs, current]);
  const intake = useMemo(() => (job ? job.intake ?? parseIntakeText(job.description) : null), [job]);
  const rates = effectiveRates(settings);
  const hourlyRate = Number((invoice.ge?.prefill as any)?.hourlyRate) || (job?.job_rate && job.job_rate > 0 ? job.job_rate : rates.hourlyRate);

  const open = useCallback((r: InvoiceRecord, jobsNow?: JobView[], s?: InvoicingSettings) => {
    let inv = r.invoice; const base = json(inv);
    if (r.can_edit && needsPending(inv)) inv = applyPending(inv, s ?? settings); // agent-made documents are finished here (plan C17)
    const c: Current = { recordId: r.id, jobId: r.job_id, rev: r.rev, canEdit: r.can_edit };
    let restored = false;
    try { const w = JSON.parse(sessionStorage.getItem(workingKey(c)) || 'null'); if (w && w.saved === base) { inv = w.invoice; restored = true; } } catch { /* ignore */ }
    setCurrent(c); setInvoiceState(inv); setSaved(base); setWarnings([]); setFromWebsite(geOf(inv).origin === 'api-auto' || (inv.ge?.prefill as any)?.rateSource === 'website');
    if (restored) say('Restored your unsaved edits.');
    void jobsNow;
  }, [settings, say]);

  const startNew = useCallback(async (forJobId: string, docType: 'estimate' | 'invoice' = 'estimate', ctx?: { j: JobView[]; s: InvoicingSettings }) => {
    setBusy(true);
    try {
      let jobList = ctx?.j ?? jobs; let j = jobList.find(x => x.id === forJobId);
      if (!j) throw new Error('Job not found.');
      if (!j.invoice_number && j.role === 'owner') { await jobsApi.patch(j.id, {}); jobList = await jobsApi.list(); setJobs(jobList); j = jobList.find(x => x.id === forJobId) ?? j; } // assign the job's number first (plan D6)
      const it = j.intake ?? parseIntakeText(j.description);
      const built = buildNewInvoice({ job: j, intake: it, settings: ctx?.s ?? settings, docType });
      const c: Current = { recordId: null, jobId: forJobId, rev: 0, canEdit: j.role === 'owner' };
      let inv = built.invoice; let restored = false;
      try { const w = JSON.parse(sessionStorage.getItem(workingKey(c)) || 'null'); if (w && w.invoice) { inv = w.invoice; restored = true; } } catch { /* ignore */ }
      setCurrent(c); setInvoiceState(inv); setSaved(''); setWarnings(built.warnings); setFromWebsite(Object.values(built.provenance).includes('website'));
      if (restored) say('Restored your unsaved edits.');
    } catch (e: any) { setError(e.message || 'Could not start a new document.'); } finally { setBusy(false); setModal(null); }
  }, [jobs, settings, say]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await reloadAll(); if (!alive) return;
        const rec = openId ? all.r.find(x => x.id === openId) : jobId ? all.r.filter(x => x.job_id === jobId)[0] : undefined;
        if (rec) open(rec, all.j, all.s);
        else if (jobId) await startNew(jobId, 'estimate', { j: all.j, s: all.s });
        else if (!openId && all.r.length === 0 && all.j.length > 0) setModal('new');
      } catch (e: any) { if (alive) setError(e.message || 'Could not load invoices.'); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, openId]);

  // working copy: a refresh must not lose edits; tab-scoped and wiped on logout (plan T10)
  useEffect(() => {
    if (!current) return; const t = window.setTimeout(() => { try { if (dirty) sessionStorage.setItem(workingKey(current), JSON.stringify({ invoice, saved })); else sessionStorage.removeItem(workingKey(current)); } catch { /* storage unavailable */ } }, 300);
    return () => window.clearTimeout(t);
  }, [invoice, saved, current, dirty]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty && canEdit) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty, canEdit]);

  // ── actions ───────────────────────────────────────────────────────────────
  const persist = useCallback(async (inv: Invoice, c: Current | null = current): Promise<InvoiceRecord | null> => {
    if (!c) return null;
    setBusy(true); setError('');
    try {
      const rec = c.recordId ? await invoicesApi.update(c.recordId, inv, c.rev) : await invoicesApi.create(c.jobId, inv);
      const next: Current = { recordId: rec.id, jobId: rec.job_id, rev: rec.rev, canEdit: true };
      try { sessionStorage.removeItem(workingKey(c)); } catch { /* ignore */ }
      setCurrent(next); setInvoiceState(rec.invoice); setSaved(json(rec.invoice)); setRecords(await invoicesApi.list());
      return rec;
    } catch (e: any) { setError(/changed elsewhere/i.test(e.message) ? 'This document was changed on another device. Reload it from History before saving again.' : e.message || 'Could not save.'); return null; }
    finally { setBusy(false); }
  }, [current]);

  const save = async () => { const r = await persist(invoice); if (r) say('✓ Saved!'); };

  const makePdf = () => renderPdf(invoice, settings);
  const downloadPdf = () => { const { bytes, filename } = makePdf(); downloadBytes(bytes, filename); };
  const exportJson = () => downloadBytes(new TextEncoder().encode(exportInvoiceJson(invoice)), `${invoice.meta.invoiceNumber || 'invoice'}.json`, 'application/json');
  const onImport = async (f: File | undefined) => {
    if (!f) return; if (!current) { setError('Open or create a document for a job first, then import into it.'); return; }
    try { const inv = importInvoiceJson(await f.text()); setInvoiceState({ ...inv, ge: undefined }); say('Imported. Review it, then Save.'); } catch (e: any) { setError(e.message); }
    if (importRef.current) importRef.current.value = '';
  };

  const confirm = async (note: string) => {
    setModal(null);
    let inv = confirmEstimate(invoice, { by: 'human' }, note, { settings });
    inv = applyPending(inv, settings);
    const rec = await persist(inv); if (rec) say('Final invoice created.');
  };
  const reopen = async () => { if (!window.confirm('Reopen this final invoice as an estimate? This is logged.')) return; const rec = await persist(reopenAsEstimate(invoice)); if (rec) say('Reopened as an estimate.'); };

  const onPayment = async (p: { method: string; amount: number; date: string; reference: string }) => {
    if (!current?.recordId) throw new Error('Save the invoice first.');
    const r = recordPayment(invoice, { id: uid(), ...p }, { mode: settings.tax.incomeMode });
    const rec = await persist(r.invoice); if (!rec) throw new Error('Could not save the payment.');
    // Deterministic id: two devices (or a retry) can never double-post the income entry.
    const entryId = await deterministicUuid(`invoice-payment|${current.recordId}|${r.payment.id}`);
    await addIncomeEntry(current.jobId, entryId, r.income, `${invoice.meta.docType === 'invoice' ? 'Invoice' : 'Estimate'} ${invoice.meta.invoiceNumber} payment (${p.method})${r.payment.taxPortion > 0 ? ` — excludes ${formatCurrency(r.payment.taxPortion)} sales tax` : ''}`, p.date);
    const withEntry = withGe(rec.invoice, { payments: geOf(rec.invoice).payments.map(x => (x.id === r.payment.id ? { ...x, incomeEntryId: entryId } : x)) });
    await persist(withEntry, { recordId: rec.id, jobId: rec.job_id, rev: rec.rev, canEdit: true });
    setModal(null); say('Payment recorded.');
  };

  const onSent = async (to: string) => {
    setModal(null);
    let inv = withGe({ ...invoice, meta: { ...invoice.meta, status: invoice.meta.status === 'Paid' ? 'Paid' : 'Sent' } }, { sentAt: new Date().toISOString(), sentTo: to });
    inv = addEvent(inv, { by: 'human' }, 'sent', to);
    const rec = await persist(inv); say(rec ? `Sent to ${to}.` : 'Sent, but the status could not be saved.');
  };

  const addPackage = (p: ServicePackage) => setInvoice(i => applyPackage(i, p, hourlyRate));
  const savePackages = async (next: ServicePackage[]) => { setPackages(await packagesApi.save(next)); };
  const siteServices = useMemo(() => [...new Set(jobs.flatMap(j => (j.intake?.source === 'api' ? j.intake.services : [])))], [jobs]);

  const refresh = () => {
    if (!job) return;
    const fresh = buildNewInvoice({ job, intake, settings, docType: invoice.meta.docType }).invoice;
    const r = refreshFromJob(invoice, fresh); setInvoiceState(r.invoice);
    say(r.changed.length ? `Updated from the job: ${r.changed.map(c => c.split('.')[1]).join(', ')}.` : 'Nothing new on the job (your edits are kept).');
  };
  const addExpenseParts = async () => {
    if (!current) return; const raw = window.prompt('Markup % to add to each expense (e.g. 20):', '20'); if (raw === null) return;
    try { const ex = await jobsApi.expenses(current.jobId); const next = partsFromExpenses(invoice, ex, Number(raw) || 0); say(next.partItems.length === invoice.partItems.length ? 'No new expenses to add.' : 'Added parts from the job’s expenses.'); setInvoiceState(next); } catch (e: any) { setError(e.message); }
  };

  const del = async (r: InvoiceRecord) => {
    if (!window.confirm(`Delete ${r.invoice.meta.docType} ${r.invoice.meta.invoiceNumber}? This cannot be undone.`)) return;
    try { await invoicesApi.remove(r.id); setRecords(await invoicesApi.list()); if (current?.recordId === r.id) { setCurrent(null); setInvoiceState(createEmptyInvoice()); setSaved(''); } } catch (e: any) { setError(e.message); }
  };

  const totals = calculateTotals(invoice);
  const sum = summarizePayments(invoice, totals);
  const g = geOf(invoice);
  const sheet = useMemo(() => renderSheet(invoice, settings), [invoice, settings]);
  const jobTitles = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j.title])), [jobs]);
  const median = useMemo(() => medianBilledHours(records.map(r => r.invoice), (intake?.services || [])[0] || ''), [records, intake]);
  const isEstimate = invoice.meta.docType === 'estimate';
  const needsVerify = !!g.ai && g.ai.lineIds.length > 0 && !g.ai.verified;
  const sendBlocked = needsVerify && settings.automation.requireVerification;

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading invoices…</div>;

  return (
    <div className="min-h-screen bg-[#121317] text-white py-5 px-3 sm:px-6">
      <div className="max-w-[1500px] mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <div><h1 className="text-xl font-bold flex items-center gap-2">Invoices & Estimates{current && <StatusBadge status={invoice.meta.status} docType={invoice.meta.docType} />}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{job ? <>Job: <span className="text-gray-200">{job.title}</span>{job.invoice_number ? <span className="font-mono"> · {job.invoice_number}</span> : null}{current && !current.recordId ? <span className="text-amber-300"> · not saved yet</span> : dirty ? <span className="text-amber-300"> · unsaved changes</span> : null}</> : 'Pick a job to start.'}</p></div>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" onClick={() => setModal('new')}><Plus className="w-3.5 h-3.5" />New</Btn>
            <Btn size="sm" variant="primary" disabled={!current || !canEdit || busy || !dirty} onClick={save}><Save className="w-3.5 h-3.5" />Save</Btn>
            <Btn size="sm" onClick={() => setModal('history')}><FolderOpen className="w-3.5 h-3.5" />History ({records.length})</Btn>
            <Btn size="sm" disabled={!current} onClick={exportJson}><Download className="w-3.5 h-3.5" />Export JSON</Btn>
            <Btn size="sm" disabled={!current || !canEdit} onClick={() => importRef.current?.click()}><Upload className="w-3.5 h-3.5" />Import JSON</Btn>
            <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={e => onImport(e.target.files?.[0])} />
            {!isNative() && <Btn size="sm" disabled={!current} onClick={() => window.print()}><Printer className="w-3.5 h-3.5" />Print</Btn>}
            <Btn size="sm" variant="accent" disabled={!current} onClick={downloadPdf}><FileDown className="w-3.5 h-3.5" />Download PDF</Btn>
          </div>
        </div>

        {flash && <div className="no-print"><Notice tone="ok">{flash}</Notice></div>}
        {error && <div className="no-print"><Notice tone="error">{error}</Notice></div>}

        {!current ? (
          <div className="rounded-2xl border border-white/10 bg-[#1c172d]/60 p-10 text-center no-print">
            <p className="text-gray-300 mb-4">{jobs.length ? 'Choose a job to create an estimate for, or open a saved document from History.' : 'Create a job first, then build its estimate here.'}</p>
            <div className="flex justify-center gap-2"><Btn variant="primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" />New estimate</Btn><Btn onClick={() => setModal('history')}><FolderOpen className="w-4 h-4" />History</Btn></div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 no-print">
              {!canEdit && <Notice tone="info">You are viewing the owner’s {invoice.meta.docType}. Only the job owner can change it.</Notice>}
              {g.review?.by === 'agent' && <Notice tone="info">Finalized by an agent{g.review.note ? `: “${g.review.note}”` : ''}. Review it before sending.</Notice>}
              {isEstimate && canEdit && current.recordId && <Btn size="sm" variant="primary" onClick={() => setModal('review')}><BadgeCheck className="w-3.5 h-3.5" />Review &amp; confirm final</Btn>}
              {isEstimate && canEdit && <Btn size="sm" onClick={() => setModal('ai')}><Sparkles className="w-3.5 h-3.5 text-violet-300" />Draft with AI</Btn>}
              {!isEstimate && canEdit && current.recordId && sum.balance > 0 && <Btn size="sm" variant="accent" onClick={() => setModal('pay')}><DollarSign className="w-3.5 h-3.5" />Record payment</Btn>}
              {!isEstimate && canEdit && current.recordId && <Btn size="sm" variant="ghost" onClick={reopen}><RotateCcw className="w-3.5 h-3.5" />Reopen as estimate</Btn>}
              {current.recordId && <Btn size="sm" disabled={!canEdit || sendBlocked || dirty} title={dirty ? 'Save first' : sendBlocked ? 'Verify the AI-drafted lines first' : ''} onClick={() => setModal('send')}><Send className="w-3.5 h-3.5" />Send</Btn>}
              {canEdit && job && <Btn size="sm" variant="ghost" onClick={refresh}><RefreshCw className="w-3.5 h-3.5" />Refresh from job</Btn>}
              {canEdit && job && <Btn size="sm" variant="ghost" onClick={addExpenseParts}><PackageIcon className="w-3.5 h-3.5" />Parts from expenses</Btn>}
              {!isEstimate && (sum.paid > 0) && <span className="text-xs text-gray-400">Paid {formatCurrency(sum.paid)} · balance {formatCurrency(sum.balance)}{sum.taxCollected > 0 ? ` · tax collected ${formatCurrency(sum.taxCollected)}` : ''}</span>}
            </div>

            {needsVerify && canEdit && (
              <div className="no-print"><Notice tone="warn"><span className="flex flex-wrap items-center gap-2"><Sparkles className="w-3.5 h-3.5" /><b>AI draft — review each line</b> (marked with a purple edge).{g.ai?.confidence ? ` Confidence: ${g.ai.confidence}.` : ''}{g.ai?.questions?.length ? ` Open questions: ${g.ai.questions.join(' · ')}` : ''}
                <Btn size="sm" onClick={() => setInvoice(i => verifyAiLines(i))}>I verified these lines</Btn></span></Notice></div>)}
            {warnings.length > 0 && <div className="no-print"><Notice tone="warn"><span className="flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{warnings.map(w => w.message).join(' ')}</span></span></Notice></div>}

            <PackageBar packages={packages} services={intake?.services || []} readOnly={!canEdit} siteServices={siteServices}
              onApply={addPackage} onApplyAll={ps => ps.forEach(addPackage)} onSaveAs={() => setModal('savepkg')}
              onSeedStarter={() => savePackages([...packages, ...automotiveStarter()])} onSeedSite={() => savePackages([...packages, ...packagesFromServices(siteServices, packages)])} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              <div className="no-print"><InvoiceEditor invoice={invoice} onChange={setInvoice} readOnly={!canEdit} hourlyRate={hourlyRate} fromWebsite={{ rates: fromWebsite }} feeTemplates={settings.fees} /></div>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2 no-print"><span className="text-xs font-bold tracking-wide text-gray-400">LIVE PRINTABLE PREVIEW</span></div>
                  <div id="printable-invoice-area"><InvoiceSheet model={sheet.model} payLines={sheet.payLines} paymentBoxes={sheet.paymentBoxes} /></div>
                </div>
                <div className="no-print"><NotesCard invoice={invoice} onChange={setInvoice} readOnly={!canEdit} /></div>
              </div>
            </div>

            <div className="xl:hidden sticky bottom-2 z-30 no-print"><div className="rounded-2xl border border-white/10 bg-[#1c172d]/95 backdrop-blur px-4 py-2.5 flex items-center justify-between shadow-xl"><span className="text-sm text-gray-300">Total <b className="text-white tabular-nums">{formatCurrency(totals.grandTotal)}</b></span>
              <span className="flex gap-2"><Btn size="sm" variant="primary" disabled={!canEdit || busy || !dirty} onClick={save}>Save</Btn><Btn size="sm" variant="accent" onClick={downloadPdf}>PDF</Btn></span></div></div>
          </>
        )}
      </div>

      {modal === 'history' && <HistoryDrawer records={records} jobTitles={jobTitles} currentId={current?.recordId ?? null} onOpen={r => { open(r); setModal(null); }} onDelete={del} onClose={() => setModal(null)} />}
      {modal === 'new' && <NewDocumentModal jobs={jobs.filter(j => !j.locked && j.role === 'owner')} onPick={id => startNew(id)} onClose={() => setModal(null)}
        onQuick={async title => { const j = await jobsApi.create({ title }); setJobs(await jobsApi.list()); await startNew(j.id, 'estimate', { j: await jobsApi.list(), s: settings }); }} />}
      {modal === 'review' && <ReviewConfirmModal invoice={invoice} onConfirm={confirm} onClose={() => setModal(null)} />}
      {modal === 'pay' && <RecordPaymentModal invoice={invoice} settings={settings} onRecord={onPayment} onClose={() => setModal(null)} />}
      {modal === 'send' && <SendInvoiceModal invoice={invoice} settings={settings} onSent={onSent} onClose={() => setModal(null)} />}
      {modal === 'ai' && <AiDraftModal invoice={invoice} intake={intake} description={job?.description ?? null} packages={packages} settings={settings} hourlyRate={hourlyRate} medianHours={median} onApply={inv => { setInvoiceState(inv); setModal(null); say('AI draft added. Review each line.'); }} onClose={() => setModal(null)} />}
      {modal === 'savepkg' && <NamePrompt title="Save lines as a package" label="Package name" confirm="Save package" onClose={() => setModal(null)}
        onSubmit={async name => { const pkg = normalizePackage({ id: uid(), name, order: packages.length + 1, labor: invoice.laborItems.map(l => ({ description: l.description, technician: l.technician, hours: l.hours, rate: l.rate === hourlyRate ? null : l.rate })), parts: invoice.partItems.map(p => ({ partNumber: p.partNumber, description: p.description, quantity: p.quantity, unitPrice: p.unitPrice })) }); await savePackages([...packages, pkg]); setModal(null); say('Package saved.'); }} />}
    </div>
  );
}
