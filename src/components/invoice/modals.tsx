import React, { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Mail, Sparkles, Loader2 } from 'lucide-react';
import type { Invoice } from '../../invoice/types';
import { calculateTotals } from '../../invoice/totals';
import { formatCurrency } from '../../invoice/format';
import { reviewChecklist } from '../../invoice/review';
import { summarizePayments, taxPortion } from '../../invoice/salestax';
import { todayIso } from '../../invoice/model';
import { PAYMENT_METHOD_KEYS, type InvoicingSettings } from '../../invoice/settings';
import { fillEmailTemplate, renderPdf, payInfo } from '../../invoice/render';
import { aiApi, pdfToBase64, sendInvoiceMail } from '../../invoice/client';
import { buildBrief, buildDraftMessages, parseDraft, applyDraft } from '../../invoice/aiDraft';
import { profileFor } from '../../invoice/aiSettings';
import { parseIntakeText, type JobIntake } from '../../invoice/intake';
import { geOf } from '../../invoice/ge';
import type { ServicePackage } from '../../invoice/packages';
import { Btn, Field, Modal, Notice, NumIn, TextIn, inputCls } from './ui';

/** Estimate → Final: a checklist of what to look at, then an explicit, recorded confirmation (docs/DOCUMENTATION.md §13.8). */
export function ReviewConfirmModal({ invoice, onConfirm, onClose }: { invoice: Invoice; onConfirm: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  const items = useMemo(() => reviewChecklist(invoice), [invoice]);
  const open = items.filter(i => !i.ok).length;
  return (
    <Modal title="Review & confirm final invoice" onClose={onClose}>
      <p className="text-sm text-gray-300 mb-3">Check these before the estimate becomes a final invoice. This is recorded with your name and the time.</p>
      <ul className="space-y-1.5 mb-4">{items.map(i => (
        <li key={i.id} className="flex items-start gap-2 text-sm">{i.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />}
          <span className={i.ok ? 'text-gray-300' : 'text-amber-200'}>{i.label}{i.detail ? <span className="text-gray-500"> — {i.detail}</span> : null}</span></li>))}</ul>
      {open > 0 && <div className="mb-3"><Notice tone="warn">{open} item{open > 1 ? 's' : ''} need attention. You can still confirm.</Notice></div>}
      <Field label="Note (optional)"><TextIn value={note} onChange={setNote} placeholder="e.g. Hours checked against the job" /></Field>
      <div className="flex justify-end gap-2 mt-4"><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={() => onConfirm(note)}>Confirm final invoice</Btn></div>
    </Modal>
  );
}

/** Record a payment (method, amount, date, reference); the tax portion and the income entry are shown before saving. */
export function RecordPaymentModal({ invoice, settings, onRecord, onClose }: { invoice: Invoice; settings: InvoicingSettings; onRecord: (p: { method: string; amount: number; date: string; reference: string }) => Promise<void>; onClose: () => void }) {
  const totals = calculateTotals(invoice); const sum = summarizePayments(invoice, totals);
  const methods = [...new Set([...PAYMENT_METHOD_KEYS.filter(k => settings.payments[k].enabled), 'cash', 'check', 'other'])];
  const [method, setMethod] = useState(methods[0] as string); const [amount, setAmount] = useState(sum.balance); const [date, setDate] = useState(todayIso()); const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const tax = taxPortion(amount, totals.taxAmount, totals.grandTotal); const income = settings.tax.incomeMode === 'include' ? amount : amount - tax;
  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method"><select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>{methods.map(k => <option key={k} value={k}>{settings.payments[k as keyof InvoicingSettings['payments']]?.label || k}</option>)}</select></Field>
        <Field label="Amount ($)" hint={`Balance due ${formatCurrency(sum.balance)}`}><NumIn step="0.01" min="0" value={amount} onChange={setAmount} /></Field>
        <Field label="Date"><TextIn type="date" value={date} onChange={setDate} /></Field>
        <Field label="Reference (optional)"><TextIn value={reference} onChange={setReference} placeholder="Check # / transaction id" /></Field>
      </div>
      <div className="mt-3 text-xs text-gray-400 rounded-xl bg-black/20 border border-white/10 p-3">
        Adds an <b className="text-gray-200">income entry of {formatCurrency(income)}</b> to this job{tax > 0 ? <> and records <b className="text-gray-200">{formatCurrency(tax)} sales tax</b> collected (not counted as income{settings.tax.incomeMode === 'include' ? '' : ''}).</> : '.'}
        {tax > 0 && settings.tax.incomeMode === 'include' && ' (Your setting books the full payment as income.)'}
      </div>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="flex justify-end gap-2 mt-4"><Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="accent" disabled={busy || !(amount > 0)} onClick={async () => { setBusy(true); setErr(''); try { await onRecord({ method, amount, date, reference }); } catch (e: any) { setErr(e.message || 'Could not record the payment.'); setBusy(false); } }}>{busy ? 'Saving…' : 'Record payment'}</Btn></div>
    </Modal>
  );
}

/** Internal e-mailer: the client-generated PDF goes to the server in memory; falls back to a prefilled mailto: when mail is not available. */
export function SendInvoiceModal({ invoice, settings, onSent, onClose }: { invoice: Invoice; settings: InvoicingSettings; onSent: (to: string) => void; onClose: () => void }) {
  const [to, setTo] = useState(invoice.customer.email);
  const [subject, setSubject] = useState(() => fillEmailTemplate(settings.email.subject, invoice, settings));
  const [body, setBody] = useState(() => fillEmailTemplate(settings.email.body, invoice, settings));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [fallback, setFallback] = useState(!settings.email.enabled);
  const links = payInfo(invoice, settings).options.filter(o => o.url).map(o => ({ label: o.label, url: o.url! }));
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  async function send() {
    setBusy(true); setErr('');
    try {
      const { bytes, filename } = renderPdf(invoice, settings);
      await sendInvoiceMail({ to, subject, text: body, pay_links: links, pdf_base64: pdfToBase64(bytes), filename, shop_name: invoice.shop.name || settings.shop.name, ...(settings.email.replyTo || settings.shop.email ? { reply_to: settings.email.replyTo || settings.shop.email } : {}), ...(settings.email.bccMe && (settings.email.replyTo || settings.shop.email) ? { bcc: [settings.email.replyTo || settings.shop.email] } : {}) });
      onSent(to);
    } catch (e: any) { setErr(e.message || 'Could not send.'); if (/not configured/i.test(e.message || '')) setFallback(true); setBusy(false); }
  }
  return (
    <Modal wide title={<span className="flex items-center gap-2"><Mail className="w-4 h-4" />Send {invoice.meta.docType === 'estimate' ? 'estimate' : 'invoice'}</span>} onClose={onClose}>
      {!settings.email.enabled && <div className="mb-3"><Notice tone="info">In-app e-mail is off. It sends the PDF through your server’s mail account, so the PDF passes through the server in memory (the one exception to end-to-end encryption here). Turn it on in Settings → Invoices → E-mail, or use your own mail app below.</Notice></div>}
      <div className="space-y-3">
        <Field label="To"><TextIn type="email" value={to} onChange={setTo} placeholder="customer@example.com" /></Field>
        <Field label="Subject"><TextIn value={subject} onChange={setSubject} /></Field>
        <Field label="Message" hint={links.length ? `Buttons will be added for: ${links.map(l => l.label).join(', ')}. The PDF is attached.` : 'The PDF is attached.'}><textarea rows={9} className={inputCls} value={body} onChange={e => setBody(e.target.value)} /></Field>
      </div>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="flex flex-wrap justify-end gap-2 mt-4">
        {fallback && <a href={mailto} className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-gray-200 hover:bg-white/10">Open in my mail app</a>}
        <Btn onClick={onClose}>Cancel</Btn>
        {settings.email.enabled && <Btn variant="primary" disabled={busy || !to.includes('@')} onClick={send}>{busy ? 'Sending…' : 'Send'}</Btn>}
      </div>
    </Modal>
  );
}

/** Draft an estimate's labor with AI: hours only (never prices), validated, always an estimate a person verifies. */
export function AiDraftModal({ invoice, intake, description, packages, settings, hourlyRate, medianHours, onApply, onClose }: {
  invoice: Invoice; intake: JobIntake | null; description: string | null; packages: ServicePackage[]; settings: InvoicingSettings; hourlyRate: number; medianHours?: number; onApply: (inv: Invoice) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [questions, setQuestions] = useState<string[]>([]);
  const effective = intake ?? parseIntakeText(description);
  const brief = useMemo(() => buildBrief(effective, { packages, medianHours }), [effective, packages, medianHours]);
  async function run() {
    setBusy(true); setErr(''); setQuestions([]);
    try {
      const ai = await aiApi.settings(); const profile = profileFor({ ...ai, ai_api_key: ai.ai_api_key }, 'drafting');
      if (!profile) throw new Error('Add an AI endpoint in Settings → AI first.');
      const out = await aiApi.complete(profile, buildDraftMessages(brief), true);
      const draft = parseDraft(out.content, { partsPolicy: effective.partsPolicy });
      if (draft.labor.length === 0 && draft.parts.length === 0) { setQuestions(draft.questions.length ? draft.questions : ['The AI could not scope this work from the details provided.']); setBusy(false); return; }
      onApply(applyDraft(invoice, draft, hourlyRate, profile.model));
    } catch (e: any) { setErr(e.message || 'The AI draft failed.'); setBusy(false); }
  }
  void settings; void geOf;
  return (
    <Modal wide title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-300" />Draft estimate with AI</span>} onClose={onClose}>
      <p className="text-sm text-gray-300">The AI suggests <b>labor hours and parts</b> from the job’s services and symptoms. It never sets prices: rates come from your settings and the totals are computed here. You review every line before sending.</p>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300 space-y-1"><div className="text-gray-500 uppercase tracking-wide text-[10px]">What will be sent (no name, phone, e-mail or address)</div>
        <div>Vehicle: {brief.vehicle || '—'}</div><div>Services: {brief.services.join(', ') || '—'}</div><div>Parts: {brief.partsPolicy === 'own-parts' ? 'customer supplies their own' : 'shop / unknown'}</div><div className="whitespace-pre-wrap">Symptoms: {brief.symptoms || '—'}</div>{brief.medianHours ? <div>Your typical billed hours: {brief.medianHours}</div> : null}</div>
      {questions.length > 0 && <div className="mt-3"><Notice tone="warn"><b>The AI needs more information:</b><ul className="list-disc ml-4 mt-1">{questions.map((q, i) => <li key={i}>{q}</li>)}</ul></Notice></div>}
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <div className="flex justify-end gap-2 mt-4"><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={run}>{busy ? <><Loader2 className="w-4 h-4 animate-spin" />Drafting…</> : 'Draft estimate'}</Btn></div>
    </Modal>
  );
}

/** Pick the job a new document belongs to (every invoice belongs to a job), or create a quick one. */
export function NewDocumentModal({ jobs, onPick, onQuick, onClose }: { jobs: Array<{ id: string; title: string; invoice_number?: string | null }>; onPick: (jobId: string) => void; onQuick: (title: string) => Promise<void>; onClose: () => void }) {
  const [q, setQ] = useState(''); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false);
  const shown = jobs.filter(j => !q.trim() || `${j.title} ${j.invoice_number || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <Modal title="New estimate or invoice" onClose={onClose}>
      <Field label="Choose a job"><TextIn value={q} onChange={setQ} placeholder="Search jobs" /></Field>
      <div className="mt-2 max-h-56 overflow-y-auto space-y-1">{shown.length === 0 && <p className="text-xs text-gray-500 py-3 text-center">No jobs match.</p>}
        {shown.map(j => <button key={j.id} onClick={() => onPick(j.id)} className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-sm text-gray-100 flex justify-between gap-2"><span className="truncate">{j.title}</span><span className="font-mono text-xs text-gray-400 shrink-0">{j.invoice_number}</span></button>)}</div>
      <div className="mt-4 pt-4 border-t border-white/10"><Field label="…or create a quick job"><div className="flex gap-2"><TextIn value={title} onChange={setTitle} placeholder="Customer or job name" /><Btn variant="primary" disabled={!title.trim() || busy} onClick={async () => { setBusy(true); await onQuick(title.trim()); }}>Create</Btn></div></Field></div>
    </Modal>
  );
}

export function NamePrompt({ title, label, initial = '', confirm, onSubmit, onClose }: { title: string; label: string; initial?: string; confirm: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  return (<Modal title={title} onClose={onClose}><Field label={label}><TextIn value={v} onChange={setV} autoFocus /></Field><div className="flex justify-end gap-2 mt-4"><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!v.trim()} onClick={() => onSubmit(v.trim())}>{confirm}</Btn></div></Modal>);
}
