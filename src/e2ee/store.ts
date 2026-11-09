/**
 * Encrypted record store. Turns server ciphertext rows into the plaintext "view" objects the UI has always used
 * (same field names as the pre-encryption API), and turns UI edits back into ciphertext.
 */
import * as C from './crypto';
import { api, cached, invalidate, prime, getSession, getJobKey, requireJobKey, HttpError } from './session';
import type { JobIntake } from '../invoice/intake';

// ── Plaintext shapes (what the encrypted blobs contain) ──────────────────────
export interface JobBlob {
  title: string; description: string | null; mode: 'expense' | 'budget';
  client_name: string | null; client_address: string | null; client_email: string | null;
  /** Added by Invoicing 2.0; older blobs simply lack them (see emptyJobBlob). Every copy of this shape must carry them (blobOf in handlers/jobs.ts, server/agent-core.ts). */
  client_phone: string | null; intake: JobIntake | null;
  job_rate: number; invoice_notes: string | null; invoice_tag: string | null; invoice_seq: number | null; invoice_number: string | null;
  google_sync_expenses: number;
}
export interface TagRef { id: string; name: string; color: string }
export interface ExpenseBlob { amount: number; description: string | null; entry_type: 'expense' | 'income'; date: string | null; tags: TagRef[] }
export interface WishlistBlob { name: string; estimated_cost: number | null; url: string | null; notes: string | null }
export interface SubscriptionBlob {
  amount: number; description: string | null; entry_type: 'expense' | 'income'; billing_day: number;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY'; last_generated_at: string | null;
}

export const emptyJobBlob = (): JobBlob => ({
  title: '', description: null, mode: 'expense', client_name: null, client_address: null, client_email: null, client_phone: null, intake: null, job_rate: 0,
  invoice_notes: null, invoice_tag: null, invoice_seq: null, invoice_number: null, google_sync_expenses: 0,
});

// ── Views (shape the UI expects) ─────────────────────────────────────────────
export interface JobView extends JobBlob {
  id: string; created_by: string; owner_name?: string; is_archived: number; start_date: string | null; end_date: string | null;
  created_at: string; updated_at: string; google_event_id?: string | null; role: 'owner' | 'member';
  total_expenses: number; total_income: number; locked?: boolean;
}
export interface ExpenseView extends ExpenseBlob {
  id: string; job_id: string; user_id: string; user_name: string; receipt_url: string | null; is_encrypted: number; created_at: string;
}

// ── Personal encrypted blobs (tags, tax settings, ...) ───────────────────────
type BlobName = 'tags' | 'tax_settings' | 'tax_mappings' | 'w2_forms' | 'invoice_template' | 'invoice_packages' | 'ai_settings' | 'preferences';
interface BlobEntry { value: any; version: number }

const loadBlobs = () => cached('blobs', async () => {
  const s = getSession();
  const rows = await api<Array<{ name: BlobName; enc: string; version: number }>>('GET', '/api/v2/blobs');
  const out = new Map<string, BlobEntry>();
  for (const r of rows) {
    try { out.set(r.name, { value: await C.decryptJson(s.keys.udk, r.enc, C.aad.blob(s.userId, r.name)), version: r.version }); }
    catch { console.warn(`Could not decrypt personal data "${r.name}"`); }
  }
  return out;
}, 4000);

export async function getBlob<T>(name: BlobName, fallback: T): Promise<T> {
  const entry = (await loadBlobs()).get(name);
  return entry ? (entry.value as T) : fallback;
}

export async function setBlob(name: BlobName, value: unknown): Promise<void> {
  const s = getSession();
  const enc = await C.encryptJson(s.keys.udk, value, C.aad.blob(s.userId, name));
  invalidate('blobs');
  const current = (await loadBlobs()).get(name);
  try {
    await api('PUT', `/api/v2/blobs/${name}`, { body: { enc, expected_version: current?.version } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) { // another device wrote in between: last write wins
      invalidate('blobs');
      await api('PUT', `/api/v2/blobs/${name}`, { body: { enc } });
    } else throw e;
  }
  invalidate('blobs');
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
const fetchJobRows = () => cached('jobs:rows', () => api<any[]>('GET', '/api/v2/jobs'));

async function decryptJobRow(row: any): Promise<Omit<JobView, 'total_expenses' | 'total_income'>> {
  const base = {
    id: row.id, created_by: row.created_by, owner_name: row.owner_name, is_archived: row.is_archived, start_date: row.start_date,
    end_date: row.end_date, created_at: row.created_at, updated_at: row.updated_at, google_event_id: row.google_event_id, role: row.role,
  };
  const key = row.enc ? await getJobKey(row.id) : null;
  if (!row.enc || !key) {
    return { ...emptyJobBlob(), ...base, title: row.enc ? '🔒 Waiting for access' : '🔒 Awaiting owner upgrade', locked: true };
  }
  try {
    return { ...emptyJobBlob(), ...(await C.decryptJson<JobBlob>(key, row.enc, C.aad.job(row.id))), ...base };
  } catch {
    return { ...emptyJobBlob(), ...base, title: '🔒 Could not decrypt', locked: true };
  }
}

/** One request for every expense in every accessible job; decrypted per job and cached so later per-job reads are free. */
async function primeAllExpenses(jobIds: string[]): Promise<void> {
  const rows = await api<any[]>('GET', '/api/v2/expenses');
  const byJob = new Map<string, any[]>();
  for (const r of rows) { if (!byJob.has(r.job_id)) byJob.set(r.job_id, []); byJob.get(r.job_id)!.push(r); }
  await Promise.all(jobIds.map(async id => {
    const key = await getJobKey(id);
    const list = key ? (await Promise.all((byJob.get(id) || []).map(r => decryptExpenseRow(r, key)))).filter((e): e is ExpenseView => e !== null) : [];
    prime(`expenses:${id}`, list);
  }));
}

/**
 * Keeps the caller's own calendar label (job title encrypted under *their* calendar key) in step with the job title, so the
 * calendar API shows titles for jobs they were invited into and after the owner renames a job.
 */
const labelChecked = new Set<string>();
async function syncCalendarLabels(rows: any[], jobs: Array<Omit<JobView, 'total_expenses' | 'total_income'>>) {
  const s = getSession();
  const work = jobs.map(async (j, i) => {
    if (j.locked || !j.title) return;
    const stamp = `${s.userId}|${j.id}|${j.title}`;
    if (labelChecked.has(stamp)) return;
    let current: string | null = null;
    if (rows[i].my_label) { try { current = await C.decryptCalendarTitle(s.keys.calendarKey, j.id, rows[i].my_label); } catch { current = null; } }
    if (current === j.title) { labelChecked.add(stamp); return; }
    try {
      await api('PUT', `/api/v2/jobs/${j.id}/calendar-label`, { body: { title_enc: await C.encryptCalendarTitle(s.keys.calendarKey, j.id, j.title) } });
      labelChecked.add(stamp);
    } catch { /* retried on the next load */ }
  });
  await Promise.all(work);
}

export async function listJobs(): Promise<JobView[]> {
  const rows = await fetchJobRows();
  const jobs = await Promise.all(rows.map(decryptJobRow));
  await syncCalendarLabels(rows, jobs);
  const unlocked = jobs.filter(j => !j.locked).map(j => j.id);
  if (unlocked.length > 2) await cached('expenses:bulk', () => primeAllExpenses(unlocked));
  return Promise.all(jobs.map(async j => {
    if (j.locked) return { ...j, total_expenses: 0, total_income: 0 };
    const expenses = await listExpenses(j.id);
    let ex = 0, inc = 0;
    for (const e of expenses) (e.entry_type === 'income' ? (inc += e.amount) : (ex += e.amount));
    return { ...j, total_expenses: ex, total_income: inc };
  }));
}

export async function getJob(id: string): Promise<JobView | null> {
  return (await listJobs()).find(j => j.id === id) ?? null;
}

export async function writeJob(jobId: string, blob: JobBlob, dates: { start_date: string | null; end_date: string | null }, opts: { create?: { jobKey: Uint8Array } } = {}) {
  const s = getSession();
  const key = opts.create?.jobKey ?? await requireJobKey(jobId);
  const body: any = {
    enc: await C.encryptJson(key, blob, C.aad.job(jobId)),
    start_date: dates.start_date || null,
    end_date: dates.end_date || null,
    calendar_title_enc: await C.encryptCalendarTitle(s.keys.calendarKey, jobId, blob.title || 'Job'),
  };
  invalidate('jobs');
  if (opts.create) {
    return api('POST', '/api/v2/jobs', { body: { id: jobId, ...body, key: await C.wrapJobKeyForSelf(s.keys.mk, opts.create.jobKey) } });
  }
  return api('PUT', `/api/v2/jobs/${jobId}`, { body });
}

// ── Expenses ─────────────────────────────────────────────────────────────────
export async function decryptExpenseRow(row: any, key: Uint8Array): Promise<ExpenseView | null> {
  if (!row.enc) return null;
  try {
    const blob = await C.decryptJson<ExpenseBlob>(key, row.enc, C.aad.expense(row.job_id, row.id));
    return {
      amount: 0, description: null, entry_type: 'expense', date: null, tags: [], ...blob,
      id: row.id, job_id: row.job_id, user_id: row.user_id, user_name: row.user_name, receipt_url: row.receipt_url,
      is_encrypted: row.is_encrypted, created_at: row.created_at,
    };
  } catch { return null; }
}

export async function listExpenses(jobId: string): Promise<ExpenseView[]> {
  return cached(`expenses:${jobId}`, async () => {
    const key = await getJobKey(jobId);
    if (!key) return [];
    const rows = await api<any[]>('GET', `/api/v2/jobs/${jobId}/expenses`);
    return (await Promise.all(rows.map(r => decryptExpenseRow(r, key)))).filter((e): e is ExpenseView => e !== null);
  });
}

export const encExpense = async (jobId: string, id: string, blob: ExpenseBlob) =>
  C.encryptJson(await requireJobKey(jobId), blob, C.aad.expense(jobId, id));

export const toExpenseBlob = (e: Partial<ExpenseBlob>): ExpenseBlob => ({
  amount: Number(e.amount) || 0, description: e.description ?? null, entry_type: e.entry_type === 'income' ? 'income' : 'expense',
  date: e.date ?? null, tags: e.tags ?? [],
});

/** All expenses across all accessible, unlocked jobs. */
export async function listAllExpenses(): Promise<ExpenseView[]> {
  const jobs = (await listJobs()).filter(j => !j.locked);
  return (await Promise.all(jobs.map(j => listExpenses(j.id)))).flat();
}

// ── Wishlist & subscriptions ─────────────────────────────────────────────────
export async function listWishlist(jobId: string) {
  const key = await getJobKey(jobId);
  if (!key) return [];
  const rows = await api<any[]>('GET', `/api/v2/jobs/${jobId}/wishlist`);
  const out = [];
  for (const r of rows) {
    if (!r.enc) continue;
    try {
      const b = await C.decryptJson<WishlistBlob>(key, r.enc, C.aad.wishlist(jobId, r.id));
      out.push({ id: r.id, job_id: jobId, user_id: r.user_id, user_name: r.user_name, created_at: r.created_at, ...b });
    } catch { /* undecryptable item */ }
  }
  return out;
}

export async function listSubscriptions(jobId: string) {
  const key = await getJobKey(jobId);
  if (!key) return [];
  const rows = await api<any[]>('GET', `/api/v2/jobs/${jobId}/subscriptions`);
  const out = [];
  for (const r of rows) {
    if (!r.enc) continue;
    try {
      const b = await C.decryptJson<SubscriptionBlob>(key, r.enc, C.aad.subscription(jobId, r.id));
      out.push({
        id: r.id, job_id: jobId, user_id: r.user_id, is_active: r.is_active, created_at: r.created_at, next_generation_date: r.next_generation_date,
        remind_1_day_before: r.remind_1_day_before, remind_2_days_before: r.remind_2_days_before, remind_7_days_before: r.remind_7_days_before, ...b,
      });
    } catch { /* undecryptable item */ }
  }
  return out;
}

export const uuid = (): string => globalThis.crypto.randomUUID();

/** Deterministic UUID-shaped id, so two devices generating the same recurring expense collide instead of duplicating. */
export async function deterministicUuid(seed: string): Promise<string> {
  const h = C.toHex((await C.sha256(seed)).subarray(0, 16)).split('');
  h[12] = '4'; h[16] = '8';
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
