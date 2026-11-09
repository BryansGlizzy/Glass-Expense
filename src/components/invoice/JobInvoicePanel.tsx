import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FileText, Search, Loader2, X, Plus } from 'lucide-react';
import { aiApi, invoicesApi, jobsApi, type InvoiceRecord } from '../../invoice/client';
import { calculateTotals } from '../../invoice/totals';
import { formatCurrency } from '../../invoice/format';
import { displayPhone, parseIntakeText } from '../../invoice/intake';
import { researchSettings, renderHeading, renderResearchPrompt, DEFAULT_RESEARCH_HEADING, DEFAULT_RESEARCH_PROMPT } from '../../invoice/aiSettings';
import { mergeResearch } from '../../invoice/research';
import { Btn, Notice, StatusBadge } from './ui';

interface JobLike { id: string; description: string | null; intake?: any; client_phone?: string | null; client_name?: string | null; client_email?: string | null; invoice_number?: string | null; role?: string }

/** The job page's invoicing card: invoice chips, the parsed intake (with warnings), and the "AI Research" button. */
export default function JobInvoicePanel({ job, canEdit, onChanged }: { job: JobLike; canEdit: boolean; onChanged: () => void }) {
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [researching, setResearching] = useState(false);
  const taskRef = useRef<string | null>(null);
  const taskKey = `ge.invoice.research.${job.id}`;

  const intake = useMemo(() => job.intake ?? parseIntakeText(job.description), [job.intake, job.description]);
  const stored = !!job.intake;
  const load = useCallback(() => { invoicesApi.list().then(r => setRecords(r.filter(x => x.job_id === job.id))).catch(() => {}); }, [job.id]);
  useEffect(load, [load]);

  // A research task started before navigating away keeps running on the server; resume polling when the page is opened again.
  const poll = useCallback(async (id: string) => {
    setResearching(true); taskRef.current = id;
    const heading = renderHeading(DEFAULT_RESEARCH_HEADING, 'research');
    try {
      for (let i = 0; i < 400 && taskRef.current === id; i++) {
        const t = await aiApi.poll(id);
        if (t.status === 'done') {
          const ai = await aiApi.settings(); const r = researchSettings(ai);
          const next = mergeResearch(job.description, renderHeading(r?.heading || heading, r?.model || 'AI'), t.content || '*No research generated.*');
          await jobsApi.patch(job.id, { description: next });
          try { sessionStorage.removeItem(taskKey); } catch { /* ignore */ }
          setMsg({ tone: 'ok', text: 'Research added to the job notes.' }); onChanged(); break;
        }
        if (t.status === 'error') { try { sessionStorage.removeItem(taskKey); } catch { /* ignore */ } setMsg({ tone: 'error', text: t.error || 'The research failed.' }); break; }
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e: any) { try { sessionStorage.removeItem(taskKey); } catch { /* ignore */ } setMsg({ tone: 'error', text: /not found|expired/i.test(e.message || '') ? 'The research task expired. Start it again.' : e.message || 'The research failed.' }); }
    finally { setResearching(false); taskRef.current = null; }
  }, [job.description, job.id, onChanged, taskKey]);

  useEffect(() => { let id: string | null = null; try { id = sessionStorage.getItem(taskKey); } catch { /* ignore */ } if (id) void poll(id); return () => { taskRef.current = null; }; /* eslint-disable-next-line */ }, [job.id]);

  const startResearch = async () => {
    setMsg(null);
    try {
      const ai = await aiApi.settings(); const r = researchSettings(ai);
      if (!r) { setMsg({ tone: 'error', text: 'Set up the Research endpoint in Settings → AI first.' }); return; }
      const v = intake.vehicle;
      const prompt = renderResearchPrompt(r.prompt || DEFAULT_RESEARCH_PROMPT, { vehicle: v ? ([v.year, v.make, v.model, v.engine].filter(Boolean).join(' ') || v.raw || '') : '', services: intake.services, notes: intake.symptoms });
      const t = await aiApi.start({ base_url: r.base_url, model: r.model, api_key: r.api_key || '', timeout_s: r.timeout_s }, [{ role: 'user', content: prompt }]);
      try { sessionStorage.setItem(taskKey, t.id); } catch { /* ignore */ }
      setMsg({ tone: 'info', text: 'Researching in the background. You can leave this page.' }); void poll(t.id);
    } catch (e: any) { setMsg({ tone: 'error', text: e.message || 'Could not start the research.' }); }
  };
  const cancel = async () => { const id = taskRef.current; taskRef.current = null; setResearching(false); try { sessionStorage.removeItem(taskKey); } catch { /* ignore */ } if (id) await aiApi.cancel(id).catch(() => {}); setMsg({ tone: 'info', text: 'Research cancelled.' }); };

  const saveIntake = async () => { try { await jobsApi.patch(job.id, { intake: { ...intake, source: intake.source === 'api' ? 'api' : 'manual' }, ...(intake.contact.phone && !job.client_phone ? { client_phone: intake.contact.phone } : {}) }); setMsg({ tone: 'ok', text: 'Parsed details saved to the job.' }); onChanged(); } catch (e: any) { setMsg({ tone: 'error', text: e.message }); } };

  const v = intake.vehicle; const vehicle = v ? [v.year, v.make, v.model, v.engine].filter(Boolean).join(' ') || v.raw : '';
  const hasIntake = !!(intake.contact.name || intake.contact.email || intake.contact.phone || vehicle || intake.services.length || intake.symptoms);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-[#1c172d]/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="w-4 h-4 text-indigo-400" /><span className="text-sm font-semibold text-white">Invoices &amp; estimates</span>
        <span className="flex flex-wrap gap-1.5 ml-1">{records.map(r => (
          <Link key={r.id} to={`/invoices?open=${r.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs text-gray-200">
            <span className="font-mono">{r.invoice.meta.invoiceNumber || '—'}</span><StatusBadge status={r.invoice.meta.status} docType={r.invoice.meta.docType} /><span className="tabular-nums">{formatCurrency(calculateTotals(r.invoice).grandTotal)}</span></Link>))}</span>
        {canEdit && <Link to={`/invoices?job=${job.id}`} className="inline-flex items-center gap-1 rounded-full bg-[#7c3bed] hover:bg-[#6d2fd6] px-3 py-1 text-xs font-medium text-white"><Plus className="w-3 h-3" />{records.length ? 'Open' : 'Create estimate'}</Link>}
        {canEdit && (researching
          ? <Btn size="sm" onClick={cancel}><Loader2 className="w-3.5 h-3.5 animate-spin" />Researching… <X className="w-3 h-3" /></Btn>
          : <Btn size="sm" onClick={startResearch} title="Search the web for labor times, videos and parts for this job"><Search className="w-3.5 h-3.5" />AI Research</Btn>)}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {hasIntake && (
        <div className="rounded-xl border border-white/5 bg-black/20 p-3 text-xs text-gray-300 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <div className="sm:col-span-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500"><span>Intake{intake.source === 'api' ? ' (from your website)' : stored ? '' : ' (read from the description)'}</span>{canEdit && !stored && <button onClick={saveIntake} className="normal-case text-violet-300 hover:text-violet-200 text-xs">Save these details to the job</button>}</div>
          <div><span className="text-gray-500">Customer:</span> {intake.contact.name || '—'}</div>
          <div><span className="text-gray-500">Phone:</span> {displayPhone(intake.contact.phone) || '—'}</div>
          <div><span className="text-gray-500">E-mail:</span> {intake.contact.email || '—'}</div>
          <div><span className="text-gray-500">Location:</span> {intake.location?.raw || '—'}</div>
          <div><span className="text-gray-500">Vehicle:</span> {vehicle || '—'}</div>
          <div><span className="text-gray-500">Parts:</span> {intake.partsPolicy === 'own-parts' ? 'customer supplies' : intake.partsPolicy === 'request-inspection' ? 'inspect first' : 'unspecified'}</div>
          <div className="sm:col-span-2"><span className="text-gray-500">Services:</span> {intake.services.join(', ') || '—'}</div>
          {intake.symptoms && <div className="sm:col-span-2 whitespace-pre-wrap"><span className="text-gray-500">Symptoms:</span> {intake.symptoms}</div>}
          {intake.quote && <div className="sm:col-span-2 text-sky-300">Website quote: {intake.quote.hourlyRate != null ? `$${intake.quote.hourlyRate}/hr` : ''}{intake.quote.baseFee != null ? ` · $${intake.quote.baseFee} fee` : ''}</div>}
          {intake.warnings.length > 0 && <div className="sm:col-span-2 text-amber-300">{intake.warnings.map(w => w.message).join(' ')}</div>}
        </div>)}
    </div>
  );
}
