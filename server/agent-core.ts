import crypto from 'crypto';
import type { Server } from 'socket.io';
import db from './db.js';
import { ValidationError, isoDate, str } from './security.js';
import { getJobAccess, touchJob, isUuid } from './middleware.js';
import { decryptEnvelopeServer, encryptEnvelopeServer, sealRawServer } from './server-crypto.js';
import { openBundle, sealBundle, type AgentBundle, type AgentScope } from './agent-keys.js';
import { syncJobToGoogle } from './google-calendar.js';
import { formatInvoiceNumber, parseInvoiceSequence } from '../src/utils/invoice.ts';
import { IntakeError, canonicalDescription, parseStructuredIntake, type JobIntake } from '../src/invoice/intake.ts';
import { normalizeInvoice } from '../src/invoice/normalize.ts';
import { addEvent, withGe } from '../src/invoice/ge.ts';
import { confirmEstimate, ConfirmError, isFinal } from '../src/invoice/review.ts';
import type { Invoice } from '../src/invoice/types.ts';

/**
 * The agent permission model as a module (docs/INVOICING_PLAN.md §5.13 / D19). Both the HTTP routes (routes/agent.ts) and the
 * in-process research worker (research.ts) go through here, so there is exactly one place that knows how an API key's sealed
 * bundle opens, which jobs it may touch, and the append-only / estimate-only rules. No HTTP self-call, no second code path.
 */

export interface Agent { keyId: string; scope: AgentScope; jobKeys: Map<string, Buffer>; calendarKey: Buffer; inbox: Buffer; bundle: AgentBundle }

export const MAX_BATCH = 100;
export const MAX_AMOUNT = 1_000_000_000;
export const MAX_DESCRIPTION = 100_000;

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Opens a key record's bundle. Throws if the bundle cannot be opened (e.g. SERVER_WRAP_KEY changed). */
export function openAgent(rec: { id: string; agent_bundle: string; agent_scope: string }): Agent {
  const bundle = openBundle(rec.id, rec.agent_bundle);
  const raw = JSON.parse(rec.agent_scope) as Partial<AgentScope>;
  const scope: AgentScope = { access: raw.access === 'write' ? 'write' : 'read', all_jobs: Boolean(raw.all_jobs), invoices: (['read', 'draft', 'finalize'] as const).includes(raw.invoices as any) ? raw.invoices! : 'none', research: Boolean(raw.research) };
  return { keyId: rec.id, scope, calendarKey: b64(bundle.calendar_key), inbox: b64(bundle.inbox), jobKeys: new Map(Object.entries(bundle.jobs).map(([id, k]) => [id, b64(k)])), bundle };
}

// ── Job blob ────────────────────────────────────────────────────────────────
export interface JobBlob {
  title: string; description: string | null; mode: 'expense' | 'budget'; client_name: string | null; client_address: string | null;
  client_email: string | null; client_phone: string | null; job_rate: number; invoice_notes: string | null; invoice_tag: string | null; invoice_seq: number | null;
  invoice_number: string | null; google_sync_expenses: number; intake: JobIntake | null;
}
export interface ExpenseBlob { amount: number; description: string | null; entry_type: 'expense' | 'income'; date: string | null; tags: unknown[] }

export const emptyJob = (): JobBlob => ({
  title: '', description: null, mode: 'expense', client_name: null, client_address: null, client_email: null, client_phone: null, job_rate: 0,
  invoice_notes: null, invoice_tag: null, invoice_seq: null, invoice_number: null, google_sync_expenses: 0, intake: null,
});

export const readJobRow = (userId: string, jobId?: string) => db.prepare(`
  SELECT j.id, j.created_by, u.username AS owner_name, j.is_archived, j.start_date, j.end_date, j.enc, j.created_at, j.updated_at,
         CASE WHEN j.created_by = ? THEN 'owner' ELSE 'member' END AS role
  FROM jobs j LEFT JOIN users u ON u.id = j.created_by
  WHERE (j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active'))
  ${jobId ? 'AND j.id = ?' : ''} ORDER BY j.created_at DESC`).all(...[userId, userId, userId, ...(jobId ? [jobId] : [])]) as any[];

export function expensesOf(jobId: string, key: Buffer) {
  const rows = db.prepare(`SELECT e.id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.created_at FROM expenses e
                           JOIN users u ON u.id = e.user_id WHERE e.job_id = ? AND e.enc IS NOT NULL`).all(jobId) as any[];
  const out: any[] = [];
  for (const r of rows) {
    try {
      const b = decryptEnvelopeServer<ExpenseBlob>(key, r.enc, `expense|${jobId}|${r.id}`);
      out.push({ id: r.id, job_id: jobId, amount: Number(b.amount) || 0, description: b.description ?? null, entry_type: b.entry_type === 'income' ? 'income' : 'expense',
                 date: b.date ?? null, added_by: r.user_name, created_at: r.created_at, has_receipt: Boolean(r.receipt_url) });
    } catch { /* not decryptable with this key: skip */ }
  }
  return out;
}

export function jobView(row: any, key: Buffer) {
  let blob: JobBlob;
  try { blob = { ...emptyJob(), ...decryptEnvelopeServer<JobBlob>(key, row.enc, `job|${row.id}`) }; } catch { return null; }
  const ex = expensesOf(row.id, key);
  const income = ex.filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = ex.filter(e => e.entry_type !== 'income').reduce((s, e) => s + e.amount, 0);
  return {
    id: row.id, title: blob.title, description: blob.description, mode: blob.mode, client_name: blob.client_name, client_address: blob.client_address,
    client_email: blob.client_email, client_phone: blob.client_phone, job_rate: blob.job_rate, invoice_notes: blob.invoice_notes, invoice_tag: blob.invoice_tag, invoice_number: blob.invoice_number,
    intake: blob.intake, start_date: row.start_date, end_date: row.end_date, is_archived: Boolean(row.is_archived), role: row.role, owner: row.owner_name,
    created_at: row.created_at, updated_at: row.updated_at,
    total_income: income, total_expenses: expense, net: income - expense, entry_count: ex.length,
  };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function parseEntry(raw: any) {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Each entry must be an object');
  const amount = typeof raw.amount === 'string' && raw.amount.trim() !== '' ? Number(raw.amount) : raw.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new ValidationError('amount must be a positive number');
  const type = raw.entry_type ?? 'expense';
  if (type !== 'expense' && type !== 'income') throw new ValidationError('entry_type must be "expense" or "income"');
  if (raw.id !== undefined && !isUuid(raw.id)) throw new ValidationError('id must be a UUID');
  return {
    id: (raw.id as string | undefined) ?? crypto.randomUUID(),
    blob: { amount: Math.round(amount * 100) / 100, description: str(raw.description, 'description', { max: 1000 }), entry_type: type as 'expense' | 'income', date: isoDate(raw.date, 'date') ?? today(), tags: [] } satisfies ExpenseBlob,
  };
}

/** Result of an operation, before the route turns it into an HTTP response. */
export interface Outcome { status: number; body: any }
export class AgentHttpError extends Error { constructor(public status: number, message: string) { super(message); } }

// ── Description append (append-only on purpose) ─────────────────────────────
export function appendDescription(a: Agent, userId: string, jobId: string, rawAppend: unknown, io: Server | null, opts: { skipIfCurrent?: (description: string) => boolean } = {}): Outcome {
  const key = a.jobKeys.get(jobId);
  const access = key ? getJobAccess(jobId, userId) : null;
  if (!key || !access) return { status: 404, body: { error: 'Job not found' } };
  // Members hold the owner's job blob only as a guest; rewriting it is the owner's call.
  if (!access.isOwner) return { status: 403, body: { error: 'Text can only be appended to jobs owned by the key\'s account.' } };
  const addition = str(rawAppend, 'append', { required: true, max: MAX_DESCRIPTION })!;

  const row = readJobRow(userId, jobId)[0];
  let blob: JobBlob;
  try { blob = { ...emptyJob(), ...decryptEnvelopeServer<JobBlob>(key, row.enc, `job|${jobId}`) }; }
  catch { return { status: 404, body: { error: 'Job not found' } }; }

  // Retrying the same text is safe: it is not appended twice.
  const current = blob.description ?? '';
  // Callers such as the research worker can skip at the moment of writing (something else may have appended while they were busy).
  if (opts.skipIfCurrent?.(current)) return { status: 200, body: { ...jobView(row, key), duplicate: true } };
  const duplicate = current.includes(addition);
  if (!duplicate) {
    const next = current ? `${current}\n\n${addition}` : addition;
    if (next.length > MAX_DESCRIPTION) throw new ValidationError(`description would exceed ${MAX_DESCRIPTION} characters`);
    blob.description = next;
    const enc = encryptEnvelopeServer(key, blob, `job|${jobId}`);
    db.prepare('UPDATE jobs SET enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(enc, jobId);
    io?.to(jobId).emit('job_updated', { id: jobId, enc, start_date: row.start_date, end_date: row.end_date });
  }
  return { status: duplicate ? 200 : 201, body: { ...jobView(readJobRow(userId, jobId)[0], key), duplicate } };
}

// ── Job creation ────────────────────────────────────────────────────────────
export interface JobCreatedHook { (ctx: { agent: Agent; userId: string; jobId: string; blob: JobBlob }): void }
/** Observers of newly created jobs (the research worker registers here). Failures never affect the create response. */
export const jobCreatedHooks: JobCreatedHook[] = [];

/** Finds a job this key can see whose intake carries the same external_ref (retries from a website must not duplicate jobs). */
function findByExternalRef(a: Agent, userId: string, ref: string): { row: any; key: Buffer } | null {
  for (const row of readJobRow(userId)) {
    const key = a.jobKeys.get(row.id);
    if (!key || !row.enc || row.role !== 'owner') continue;
    try { if (decryptEnvelopeServer<JobBlob>(key, row.enc, `job|${row.id}`).intake?.externalRef === ref) return { row, key }; } catch { /* skip */ }
  }
  return null;
}

export function createJob(a: Agent, userId: string, b: any, io: Server | null): Outcome {
  const title = str(b.title, 'title', { required: true, max: 200 })!;
  if (b.mode !== undefined && b.mode !== 'expense' && b.mode !== 'budget') throw new ValidationError('mode must be "expense" or "budget"');
  let intake: JobIntake | null;
  try { intake = parseStructuredIntake(b); } catch (e) { if (e instanceof IntakeError) throw new ValidationError(e.message); throw e; }

  if (intake?.externalRef) {
    const dup = findByExternalRef(a, userId, intake.externalRef);
    if (dup) return { status: 200, body: { ...jobView(dup.row, dup.key), duplicate: true } };
  }

  const rate = b.job_rate === undefined ? (intake?.quote?.hourlyRate ?? 0) : Number(b.job_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_AMOUNT) throw new ValidationError('job_rate must be a non-negative number');
  const tag = b.invoice_tag ? String(b.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 20) : null;
  const start = isoDate(b.start_date ?? intake?.preferred?.start, 'start_date'), end = isoDate(b.end_date ?? intake?.preferred?.end, 'end_date');

  // With structured intake the description is written from it so every job reads the same, whatever its source. Anything the caller
  // also sent as free text is kept below it rather than lost. (The raw value is validated either way.)
  const rawDescription = str(b.description, 'description', { max: MAX_DESCRIPTION });
  const canonical = intake ? canonicalDescription(intake) : '';
  const description = canonical
    ? (rawDescription && rawDescription !== canonical ? `${canonical}\n\nNotes:\n${rawDescription}` : canonical).slice(0, MAX_DESCRIPTION)
    : rawDescription;

  const rawName = str(b.client_name, 'client_name', { max: 200 }), rawEmail = str(b.client_email, 'client_email', { max: 254 });
  const rawAddress = str(b.client_address, 'client_address', { max: 500 }), rawPhone = str(b.client_phone, 'client_phone', { max: 40 });
  const blob: JobBlob = {
    ...emptyJob(), title, description, mode: b.mode === 'budget' ? 'budget' : 'expense',
    // One formatter everywhere (plan §5.14): when an intake exists its normalized contact wins; the raw value is validated and is the fallback.
    client_name: intake?.contact.name ?? rawName, client_address: rawAddress ?? intake?.location?.raw ?? null,
    client_email: intake?.contact.email ?? rawEmail, client_phone: intake?.contact.phone ?? rawPhone,
    job_rate: rate, invoice_notes: str(b.invoice_notes, 'invoice_notes', { max: 5000 }), invoice_tag: tag, intake,
  };

  // Invoice numbers need every job the owner has to avoid collisions. Only keys that cover all jobs can allocate one; for
  // keys limited to some jobs it is left empty and assigned the first time the owner opens the job in the app.
  if (a.scope.all_jobs) {
    const owned = readJobRow(userId).filter(r => r.role === 'owner' && r.enc && a.jobKeys.has(r.id))
      .map(r => { try { return { ...emptyJob(), ...decryptEnvelopeServer<JobBlob>(a.jobKeys.get(r.id)!, r.enc, `job|${r.id}`) }; } catch { return null; } })
      .filter((j): j is JobBlob => j !== null);
    const untagged = owned.find(j => !j.invoice_tag && j.invoice_number);
    const defaultPrefix = (/^(.*)-[A-Z]\d{5}$/.exec(untagged?.invoice_number ?? '')?.[1]) || 'INV';
    const prefix = tag || defaultPrefix;
    const sameTag = owned.filter(j => (tag ? (j.invoice_tag || '').toUpperCase() === tag : !j.invoice_tag));
    let seq = sameTag.reduce((m, j) => Math.max(m, j.invoice_seq || parseInvoiceSequence(j.invoice_number || '') || 0), 0) + 1;
    const taken = new Set(owned.map(j => (j.invoice_number || '').toUpperCase()));
    while (taken.has(formatInvoiceNumber(prefix, seq).toUpperCase())) seq++;
    blob.invoice_seq = seq; blob.invoice_number = formatInvoiceNumber(prefix, seq);
  }

  const id = crypto.randomUUID();
  const jobKey = crypto.randomBytes(32);
  // The owner's own copy of the key is sealed under the per-key inbox; their browser re-seals it under their master key
  // the next time they open the app (src/e2ee/session.ts).
  const wrapped = sealRawServer(a.inbox, jobKey, `agent-inbox|${id}`);
  const label = encryptEnvelopeServer(a.calendarKey, blob.title || 'Job', `calendar-title|${id}`);
  db.transaction(() => {
    db.prepare("INSERT INTO jobs (id, title, created_by, enc, start_date, end_date, is_archived) VALUES (?, '', ?, ?, ?, ?, 0)")
      .run(id, userId, encryptEnvelopeServer(jobKey, blob, `job|${id}`), start, end);
    db.prepare('INSERT INTO job_keys (job_id, user_id, encrypted_job_key, wrapped_by) VALUES (?, ?, ?, ?)').run(id, userId, wrapped, `agent:${a.keyId}`);
    db.prepare('INSERT INTO job_calendar_labels (job_id, user_id, title_enc) VALUES (?, ?, ?)').run(id, userId, label);
    // Keep the new job inside this key's bundle so the agent can keep using it.
    const rec = db.prepare('SELECT agent_bundle FROM api_keys WHERE id = ?').get(a.keyId) as any;
    const bundle = openBundle(a.keyId, rec.agent_bundle);
    bundle.jobs[id] = jobKey.toString('base64');
    db.prepare('UPDATE api_keys SET agent_bundle = ? WHERE id = ?').run(sealBundle(a.keyId, bundle), a.keyId);
  })();
  a.jobKeys.set(id, jobKey);
  void syncJobToGoogle(userId, id).catch(() => {});
  for (const hook of jobCreatedHooks) { try { hook({ agent: a, userId, jobId: id, blob }); } catch { /* hooks must never break job creation */ } }
  void io;
  return { status: 201, body: jobView(readJobRow(userId, id)[0], jobKey) };
}

// ── Expenses ────────────────────────────────────────────────────────────────
export function addExpenses(a: Agent, userId: string, jobId: string, body: any, io: Server | null): Outcome {
  const key = a.jobKeys.get(jobId);
  if (!key || !getJobAccess(jobId, userId)) return { status: 404, body: { error: 'Job not found' } };
  const batch = Array.isArray(body?.items);
  const inputs: any[] = batch ? body.items : [body];
  if (inputs.length === 0 || inputs.length > MAX_BATCH) throw new ValidationError(`items must contain 1-${MAX_BATCH} entries`);
  const entries = inputs.map(parseEntry);

  const insert = db.prepare("INSERT INTO expenses (id, job_id, user_id, amount, description, receipt_url, is_encrypted, entry_type, date, enc) VALUES (?, ?, ?, 0, NULL, NULL, 0, 'expense', NULL, ?)");
  const created: any[] = [];
  const duplicates: string[] = [];
  db.transaction(() => {
    for (const e of entries) {
      const existing = db.prepare('SELECT job_id, user_id FROM expenses WHERE id = ?').get(e.id) as any;
      if (existing) {
        // Retrying with the same client id is safe; reusing someone else's id is not.
        if (existing.job_id === jobId && existing.user_id === userId) { duplicates.push(e.id); continue; }
        throw new ValidationError(`id ${e.id} is already in use`);
      }
      insert.run(e.id, jobId, userId, encryptEnvelopeServer(key, e.blob, `expense|${jobId}|${e.id}`));
      created.push(e);
    }
  })();

  for (const e of created) {
    const row = db.prepare(`SELECT e.id, e.job_id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.is_encrypted, e.created_at, e.updated_at
                            FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.id = ?`).get(e.id);
    io?.to(jobId).emit('expense_added', row);
  }
  if (created.length) touchJob(jobId);
  const view = (e: { id: string; blob: ExpenseBlob }) => ({ id: e.id, job_id: jobId, ...e.blob, tags: undefined });
  return { status: created.length ? 201 : 200, body: batch
    ? { created: created.map(view), duplicates }
    : { ...(created[0] ? view(created[0]) : { id: duplicates[0], job_id: jobId }), duplicate: created.length === 0 } };
}

// ── Invoices (docs/INVOICING_PLAN.md §5.16) ─────────────────────────────────
/** Same derivation as the browser's `deterministicUuid`, so an agent's estimate and the app's auto-draft are the SAME record. */
export function deterministicUuid(seed: string): string {
  const h = crypto.createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16).toString('hex').split('');
  h[12] = '4'; h[16] = '8';
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const LEVEL = { none: 0, read: 1, draft: 2, finalize: 3 } as const;
const need = (a: Agent, level: keyof typeof LEVEL) => {
  if ((LEVEL[a.scope.invoices ?? 'none'] ?? 0) < LEVEL[level]) throw new AgentHttpError(403, a.scope.invoices && a.scope.invoices !== 'none' ? `This API key's invoice permission is "${a.scope.invoices}"; "${level}" is required.` : 'This API key has no invoice permission. Enable it in Settings → API Keys.');
  if (level !== 'read' && a.scope.access !== 'write') throw new AgentHttpError(403, 'This API key has read-only agent access.');
};
const MAX_INVOICE_ENC = 100 * 1024;
const invAad = (jobId: string, id: string) => `invoice|${jobId}|${id}`;

interface InvRow { id: string; job_id: string; user_id: string; enc: string; rev: number; created_at: string; updated_at: string }
const invRow = (id: string) => db.prepare('SELECT id, job_id, user_id, enc, rev, created_at, updated_at FROM invoices WHERE id = ?').get(id) as InvRow | undefined;

function openInvoice(a: Agent, row: InvRow): (Invoice & { __rev: number }) | null {
  const key = a.jobKeys.get(row.job_id);
  if (!key) return null;
  try { return Object.assign(normalizeInvoice(decryptEnvelopeServer<{ invoice: unknown }>(key, row.enc, invAad(row.job_id, row.id)).invoice, { keepGe: true }), { __rev: row.rev }); } catch { return null; }
}
const present = (row: InvRow, inv: Invoice) => ({ id: row.id, job_id: row.job_id, rev: row.rev, created_at: row.created_at, updated_at: row.updated_at, invoice: inv });

function sealInvoice(key: Buffer, jobId: string, id: string, inv: Invoice): string {
  const enc = encryptEnvelopeServer(key, { v: 1, invoice: inv }, invAad(jobId, id));
  if (enc.length > MAX_INVOICE_ENC) throw new ValidationError('This invoice is too large to save.');
  return enc;
}

/** Job must be covered by the key AND owned by the key's account (members never change the owner's documents). */
function ownedJob(a: Agent, userId: string, jobId: string): Buffer {
  const key = a.jobKeys.get(jobId);
  const access = key ? getJobAccess(jobId, userId) : null;
  if (!key || !access || !access.isOwner) throw new AgentHttpError(404, 'Job not found');
  return key;
}

export function listJobInvoices(a: Agent, userId: string, jobId: string): Outcome {
  need(a, 'read');
  const key = a.jobKeys.get(jobId);
  if (!key || !getJobAccess(jobId, userId)) return { status: 404, body: { error: 'Job not found' } };
  const rows = db.prepare('SELECT id, job_id, user_id, enc, rev, created_at, updated_at FROM invoices WHERE job_id = ? ORDER BY created_at').all(jobId) as InvRow[];
  return { status: 200, body: rows.flatMap(r => { const i = openInvoice(a, r); return i ? [present(r, i)] : []; }) };
}

/** An agent can only ever create an ESTIMATE; the server forces it. One estimate per job (or per external_ref) keeps retries idempotent. */
export function createEstimate(a: Agent, userId: string, jobId: string, body: any, io: Server | null): Outcome {
  need(a, 'draft');
  const key = ownedJob(a, userId, jobId);
  const ref = body?.external_ref;
  if (ref !== undefined && (typeof ref !== 'string' || !/^[\w.:-]{1,100}$/.test(ref))) throw new ValidationError('external_ref must be 1-100 characters: letters, digits, . _ : -');
  const id = deterministicUuid(ref ? `estimate|${jobId}|${ref}` : `estimate|${jobId}`);
  const existing = invRow(id);
  if (existing) { const inv = openInvoice(a, existing); return { status: 200, body: { ...(inv ? present(existing, inv) : { id }), duplicate: true } }; }

  let inv = normalizeInvoice(body?.invoice ?? {}, { keepGe: false });
  inv = { ...inv, meta: { ...inv.meta, docType: 'estimate', status: inv.meta.status === 'Draft' ? 'Draft' : 'Estimate' } };
  inv = addEvent(withGe(inv, { origin: 'agent', pending: ['defaults'] }), { by: 'agent', keyId: a.keyId }, 'created');
  db.prepare('INSERT INTO invoices (id, job_id, user_id, enc) VALUES (?, ?, ?, ?)').run(id, jobId, userId, sealInvoice(key, jobId, id, inv));
  const row = invRow(id)!;
  touchJob(jobId); io?.to(jobId).emit('invoice_updated', row);
  return { status: 201, body: { ...present(row, inv), duplicate: false } };
}

function loadForWrite(a: Agent, userId: string, id: string): { row: InvRow; inv: Invoice; key: Buffer } {
  const row = typeof id === 'string' ? invRow(id) : undefined;
  if (!row) throw new AgentHttpError(404, 'Invoice not found');
  const key = ownedJob(a, userId, row.job_id);
  const inv = openInvoice(a, row);
  if (!inv) throw new AgentHttpError(404, 'Invoice not found');
  return { row, inv, key };
}

/** Edits an estimate that has not been confirmed. The agent's invoice content replaces the sections it sends; `ge` is never agent-editable. */
export function updateEstimate(a: Agent, userId: string, id: string, body: any, io: Server | null): Outcome {
  need(a, 'draft');
  const { row, inv: current, key } = loadForWrite(a, userId, id);
  if (isFinal(current)) throw new AgentHttpError(409, 'This invoice is final; agents cannot edit final invoices.');
  const expected = body?.expected_rev;
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 1)) throw new ValidationError('expected_rev must be a positive integer');
  if (!body?.invoice || typeof body.invoice !== 'object') throw new ValidationError('invoice is required');
  let next = normalizeInvoice({ ...current, ...body.invoice, meta: { ...current.meta, ...(body.invoice.meta || {}) } }, { keepGe: false });
  next = { ...next, meta: { ...next.meta, docType: 'estimate', status: next.meta.status === 'Draft' ? 'Draft' : 'Estimate' }, ge: current.ge };
  next = addEvent(next, { by: 'agent', keyId: a.keyId }, 'edited');
  const r = db.prepare('UPDATE invoices SET enc = ?, rev = rev + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (? IS NULL OR rev = ?)').run(sealInvoice(key, row.job_id, id, next), id, expected ?? null, expected ?? null);
  if (r.changes === 0) return { status: 409, body: { error: 'This invoice was changed elsewhere. Fetch it again and retry.', current: invRow(id) && openInvoice(a, invRow(id)!) ? present(invRow(id)!, openInvoice(a, invRow(id)!)!) : null } };
  const out = invRow(id)!;
  touchJob(row.job_id); io?.to(row.job_id).emit('invoice_updated', out);
  return { status: 200, body: present(out, next) };
}

/** Confirms an estimate into a Final Invoice (needs `finalize`). Records the agent and key; the owner's browser finishes the terms swap. */
export function confirmInvoice(a: Agent, userId: string, id: string, body: any, io: Server | null): Outcome {
  need(a, 'finalize');
  const { row, inv, key } = loadForWrite(a, userId, id);
  const note = str(body?.note, 'note', { max: 2000 }) ?? '';
  let next: Invoice;
  try { next = confirmEstimate(inv, { by: 'agent', keyId: a.keyId }, note); } catch (e) { if (e instanceof ConfirmError) throw new AgentHttpError(409, e.message); throw e; }
  const r = db.prepare('UPDATE invoices SET enc = ?, rev = rev + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND rev = ?').run(sealInvoice(key, row.job_id, id, next), id, row.rev);
  if (r.changes === 0) throw new AgentHttpError(409, 'This invoice was changed while confirming. Fetch it again and retry.');
  const out = invRow(id)!;
  touchJob(row.job_id); io?.to(row.job_id).emit('invoice_updated', out);
  return { status: 200, body: present(out, next) };
}

