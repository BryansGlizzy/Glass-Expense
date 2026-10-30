/**
 * Opt-in "reports with figures".
 *
 * The server cannot read expenses, so the scheduled report e-mail is built from a compact aggregate that THIS browser computes
 * and uploads encrypted under a dedicated report key: totals per day / job / category for the last ~10 weeks. Individual
 * entries, notes, clients and receipts never leave the vault. Job and category names are included only if the user chooses.
 *
 * The snapshot is rebuilt whenever relevant data changes while the app is open and when the app starts, so e-mails are as fresh
 * as the user's last visit; e-mails say so when it is stale.
 */
import * as C from './crypto';
import { api, getSession, hasSession } from './session';
import { getBlob, setBlob, listJobs, listExpenses } from './store';

export interface ReportPrefs { enabled: boolean; key: string | null; include_job_names: boolean; include_category_names: boolean }
const DEFAULT_PREFS: ReportPrefs = { enabled: false, key: null, include_job_names: true, include_category_names: true };
const WINDOW_DAYS = 70;

export async function getReportPrefs(): Promise<ReportPrefs> {
  const p = await getBlob<any>('preferences', {});
  return { ...DEFAULT_PREFS, ...(p.reports || {}) };
}
const saveReportPrefs = async (reports: ReportPrefs) => setBlob('preferences', { ...(await getBlob<any>('preferences', {})), reports });

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Aggregates the user's own decrypted data into the snapshot structure the server understands. */
export async function buildSnapshot(prefs: Pick<ReportPrefs, 'include_job_names' | 'include_category_names'>) {
  const since = ymd(new Date(Date.now() - WINDOW_DAYS * 86400000));
  const jobs = (await listJobs()).filter(j => !j.locked && !j.is_archived);
  const jobNames: string[] = [];
  const catNames: string[] = [];
  const catIndex = new Map<string, number>();
  const agg = new Map<string, [string, number, number, number, number, number]>();

  for (const job of jobs) {
    const jIdx = jobNames.push(prefs.include_job_names ? job.title : `Job ${jobNames.length + 1}`) - 1;
    for (const e of await listExpenses(job.id)) {
      const date = String(e.date || e.created_at || '').slice(0, 10);
      if (!date || date < since) continue;
      let cIdx = -1;
      if (e.tags.length) {
        const label = prefs.include_category_names ? e.tags[0].name : `Category ${(catIndex.get(e.tags[0].id) ?? catIndex.size) + 1}`;
        if (!catIndex.has(e.tags[0].id)) { catIndex.set(e.tags[0].id, catNames.length); catNames.push(label); }
        cIdx = catIndex.get(e.tags[0].id)!;
      }
      const key = `${date}|${jIdx}|${cIdx}`;
      const row = agg.get(key) ?? [date, jIdx, cIdx, 0, 0, 0];
      if (e.entry_type === 'income') row[3] += e.amount; else row[4] += e.amount;
      row[5] += 1;
      agg.set(key, row);
    }
  }
  return {
    v: 1 as const, generated_at: new Date().toISOString(),
    include_job_names: prefs.include_job_names, include_category_names: prefs.include_category_names,
    jobs: jobNames, cats: catNames,
    rows: [...agg.values()].map(r => [r[0], r[1], r[2], Math.round(r[3] * 100) / 100, Math.round(r[4] * 100) / 100, r[5]]),
  };
}

export async function refreshReportSnapshot(): Promise<boolean> {
  if (!hasSession()) return false;
  const prefs = await getReportPrefs();
  if (!prefs.enabled || !prefs.key) return false;
  const s = getSession();
  const snapshot = await buildSnapshot(prefs);
  const enc = await C.encryptJson(C.fromB64(prefs.key), snapshot, `report-snapshot|${s.userId}`);
  await api('PUT', '/api/settings/reports/snapshot', { body: { enc } });
  return true;
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced refresh; cheap to call after every write or real-time event. */
export function scheduleSnapshotRefresh(delayMs = 4000) {
  if (!hasSession()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; refreshReportSnapshot().catch(() => { /* retried on next change */ }); }, delayMs);
}

export async function enableReportFigures(opts: { include_job_names: boolean; include_category_names: boolean }): Promise<void> {
  const key = C.toB64(C.randomBytes(32)); // fresh key every time it is switched on, so a previously revoked key is never reused
  await api('POST', '/api/settings/reports/delegation', { body: { report_key: key } });
  await saveReportPrefs({ enabled: true, key, ...opts });
  await refreshReportSnapshot();
}

export async function updateReportFigures(opts: { include_job_names: boolean; include_category_names: boolean }): Promise<void> {
  const prefs = await getReportPrefs();
  if (!prefs.enabled) return;
  await saveReportPrefs({ ...prefs, ...opts });
  await refreshReportSnapshot();
}

export async function disableReportFigures(): Promise<void> {
  await api('DELETE', '/api/settings/reports/delegation'); // server forgets the key AND deletes the stored snapshot
  await saveReportPrefs({ ...DEFAULT_PREFS });
}
