import { useEffect, useState } from 'react';
import { BarChart, ShieldAlert } from 'lucide-react';
import { api, hasSession } from '../e2ee/session';
import { getReportPrefs, enableReportFigures, updateReportFigures, disableReportFigures, refreshReportSnapshot } from '../e2ee/reportSnapshot';

/**
 * Opt-in control for e-mails that include real figures (income, expenses, winners vs. loss leaders).
 * Off: e-mails only say how many entries were added. On: the server can read a small aggregate summary built in this browser.
 */
export default function ReportFigures() {
  const [status, setStatus] = useState<{ report_delegated: boolean; report_available: boolean; snapshot_updated_at: string | null } | null>(null);
  const [jobNames, setJobNames] = useState(true);
  const [catNames, setCatNames] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const s = await api('GET', '/api/settings/reports');
    setStatus(s);
    const p = await getReportPrefs();
    setJobNames(p.include_job_names); setCatNames(p.include_category_names);
  };
  useEffect(() => { if (hasSession()) load().catch(() => setStatus(null)); }, []);
  if (!status) return null;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMessage('');
    try { await fn(); await load(); setMessage(ok); } catch (e: any) { setMessage(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };
  const opts = { include_job_names: jobNames, include_category_names: catNames };

  return (
    <div className="pt-6 border-t border-white/5 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm text-gray-300">
          <div className="font-medium text-white mb-1">Include real figures in report e-mails (reduces privacy)</div>
          Your data is end-to-end encrypted, so by default report e-mails only say how many entries were added. Turn this on to get income, expenses,
          week-over-week change and your <strong>winners vs. loss leaders</strong>. Your app builds a small summary (daily totals per job and category) and
          uploads it encrypted; the server may decrypt <strong>only that summary</strong> to write each e-mail. It never receives individual expenses,
          notes, clients or receipts. The figures also travel through your e-mail provider in plain text. Turn it off any time and the server deletes the summary and the key.
          <div className="mt-1 text-xs text-gray-500">Figures are as fresh as your last visit to the app (it updates itself whenever you add or change entries).</div>
          {!status.report_available && <div className="mt-2 text-amber-300">This server has not been configured for reports with figures.</div>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-sm text-gray-300">
        <label className="flex items-center gap-2"><input type="checkbox" checked={jobNames} disabled={busy} onChange={e => { setJobNames(e.target.checked); if (status.report_delegated) run(() => updateReportFigures({ ...opts, include_job_names: e.target.checked }), 'Updated.'); }} /> Include job names (otherwise “Job 1, Job 2…”)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={catNames} disabled={busy} onChange={e => { setCatNames(e.target.checked); if (status.report_delegated) run(() => updateReportFigures({ ...opts, include_category_names: e.target.checked }), 'Updated.'); }} /> Include category/tag names</label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status.report_delegated ? (
          <>
            <button disabled={busy} onClick={() => run(disableReportFigures, 'Turned off. The server no longer has your summary or key.')} className="rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Turn off figures</button>
            <button disabled={busy} onClick={() => run(async () => { await refreshReportSnapshot(); }, 'Summary refreshed.')} className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 disabled:opacity-40"><BarChart className="w-4 h-4" /> Refresh summary now</button>
            {status.snapshot_updated_at && <span className="text-xs text-gray-500">Last synced {new Date(status.snapshot_updated_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>}
          </>
        ) : (
          <button disabled={busy || !status.report_available} onClick={() => run(() => enableReportFigures(opts), 'Turned on. Use “Send Test Email” to preview it.')} className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Turn on figures</button>
        )}
      </div>
      {message && <div className="text-xs text-gray-400">{message}</div>}
    </div>
  );
}
