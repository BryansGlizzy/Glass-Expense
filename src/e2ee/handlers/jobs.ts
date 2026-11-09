import * as C from '../crypto';
import { parseInvoiceSequence } from '../../utils/invoice';
import { api, getSession, getJobKey, requireJobKey, invalidate, ensureJobKeys, rememberJobKey, HttpError } from '../session';
import {
  JobBlob, JobView, emptyJobBlob, listJobs, getJob, writeJob, listExpenses, getBlob, uuid, encExpense, toExpenseBlob,
} from '../store';
import { nextInvoiceForTag } from '../invoice';
import { normalizeSettings } from '../../invoice/settings';
import { Route, Req, Res, ok, bad, NotFound, Forbidden } from './types';

const clean = (v: any, max = 5000): string | null => {
  if (v === undefined || v === null || v === '') return null;
  return String(v).slice(0, max);
};
/** Accepts a parsed intake only in the documented shape and size; anything else is dropped (null clears it). */
const cleanIntake = (v: any): JobBlob['intake'] => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.v !== 1) return null;
  try { const text = JSON.stringify(v); return text.length > 20000 ? null : JSON.parse(text); } catch { return null; }
};
const date = (v: any): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const blobOf = (j: JobView): JobBlob => ({
  title: j.title, description: j.description, mode: j.mode, client_name: j.client_name, client_address: j.client_address,
  client_email: j.client_email, client_phone: j.client_phone ?? null, intake: j.intake ?? null, job_rate: j.job_rate, invoice_notes: j.invoice_notes, invoice_tag: j.invoice_tag,
  invoice_seq: j.invoice_seq, invoice_number: j.invoice_number, google_sync_expenses: j.google_sync_expenses,
});

async function ownedJobs(): Promise<JobView[]> {
  return (await listJobs()).filter(j => j.role === 'owner' && !j.locked);
}
async function defaultPrefix(): Promise<string> {
  const t = await getBlob<any>('invoice_template', null);
  return (t?.invoicing ? normalizeSettings(t.invoicing).numbering.prefix : t?.default_prefix) || 'INV';
}

async function loadJobOr404(id: string): Promise<JobView> {
  const job = await getJob(id);
  if (!job) throw new NotFound('Job not found');
  return job;
}

export const jobRoutes: Route[] = [
  ['GET', /^\/api\/jobs$/, async ({ query }): Promise<Res> => {
    const search = (query.get('search') || '').trim().toLowerCase();
    let jobs = await listJobs();
    if (search) {
      jobs = jobs.filter(j => [j.title, j.description, j.invoice_number, j.id, j.client_name, j.client_email]
        .some(f => (f || '').toLowerCase().includes(search)));
    }
    return { json: jobs };
  }],

  ['GET', /^\/api\/jobs\/next-invoice-number$/, async ({ query }) => {
    return ok(nextInvoiceForTag(await ownedJobs(), await defaultPrefix(), query.get('tag'), query.get('jobId')));
  }],

  ['POST', /^\/api\/jobs$/, async ({ body }) => {
    const title = clean(body.title, 200);
    if (!title) bad('Title is required');
    const id = uuid();
    const jobKey = C.generateJobKey();
    const owned = await ownedJobs();
    const prefix = await defaultPrefix();
    const cleanTag = body.invoice_tag ? String(body.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : null;

    let invoiceNumber: string, seq: number;
    if (body.invoice_number && String(body.invoice_number).trim()) {
      invoiceNumber = String(body.invoice_number).trim().toUpperCase().slice(0, 40);
      const dup = owned.find(j => (j.invoice_number || '').toUpperCase() === invoiceNumber);
      if (dup) bad(`Invoice number "${invoiceNumber}" is already in use by job "${dup.title}". Please choose a unique invoice number.`);
      seq = parseInvoiceSequence(invoiceNumber) || nextInvoiceForTag(owned, prefix, cleanTag).nextSeq;
    } else {
      const next = nextInvoiceForTag(owned, prefix, cleanTag);
      invoiceNumber = next.invoiceNumber; seq = next.nextSeq;
    }

    const blob: JobBlob = {
      ...emptyJobBlob(), title, description: clean(body.description, 100000), mode: body.mode === 'budget' ? 'budget' : 'expense',
      client_name: clean(body.client_name, 200), client_address: clean(body.client_address, 500), client_email: clean(body.client_email, 254),
      client_phone: clean(body.client_phone, 40), intake: cleanIntake(body.intake),
      job_rate: Number(body.job_rate) || 0, invoice_notes: clean(body.invoice_notes), invoice_tag: cleanTag, invoice_seq: seq, invoice_number: invoiceNumber,
    };
    const result = await writeJob(id, blob, { start_date: date(body.start_date), end_date: date(body.end_date) }, { create: { jobKey } });
    rememberJobKey(id, jobKey);
    invalidate('jobs');
    const job = await getJob(id);
    return ok({ ...job, sync_status: (result as any)?.sync_status });
  }],

  ['GET', /^\/api\/jobs\/([^/]+)$/, async ({ m }) => ok(await loadJobOr404(m[1]))],

  ['PATCH', /^\/api\/jobs\/([^/]+)$/, async ({ m, body }) => {
    const job = await loadJobOr404(m[1]);
    if (job.role !== 'owner') throw new Forbidden('Only the creator can update this job');
    if (job.locked) throw new Forbidden('This job is locked');
    const next: JobBlob = { ...blobOf(job) };
    const owned = await ownedJobs();

    if (body.title !== undefined) { next.title = clean(body.title, 200) || bad('Title cannot be empty'); }
    if (body.description !== undefined) next.description = clean(body.description, 100000);
    if (body.mode !== undefined) next.mode = body.mode === 'budget' ? 'budget' : 'expense';
    if (body.client_name !== undefined) next.client_name = clean(body.client_name, 200);
    if (body.client_address !== undefined) next.client_address = clean(body.client_address, 500);
    if (body.client_email !== undefined) next.client_email = clean(body.client_email, 254);
    if (body.client_phone !== undefined) next.client_phone = clean(body.client_phone, 40);
    if (body.intake !== undefined) next.intake = cleanIntake(body.intake);
    if (body.job_rate !== undefined) next.job_rate = Number(body.job_rate) || 0;
    if (body.invoice_notes !== undefined) next.invoice_notes = clean(body.invoice_notes);
    if (body.google_sync_expenses !== undefined) next.google_sync_expenses = body.google_sync_expenses ? 1 : 0;

    const oldTag = (job.invoice_tag || '').toUpperCase() || null;
    if (body.invoice_tag !== undefined) {
      next.invoice_tag = body.invoice_tag ? String(body.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : null;
    }
    const tagChanged = body.invoice_tag !== undefined && (next.invoice_tag || null) !== oldTag;
    const prefix = await defaultPrefix();

    if (body.invoice_number !== undefined && body.invoice_number !== null && String(body.invoice_number).trim() !== '') {
      const candidate = String(body.invoice_number).trim().toUpperCase().slice(0, 40);
      const dup = owned.find(j => j.id !== job.id && (j.invoice_number || '').toUpperCase() === candidate);
      if (dup) bad(`Invoice number "${candidate}" is already in use by job "${dup.title}". Please choose a unique invoice number.`);
      next.invoice_number = candidate;
      next.invoice_seq = parseInvoiceSequence(candidate) || next.invoice_seq;
    } else if (tagChanged || !next.invoice_number) {
      const info = nextInvoiceForTag(owned, prefix, next.invoice_tag, job.id);
      next.invoice_seq = info.nextSeq; next.invoice_number = info.invoiceNumber;
    }

    const dates = {
      start_date: body.start_date !== undefined ? date(body.start_date) : job.start_date,
      end_date: body.end_date !== undefined ? date(body.end_date) : job.end_date,
    };
    const result = await writeJob(job.id, next, dates);
    invalidate('jobs');
    return ok({ ...(await getJob(job.id)), sync_status: (result as any)?.sync_status });
  }],

  ['PATCH', /^\/api\/jobs\/([^/]+)\/archive$/, async ({ m, body }) => {
    await api('PATCH', `/api/v2/jobs/${m[1]}/archive`, { body: { is_archived: !!body.is_archived } });
    invalidate('jobs');
    return ok();
  }],

  ['DELETE', /^\/api\/jobs\/([^/]+)$/, async ({ m }) => { await api('DELETE', `/api/v2/jobs/${m[1]}`); invalidate(''); return ok(); }],
  ['DELETE', /^\/api\/jobs\/([^/]+)\/leave$/, async ({ m }) => { await api('DELETE', `/api/v2/jobs/${m[1]}/leave`); invalidate(''); return ok(); }],

  // The UI still asks for "the wrapped job key" (to decrypt receipts). Keys are managed by the E2EE layer now; return the
  // current job key sealed under this user's master key, which is the format the pages already know how to open.
  ['GET', /^\/api\/jobs\/([^/]+)\/keys$/, async ({ m }) => {
    const key = await getJobKey(m[1]);
    return ok({ key: key ? await C.wrapJobKeyForSelf(getSession().keys.mk, key) : null });
  }],
  ['POST', /^\/api\/jobs\/([^/]+)\/keys$/, async () => ok()],
  ['POST', /^\/api\/jobs\/keys\/batch$/, async () => ok()],

  // ── Members & invites ──────────────────────────────────────────────────────
  ['GET', /^\/api\/jobs\/([^/]+)\/members$/, async ({ m }) => {
    const rows = await api<any[]>('GET', `/api/v2/jobs/${m[1]}/members`);
    const job = await getJob(m[1]);
    return ok(rows.map(r => ({
      id: r.user_id, username: r.username, email: r.email, status: r.status, public_key: r.public_key, has_key: !!r.has_key,
      pending: r.status === 'pending' || !r.has_key,
    })).filter(r => r.id !== job?.created_by));
  }],
  ['DELETE', /^\/api\/jobs\/([^/]+)\/members\/([^/]+)$/, async ({ m }) => { await api('DELETE', `/api/v2/jobs/${m[1]}/members/${m[2]}`); return ok(); }],

  ['POST', /^\/api\/jobs\/([^/]+)\/invites$/, async ({ m }) => ok(await api('POST', `/api/v2/jobs/${m[1]}/invites`))],

  // Joining: the body carries an invite token (never a bare job id).
  ['POST', /^\/api\/jobs\/join$/, async ({ body }) => {
    const token = String(body.token || body.jobId || '').trim();
    if (!token) bad('Invite code required');
    const r = await api<{ job_id: string; status: string }>('POST', '/api/v2/invites/redeem', { body: { token } });
    await ensureJobKeys(true);
    invalidate('');
    const job = await getJob(r.job_id);
    return ok(job ?? { id: r.job_id, title: 'Waiting for the owner to approve your invite', pending: true, status: r.status });
  }],

  // ── Export / import (done locally on decrypted data) ───────────────────────
  ['GET', /^\/api\/jobs\/([^/]+)\/export$/, async ({ m }) => {
    const job = await loadJobOr404(m[1]);
    const expenses = await listExpenses(job.id);
    return ok({
      job_title: job.title, job_description: job.description, job_mode: job.mode, export_date: new Date().toISOString(),
      expenses: expenses.map(e => ({ id: e.id, amount: e.amount, description: e.description, entry_type: e.entry_type, date: e.date, created_at: e.created_at, tags: e.tags.map(t => t.name) })),
    });
  }],

  ['POST', /^\/api\/jobs\/([^/]+)\/import$/, async ({ m, body }) => {
    const items = body.expenses;
    if (!Array.isArray(items) || items.length > 5000) bad('Invalid import format. Expected an array of up to 5000 expenses.');
    await requireJobKey(m[1]);
    const tagLib: any[] = (await getBlob<any>('tags', { tags: [] })).tags || [];
    const byName = new Map(tagLib.map((t: any) => [String(t.name).toLowerCase(), { id: t.id, name: t.name, color: t.color }]));
    const rows: Array<{ id: string; enc: string }> = [];
    for (const it of items) {
      const id = uuid();
      const tags = (Array.isArray(it.tags) ? it.tags : []).map((n: any) => byName.get(String(n).toLowerCase())).filter(Boolean);
      rows.push({ id, enc: await encExpense(m[1], id, toExpenseBlob({
        amount: Number(it.amount) || 0, description: clean(it.description, 1000) || 'Imported Entry',
        entry_type: it.entry_type === 'income' ? 'income' : 'expense', date: date(it.date), tags: tags as any,
      })) });
    }
    for (let i = 0; i < rows.length; i += 400) await api('POST', `/api/v2/jobs/${m[1]}/expenses/bulk`, { body: { items: rows.slice(i, i + 400) } });
    invalidate('expenses');
    return ok({ success: true, count: rows.length });
  }],
];
