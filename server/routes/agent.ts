import type { Express } from 'express';
import type { Server } from 'socket.io';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ValidationError, isoDate } from '../security.js';
import { allowApiKey, authenticateToken, getJobAccess, enforceJobLimits } from '../middleware.js';
import { serverCryptoAvailable } from '../server-crypto.js';
import {
  AgentHttpError, addExpenses, appendDescription, confirmInvoice, createEstimate, createJob, expensesOf, jobView, listJobInvoices, openAgent, readJobRow, updateEstimate,
  type Agent, type Outcome,
} from '../agent-core.js';

/**
 * Agent API (/api/agent/v1): plaintext JSON for automations and AI agents, available ONLY to API keys the owner explicitly
 * opted in to "agent access" (see server/agent-keys.ts). The server decrypts/encrypts with the job keys the owner's browser
 * handed over for that key. Keys without agent access, and ordinary sessions, are refused.
 *
 *   GET  /me                          what this key may do
 *   GET  /jobs                        jobs covered by the key, with totals
 *   GET  /jobs/:id                    one job (incl. client_phone and the parsed intake)
 *   POST /jobs                        create a job; structured intake + quote + external_ref (idempotent)   (write access)
 *   GET  /jobs/:id/expenses           entries of a job (filters: from, to, type, limit, offset)
 *   POST /jobs/:id/expenses           add one entry, or {items:[...]} up to 100  (write access)
 *   POST /jobs/:id/description        append text to a job's description         (write access; never overwrites)
 *   GET  /jobs/:id/invoices           the job's invoices/estimates, decrypted    (invoices: read or higher)
 *   POST /jobs/:id/invoices           create an ESTIMATE (idempotent)            (invoices: draft or higher)
 *   PUT  /invoices/:id                edit an unconfirmed estimate               (invoices: draft or higher)
 *   POST /invoices/:id/confirm        turn an estimate into a Final Invoice      (invoices: finalize)
 *
 * Not available to agents: deleting anything, editing existing job values (only appending to a description), editing a final
 * invoice, sending e-mail, recording payments, receipts, tags, tax data, sharing, account settings.
 * All logic lives in server/agent-core.ts, shared with the in-process research worker.
 */

const agentLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120 * Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1),
  standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req: any) => `agent:${req.apiKeyRecord?.id ?? ipKeyGenerator(req.ip ?? '')}`,
  message: { error: 'Too many requests for this API key. Slow down (limit: 120/min).' },
});

function requireAgent(req: any, res: any, next: any) {
  const rec = req.apiKeyRecord;
  if (req.authMethod !== 'apikey' || !rec) return res.status(403).json({ error: 'The agent API needs an API key with agent access enabled (x-api-key).' });
  if (!rec.agent_bundle || !rec.agent_scope) {
    return res.status(403).json({ error: 'This API key was not created with agent access. Create a new key and enable "Agent access" in Settings → API Keys.' });
  }
  if (!serverCryptoAvailable()) return res.status(503).json({ error: 'Agent access is not configured on this server.' });
  try {
    req.agent = openAgent(rec) satisfies Agent;
    next();
  } catch {
    res.status(503).json({ error: 'The server could not open this key\'s access bundle (was SERVER_WRAP_KEY changed?). Recreate the key.' });
  }
}

const requireWrite = (req: any, res: any, next: any) =>
  (req.agent as Agent).scope.access === 'write' ? next() : res.status(403).json({ error: 'This API key has read-only agent access.' });

export function registerAgentRoutes(app: Express, io: Server) {
  const base = '/api/agent/v1';
  const guard = [allowApiKey, authenticateToken, agentLimiter, requireAgent];
  /** Runs an operation and maps validation / permission errors to JSON responses. */
  const run = (fn: (req: any) => Outcome) => (req: any, res: any) => {
    try { const out = fn(req); res.status(out.status).json(out.body); }
    catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      if (err instanceof AgentHttpError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };

  app.get(`${base}/me`, ...guard, (req: any, res) => {
    const a = req.agent as Agent;
    res.json({ access: a.scope.access, all_jobs: a.scope.all_jobs, job_count: a.jobKeys.size, user: req.user.username, ...(a.scope.invoices && a.scope.invoices !== 'none' ? { invoices: a.scope.invoices } : {}) });
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

  app.post(`${base}/jobs`, ...guard, requireWrite, enforceJobLimits, run(req => createJob(req.agent, req.user.id, req.body ?? {}, io)));
  // Append-only on purpose: an agent can add findings to a job but can never overwrite or erase what the owner wrote.
  app.post(`${base}/jobs/:id/description`, ...guard, requireWrite, run(req => appendDescription(req.agent, req.user.id, req.params.id, req.body?.append, io)));

  app.get(`${base}/jobs/:id/expenses`, ...guard, run(req => {
    const a = req.agent as Agent;
    const key = a.jobKeys.get(req.params.id);
    if (!key || !getJobAccess(req.params.id, req.user.id)) return { status: 404, body: { error: 'Job not found' } };
    const from = isoDate(req.query.from, 'from'), to = isoDate(req.query.to, 'to');
    const type = req.query.type;
    if (type !== undefined && type !== 'expense' && type !== 'income') throw new ValidationError('type must be "expense" or "income"');
    const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const rows = expensesOf(req.params.id, key)
      .filter(e => (!from || (e.date ?? e.created_at.slice(0, 10)) >= from) && (!to || (e.date ?? e.created_at.slice(0, 10)) <= to) && (!type || e.entry_type === type))
      .sort((x, y) => (y.date ?? y.created_at).localeCompare(x.date ?? x.created_at));
    return { status: 200, body: { total: rows.length, limit, offset, items: rows.slice(offset, offset + limit) } };
  }));

  app.post(`${base}/jobs/:id/expenses`, ...guard, requireWrite, run(req => addExpenses(req.agent, req.user.id, req.params.id, req.body, io)));

  // Invoices and estimates (permission: the key's `invoices` level, checked inside agent-core).
  app.get(`${base}/jobs/:id/invoices`, ...guard, run(req => listJobInvoices(req.agent, req.user.id, req.params.id)));
  app.post(`${base}/jobs/:id/invoices`, ...guard, run(req => createEstimate(req.agent, req.user.id, req.params.id, req.body ?? {}, io)));
  app.put(`${base}/invoices/:id`, ...guard, run(req => updateEstimate(req.agent, req.user.id, req.params.id, req.body ?? {}, io)));
  app.post(`${base}/invoices/:id/confirm`, ...guard, run(req => confirmInvoice(req.agent, req.user.id, req.params.id, req.body ?? {}, io)));
}
