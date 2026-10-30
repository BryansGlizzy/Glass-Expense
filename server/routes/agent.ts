import type { Express } from 'express';
import type { Server } from 'socket.io';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import db from '../db.js';
import { ValidationError, isoDate, str } from '../security.js';
import { allowApiKey, authenticateToken, getJobAccess, touchJob, enforceJobLimits, isUuid } from '../middleware.js';
import { serverCryptoAvailable, decryptEnvelopeServer, encryptEnvelopeServer, sealRawServer } from '../server-crypto.js';
import { openBundle, sealBundle, type AgentScope } from '../agent-keys.js';
import { syncJobToGoogle } from '../google-calendar.js';
import { formatInvoiceNumber, parseInvoiceSequence } from '../../src/utils/invoice.ts';

/**
 * Agent API (/api/agent/v1): plaintext JSON for automations and AI agents, available ONLY to API keys the owner explicitly
 * opted in to "agent access" (see server/agent-keys.ts). The server decrypts/encrypts with the job keys the owner's browser
 * handed over for that key. Keys without agent access, and ordinary sessions, are refused.
 *
 *   GET  /me                       what this key may do
 *   GET  /jobs                     jobs covered by the key, with totals
 *   GET  /jobs/:id                 one job
 *   POST /jobs                     create a job                              (write access)
 *   GET  /jobs/:id/expenses        entries of a job (filters: from, to, type, limit, offset)
 *   POST /jobs/:id/expenses        add one entry, or {items:[...]} up to 100  (write access)
 *
 * Not available to agents: deleting or editing anything, receipts, tags, tax data, sharing, account settings.
 */

interface Agent { keyId: string; scope: AgentScope; jobKeys: Map<string, Buffer>; calendarKey: Buffer; inbox: Buffer }

const MAX_BATCH = 100;
const MAX_AMOUNT = 1_000_000_000;

const agentLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120 * Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1),
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req: any) => `agent:${req.apiKeyRecord?.id ?? ipKeyGenerator(req.ip ?? '')}`,
  message: { error: 'Too many requests for this API key. Slow down (limit: 120/min).' },
});

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function requireAgent(req: any, res: any, next: any) {
  const rec = req.apiKeyRecord;
  if (req.authMethod !== 'apikey' || !rec) return res.status(403).json({ error: 'The agent API needs an API key with agent access enabled (x-api-key).' });
  if (!rec.agent_bundle || !rec.agent_scope) {
    return res.status(403).json({ error: 'This API key was not created with agent access. Create a new key and enable "Agent access" in Settings → API Keys.' });
  }
  if (!serverCryptoAvailable()) return res.status(503).json({ error: 'Agent access is not configured on this server.' });
  try {
    const bundle = openBundle(rec.id, rec.agent_bundle);
    req.agent = {
      keyId: rec.id, scope: JSON.parse(rec.agent_scope) as AgentScope, calendarKey: b64(bundle.calendar_key), inbox: b64(bundle.inbox),
      jobKeys: new Map(Object.entries(bundle.jobs).map(([id, k]) => [id, b64(k)])),
    } satisfies Agent;
    next();
  } catch {
    res.status(503).json({ error: 'The server could not open this key\'s access bundle (was SERVER_WRAP_KEY changed?). Recreate the key.' });
  }
}

const requireWrite = (req: any, res: any, next: any) =>
  (req.agent as Agent).scope.access === 'write' ? next() : res.status(403).json({ error: 'This API key has read-only agent access.' });

interface JobBlob {
  title: string; description: string | null; mode: 'expense' | 'budget'; client_name: string | null; client_address: string | null;
  client_email: string | null; job_rate: number; invoice_notes: string | null; invoice_tag: string | null; invoice_seq: number | null;
  invoice_number: string | null; google_sync_expenses: number;
}
interface ExpenseBlob { amount: number; description: string | null; entry_type: 'expense' | 'income'; date: string | null; tags: unknown[] }

const emptyJob = (): JobBlob => ({
  title: '', description: null, mode: 'expense', client_name: null, client_address: null, client_email: null, job_rate: 0,
  invoice_notes: null, invoice_tag: null, invoice_seq: null, invoice_number: null, google_sync_expenses: 0,
});

const readJobRow = (userId: string, jobId?: string) => db.prepare(`
  SELECT j.id, j.created_by, u.username AS owner_name, j.is_archived, j.start_date, j.end_date, j.enc, j.created_at, j.updated_at,
         CASE WHEN j.created_by = ? THEN 'owner' ELSE 'member' END AS role
  FROM jobs j LEFT JOIN users u ON u.id = j.created_by
  WHERE (j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active'))
  ${jobId ? 'AND j.id = ?' : ''} ORDER BY j.created_at DESC`).all(...[userId, userId, userId, ...(jobId ? [jobId] : [])]) as any[];

function expensesOf(jobId: string, key: Buffer) {
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

function jobView(row: any, key: Buffer) {
  let blob: JobBlob;
  try { blob = { ...emptyJob(), ...decryptEnvelopeServer<JobBlob>(key, row.enc, `job|${row.id}`) }; } catch { return null; }
  const ex = expensesOf(row.id, key);
  const income = ex.filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = ex.filter(e => e.entry_type !== 'income').reduce((s, e) => s + e.amount, 0);
  return {
    id: row.id, title: blob.title, description: blob.description, mode: blob.mode, client_name: blob.client_name, client_address: blob.client_address,
    client_email: blob.client_email, job_rate: blob.job_rate, invoice_notes: blob.invoice_notes, invoice_tag: blob.invoice_tag, invoice_number: blob.invoice_number,
    start_date: row.start_date, end_date: row.end_date, is_archived: Boolean(row.is_archived), role: row.role, owner: row.owner_name,
    created_at: row.created_at, updated_at: row.updated_at,
    total_income: income, total_expenses: expense, net: income - expense, entry_count: ex.length,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function parseEntry(raw: any) {
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

export function registerAgentRoutes(app: Express, io: Server) {
  const base = '/api/agent/v1';
  const guard = [allowApiKey, authenticateToken, agentLimiter, requireAgent];
  const fail = (res: any, err: any) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  };

  app.get(`${base}/me`, ...guard, (req: any, res) => {
    const a = req.agent as Agent;
    res.json({ access: a.scope.access, all_jobs: a.scope.all_jobs, job_count: a.jobKeys.size, user: req.user.username });
  });

  app.get(`${base}/jobs`, ...guard, (req: any, res) => {
    const a = req.agent as Agent;
    const includeArchived = req.query.include_archived === 'true';
    const out = [];
    for (const row of readJobRow(req.user.id)) {
      const key = a.jobKeys.get(row.id);
      if (!key || !row.enc || (row.is_archived && !includeArchived)) continue;
      const v = jobView(row, key);
      if (v) out.push(v);
    }
    res.json(out);
  });

  app.get(`${base}/jobs/:id`, ...guard, (req: any, res) => {
    const a = req.agent as Agent;
    const key = a.jobKeys.get(req.params.id);
    const row = key ? readJobRow(req.user.id, req.params.id)[0] : null;
    const v = row?.enc && key ? jobView(row, key) : null;
    if (!v) return res.status(404).json({ error: 'Job not found' });
    res.json(v);
  });

  app.post(`${base}/jobs`, ...guard, requireWrite, enforceJobLimits, async (req: any, res) => {
    try {
      const a = req.agent as Agent;
      const b = req.body ?? {};
      const title = str(b.title, 'title', { required: true, max: 200 })!;
      if (b.mode !== undefined && b.mode !== 'expense' && b.mode !== 'budget') throw new ValidationError('mode must be "expense" or "budget"');
      const rate = b.job_rate === undefined ? 0 : Number(b.job_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > MAX_AMOUNT) throw new ValidationError('job_rate must be a non-negative number');
      const tag = b.invoice_tag ? String(b.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 20) : null;
      const start = isoDate(b.start_date, 'start_date'), end = isoDate(b.end_date, 'end_date');

      const blob: JobBlob = {
        ...emptyJob(), title, description: str(b.description, 'description', { max: 100000 }), mode: b.mode === 'budget' ? 'budget' : 'expense',
        client_name: str(b.client_name, 'client_name', { max: 200 }), client_address: str(b.client_address, 'client_address', { max: 500 }),
        client_email: str(b.client_email, 'client_email', { max: 254 }), job_rate: rate, invoice_notes: str(b.invoice_notes, 'invoice_notes', { max: 5000 }), invoice_tag: tag,
      };

      // Invoice numbers need every job the owner has to avoid collisions. Only keys that cover all jobs can allocate one; for
      // keys limited to some jobs it is left empty and assigned the first time the owner edits the job in the app.
      if (a.scope.all_jobs) {
        const owned = readJobRow(req.user.id).filter(r => r.role === 'owner' && r.enc && a.jobKeys.has(r.id))
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
          .run(id, req.user.id, encryptEnvelopeServer(jobKey, blob, `job|${id}`), start, end);
        db.prepare('INSERT INTO job_keys (job_id, user_id, encrypted_job_key, wrapped_by) VALUES (?, ?, ?, ?)').run(id, req.user.id, wrapped, `agent:${a.keyId}`);
        db.prepare('INSERT INTO job_calendar_labels (job_id, user_id, title_enc) VALUES (?, ?, ?)').run(id, req.user.id, label);
        // Keep the new job inside this key's bundle so the agent can keep using it.
        const rec = db.prepare('SELECT agent_bundle FROM api_keys WHERE id = ?').get(a.keyId) as any;
        const bundle = openBundle(a.keyId, rec.agent_bundle);
        bundle.jobs[id] = jobKey.toString('base64');
        db.prepare('UPDATE api_keys SET agent_bundle = ? WHERE id = ?').run(sealBundle(a.keyId, bundle), a.keyId);
      })();
      a.jobKeys.set(id, jobKey);
      void syncJobToGoogle(req.user.id, id).catch(() => {});
      res.status(201).json(jobView(readJobRow(req.user.id, id)[0], jobKey));
    } catch (err) { fail(res, err); }
  });

  app.get(`${base}/jobs/:id/expenses`, ...guard, (req: any, res) => {
    try {
      const a = req.agent as Agent;
      const key = a.jobKeys.get(req.params.id);
      if (!key || !getJobAccess(req.params.id, req.user.id)) return res.status(404).json({ error: 'Job not found' });
      const from = isoDate(req.query.from, 'from'), to = isoDate(req.query.to, 'to');
      const type = req.query.type;
      if (type !== undefined && type !== 'expense' && type !== 'income') throw new ValidationError('type must be "expense" or "income"');
      const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
      const rows = expensesOf(req.params.id, key)
        .filter(e => (!from || (e.date ?? e.created_at.slice(0, 10)) >= from) && (!to || (e.date ?? e.created_at.slice(0, 10)) <= to) && (!type || e.entry_type === type))
        .sort((x, y) => (y.date ?? y.created_at).localeCompare(x.date ?? x.created_at));
      res.json({ total: rows.length, limit, offset, items: rows.slice(offset, offset + limit) });
    } catch (err) { fail(res, err); }
  });

  app.post(`${base}/jobs/:id/expenses`, ...guard, requireWrite, (req: any, res) => {
    try {
      const a = req.agent as Agent;
      const jobId = req.params.id;
      const key = a.jobKeys.get(jobId);
      if (!key || !getJobAccess(jobId, req.user.id)) return res.status(404).json({ error: 'Job not found' });
      const batch = Array.isArray(req.body?.items);
      const inputs: any[] = batch ? req.body.items : [req.body];
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
            if (existing.job_id === jobId && existing.user_id === req.user.id) { duplicates.push(e.id); continue; }
            throw new ValidationError(`id ${e.id} is already in use`);
          }
          insert.run(e.id, jobId, req.user.id, encryptEnvelopeServer(key, e.blob, `expense|${jobId}|${e.id}`));
          created.push(e);
        }
      })();

      for (const e of created) {
        const row = db.prepare(`SELECT e.id, e.job_id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.is_encrypted, e.created_at, e.updated_at
                                FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.id = ?`).get(e.id);
        io.to(jobId).emit('expense_added', row);
      }
      if (created.length) touchJob(jobId);
      const view = (e: { id: string; blob: ExpenseBlob }) => ({ id: e.id, job_id: jobId, ...e.blob, tags: undefined });
      res.status(created.length ? 201 : 200).json(batch
        ? { created: created.map(view), duplicates }
        : { ...(created[0] ? view(created[0]) : { id: duplicates[0], job_id: jobId }), duplicate: created.length === 0 });
    } catch (err) { fail(res, err); }
  });
}
