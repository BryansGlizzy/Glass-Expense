import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api, getSession, hasSession } from '../e2ee/session';
import * as C from '../e2ee/crypto';
import { listJobs } from '../e2ee/store';

/**
 * Background Google Calendar sync needs the server to read job titles, which are end-to-end encrypted. This is an explicit,
 * revocable opt-in: it hands the server the *calendar key* only (job titles + dates). It can never read expenses, clients,
 * notes, amounts or receipts.
 */
export default function GoogleServerSync() {
  const [status, setStatus] = useState<{ serverSyncEnabled: boolean; serverSyncAvailable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => api('GET', '/api/settings/google').then(setStatus).catch(() => setStatus(null));
  useEffect(() => { if (hasSession()) load(); }, []);
  if (!status) return null;

  const toggle = async () => {
    setBusy(true); setMessage('');
    try {
      if (status.serverSyncEnabled) {
        await api('DELETE', '/api/settings/google/delegation');
        setMessage('Background sync turned off. The server can no longer read your job titles.');
      } else {
        await api('POST', '/api/settings/google/delegation', { body: { calendar_key: C.toB64(getSession().keys.calendarKey) } });
        // Re-send each job's label so existing jobs are pushed to Google now.
        const s = getSession();
        for (const job of (await listJobs()).filter(j => !j.locked && j.start_date)) {
          await api('PUT', `/api/v2/jobs/${job.id}/calendar-label`, { body: { title_enc: await C.encryptCalendarTitle(s.keys.calendarKey, job.id, job.title) } }).catch(() => {});
        }
        setMessage('Background sync turned on. Your jobs are being added to Google Calendar.');
      }
      await load();
    } catch (e: any) { setMessage(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="text-sm text-gray-300">
          <div className="font-medium text-white mb-1">Allow background sync (reduces privacy)</div>
          Your job titles are end-to-end encrypted. To add them to Google Calendar while the app is closed, the server needs permission to read
          <strong> job titles and dates only</strong> (never expenses, clients, notes or amounts). Google will also see them. You can turn this off any time.
          {!status.serverSyncAvailable && <div className="mt-2 text-amber-300">This server has not been configured for background sync.</div>}
        </div>
      </div>
      <button onClick={toggle} disabled={busy || (!status.serverSyncEnabled && !status.serverSyncAvailable)}
        className="rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
        {busy ? 'Working…' : status.serverSyncEnabled ? 'Turn off background sync' : 'Turn on background sync'}
      </button>
      {message && <div className="text-xs text-gray-400">{message}</div>}
    </div>
  );
}
