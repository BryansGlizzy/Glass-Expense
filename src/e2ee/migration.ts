/**
 * One-time migration of an account created before end-to-end encryption.
 *
 * Runs in the user's browser after the account keys have been upgraded. It downloads the user's own legacy plaintext,
 * encrypts everything locally and uploads ciphertext; the server scrubs each plaintext row as it is replaced and finally
 * VACUUMs the database. It is resumable: if it is interrupted it can simply be run again.
 */
import * as C from './crypto';
import { api, getSession, rememberJobKey, invalidate, ensureJobKeys, peekJobKey } from './session';
import { JobBlob, ExpenseBlob, WishlistBlob, SubscriptionBlob, setBlob } from './store';
import { nextSubscriptionDate } from './subscriptions';

type Progress = (message: string, fraction: number) => void;

const jobBlobFrom = (j: any): JobBlob => ({
  title: j.title || 'Untitled job', description: j.description ?? null, mode: j.mode === 'budget' ? 'budget' : 'expense',
  client_name: j.client_name ?? null, client_address: j.client_address ?? null, client_email: j.client_email ?? null, client_phone: null, intake: null, job_rate: Number(j.job_rate) || 0,
  invoice_notes: j.invoice_notes ?? null, invoice_tag: j.invoice_tag ?? null, invoice_seq: j.invoice_seq ?? null, invoice_number: j.invoice_number ?? null,
  google_sync_expenses: j.google_sync_expenses ? 1 : 0,
});

const dateOnly = (v: any): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function migrateLegacyData(onProgress: Progress = () => {}): Promise<{ jobs: number; expenses: number; receipts: number }> {
  const s = getSession();
  onProgress('Reading your existing data…', 0.02);
  const exp = await api<any>('GET', '/api/legacy/export');
  const stats = { jobs: 0, expenses: 0, receipts: 0 };

  await ensureJobKeys(true);
  const legacyKeyRows = new Map<string, string>((exp.job_keys || []).map((k: any) => [k.job_id, k.encrypted_job_key]));
  const totalWork = (exp.jobs?.length || 0) + (exp.expenses?.length || 0) + 8;
  let done = 0;
  const tick = (msg: string) => onProgress(msg, Math.min(0.95, 0.05 + 0.9 * (++done / totalWork)));

  // Job keys we hold for every owned job (unwrapped from the server) or can recover/create.
  const keyFor = async (jobId: string): Promise<Uint8Array> => {
    const existing = peekJobKey(jobId); // all server-held keys were loaded once above; no per-job lookup
    if (existing) return existing;
    let raw: Uint8Array | null = null;
    const wrapped = legacyKeyRows.get(jobId);
    if (wrapped) { try { raw = await C.unwrapJobKeyForSelf(s.keys.mk, wrapped); } catch { raw = null; } }
    if (!raw) { // very old clients kept the raw key in localStorage
      const local = typeof localStorage !== 'undefined' ? localStorage.getItem(`job_key_${jobId}`) : null;
      if (local) { try { raw = C.fromB64(local); } catch { raw = null; } }
    }
    if (!raw) raw = C.generateJobKey();
    await api('PUT', `/api/v2/jobs/${jobId}/key`, { body: { encrypted_key: await C.wrapJobKeyForSelf(s.keys.mk, raw) } }).catch(async () => {
      // The job row may not exist yet in v2 terms; the PUT key route needs owner access which is true for owned jobs.
    });
    rememberJobKey(jobId, raw);
    return raw;
  };

  // ── Owned jobs and everything inside them ──────────────────────────────────
  for (const job of exp.jobs || []) {
    tick(`Encrypting job “${job.title}”…`);
    const key = await keyFor(job.id);
    await api('PUT', `/api/v2/jobs/${job.id}`, { body: {
      enc: await C.encryptJson(key, jobBlobFrom(job), C.aad.job(job.id)), start_date: dateOnly(job.start_date), end_date: dateOnly(job.end_date),
      calendar_title_enc: await C.encryptCalendarTitle(s.keys.calendarKey, job.id, job.title || 'Job'),
    } });
    stats.jobs++;
  }
  // Jobs that were already encrypted but whose key we need for remaining children (resume case)
  const ownedIds: string[] = exp.owned_job_ids || [];

  const byJob = (rows: any[] | undefined) => {
    const m = new Map<string, any[]>();
    for (const r of rows || []) { if (!m.has(r.job_id)) m.set(r.job_id, []); m.get(r.job_id)!.push(r); }
    return m;
  };
  const expensesByJob = byJob(exp.expenses);
  const wishByJob = byJob(exp.wishlist);
  const subsByJob = byJob(exp.subscriptions);

  for (const jobId of ownedIds) {
    const expenses = expensesByJob.get(jobId) || [];
    const wishlist = wishByJob.get(jobId) || [];
    const subs = subsByJob.get(jobId) || [];
    if (!expenses.length && !wishlist.length && !subs.length) continue;
    const key = await keyFor(jobId);

    const toRewrite = expenses.filter(e => e.enc == null);
    for (const batch of chunk(toRewrite, 200)) {
      const items = [];
      for (const e of batch) {
        const blob: ExpenseBlob = {
          amount: Number(e.amount) || 0, description: e.description ?? null, entry_type: e.entry_type === 'income' ? 'income' : 'expense',
          date: dateOnly(e.date), tags: (e.tags || []).map((t: any) => ({ id: t.id, name: t.name, color: t.color })),
        };
        items.push({ id: e.id, enc: await C.encryptJson(key, blob, C.aad.expense(jobId, e.id)) });
      }
      await api('POST', `/api/v2/jobs/${jobId}/expenses/rewrite`, { body: { items } });
      stats.expenses += batch.length; done += batch.length; onProgress(`Encrypting entries… (${stats.expenses})`, Math.min(0.95, 0.05 + 0.9 * (done / totalWork)));
    }

    // Plaintext receipts: download, encrypt with the job key, upload in place of the original.
    const aes = await C.cachedAesKey(key);
    for (const e of expenses.filter(x => x.receipt_url && !x.is_encrypted)) {
      try {
        const res = await api<Response>('GET', `/api/v2/uploads/${encodeURIComponent(String(e.receipt_url).split('/').pop() || '')}`, { raw: true });
        const sealed = await C.seal(aes, new Uint8Array(await res.arrayBuffer()));
        const f = new FormData();
        f.append('receipt', new Blob([sealed], { type: 'application/octet-stream' }), 'receipt.bin');
        await api('PATCH', `/api/v2/jobs/${jobId}/expenses/${e.id}/receipt`, { form: f });
        stats.receipts++;
        onProgress(`Encrypting receipts… (${stats.receipts})`, Math.min(0.95, 0.05 + 0.9 * (done / totalWork)));
      } catch (err) { console.warn('Could not re-encrypt a receipt', e.id, (err as Error).message); }
    }

    for (const w of wishlist) {
      const blob: WishlistBlob = { name: w.name, estimated_cost: w.estimated_cost ?? null, url: w.url ?? null, notes: w.notes ?? null };
      await api('PUT', `/api/v2/jobs/${jobId}/wishlist/${w.id}`, { body: { enc: await C.encryptJson(key, blob, C.aad.wishlist(jobId, w.id)) } });
    }
    for (const sub of subs) {
      const blob: SubscriptionBlob = {
        amount: Number(sub.amount) || 0, description: sub.description ?? null, entry_type: sub.entry_type === 'income' ? 'income' : 'expense',
        billing_day: Number(sub.billing_day) || 1, frequency: ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'].includes(sub.frequency) ? sub.frequency : 'MONTHLY',
        last_generated_at: sub.last_generated_at ?? null,
      };
      const next = dateOnly(sub.next_generation_date) || nextSubscriptionDate(blob.frequency, new Date(), blob.billing_day);
      await api('PUT', `/api/v2/jobs/${jobId}/subscriptions/${sub.id}`, { body: {
        enc: await C.encryptJson(key, blob, C.aad.subscription(jobId, sub.id)), next_generation_date: next,
        remind_1_day_before: sub.remind_1_day_before, remind_2_days_before: sub.remind_2_days_before, remind_7_days_before: sub.remind_7_days_before,
      } });
    }
  }

  // ── Personal data → encrypted blobs ────────────────────────────────────────
  tick('Encrypting your personal settings…');
  if (exp.tags?.length) {
    await setBlob('tags', { tags: exp.tags.map((t: any) => ({ id: t.id, name: t.name, color: t.color, created_at: t.created_at })) });
  }
  const mappings = { tags: {} as Record<string, string>, expenses: {} as Record<string, string> };
  for (const m of exp.tag_tax_mappings || []) mappings.tags[m.tag_id] = m.schedule_c_line;
  for (const m of exp.expense_tax_mappings || []) mappings.expenses[m.expense_id] = m.schedule_c_line;
  if (Object.keys(mappings.tags).length || Object.keys(mappings.expenses).length) await setBlob('tax_mappings', mappings);

  if (exp.tax_settings) {
    const { user_id, created_at, ...rest } = exp.tax_settings;
    await setBlob('tax_settings', { ...rest, selected_job_ids: rest.selected_job_ids ? JSON.parse(rest.selected_job_ids) : null });
  }
  if (exp.w2_forms?.length) await setBlob('w2_forms', exp.w2_forms);
  if (exp.invoice_template) await setBlob('invoice_template', exp.invoice_template);
  const ai = exp.ai_settings || {};
  if (ai.ai_api_key || ai.use_on_device_ai) {
    await setBlob('ai_settings', {
      ai_api_key: ai.ai_api_key || '', ai_base_url: ai.ai_base_url || 'https://api.openai.com/v1', ai_model: ai.ai_model || 'gpt-4o-mini',
      use_on_device_ai: ai.use_on_device_ai ? 1 : 0, on_device_ai_model: ai.on_device_ai_model || 'tesseract',
    });
  }

  tick('Finalising and removing the old unencrypted copy…');
  await api('POST', '/api/v2/migration/complete');
  // Legacy localStorage keys are no longer needed (they live, wrapped, on the server now).
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('job_key_')) localStorage.removeItem(k); } catch { /* ignore */ }
  invalidate('');
  onProgress('Done', 1);
  return stats;
}
