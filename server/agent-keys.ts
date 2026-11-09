import db from './db.js';
import { ValidationError } from './security.js';
import { isUuid, getJobAccess } from './middleware.js';
import { serverCryptoAvailable, wrapForServer, unwrapForServer } from './server-crypto.js';

/**
 * Opt-in "agent access" for an API key.
 *
 * By default an API key can only read calendar data (see GET /api/calendar/schedule). When the user explicitly enables agent
 * access while creating a key, their browser hands the server a *bundle*: the keys of the jobs the key may use, the user's
 * calendar key and a per-key "inbox" key. The server seals the bundle under SERVER_WRAP_KEY and uses it ONLY to serve
 * /api/agent/v1/* for that key. Revoking the key (or removing agent access) deletes the bundle.
 *
 * Trade-off: while a key has agent access, whoever can read the database AND SERVER_WRAP_KEY (or the key itself) can read
 * the covered jobs. Nothing else is exposed: no master key, no tax data, no AI provider key, no other jobs.
 */
export type InvoicePermission = 'none' | 'read' | 'draft' | 'finalize';
/**
 * `invoices` (default 'none'): what the key may do with invoices/estimates on the jobs it covers. `draft` and `finalize` need write access.
 * `research`: run AI research on jobs THIS key posts (needs write access and an endpoint in the bundle). Both are opt-in.
 */
export interface AgentScope { access: 'read' | 'write'; all_jobs: boolean; invoices?: InvoicePermission; research?: boolean }
/** Endpoint the in-process research worker may use for jobs this key creates. Sealed with the bundle, deleted with the key. */
export interface ResearchConfig { base_url: string; model: string; api_key?: string; timeout_s: number; heading: string; prompt: string; sink?: { url: string; token?: string } }
export interface AgentBundle { v: 1; calendar_key: string; inbox: string; jobs: Record<string, string>; research?: ResearchConfig }

const MAX_JOBS = 2000;
const bundleAad = (keyId: string) => `agent-key|${keyId}`;

const key32 = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(v) || Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length !== 32) {
    throw new ValidationError(`${field} must be a 32-byte base64 key`);
  }
  return Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64');
};

export function parseScope(raw: unknown): AgentScope {
  const access = (raw as any)?.access;
  if (access !== 'read' && access !== 'write') throw new ValidationError('agent.access must be "read" or "write"');
  const invoices = (raw as any)?.invoices ?? 'none';
  if (!['none', 'read', 'draft', 'finalize'].includes(invoices)) throw new ValidationError('agent.invoices must be "none", "read", "draft" or "finalize"');
  if ((invoices === 'draft' || invoices === 'finalize') && access !== 'write') throw new ValidationError('Drafting or finalizing invoices needs read+write agent access');
  const research = Boolean((raw as any)?.research);
  if (research && access !== 'write') throw new ValidationError('Research on posted jobs needs read+write agent access');
  return { access, all_jobs: Boolean((raw as any)?.all_jobs), invoices, research };
}

const text = (v: unknown, field: string, max: number, required = false): string => {
  if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) throw new ValidationError(`${field} must be ${required ? 'a non-empty ' : ''}string of at most ${max} characters`);
  return v;
};

export function parseResearchConfig(raw: any): ResearchConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('research must be an object');
  const timeout = Number(raw.timeout_s);
  const sink = raw.sink && typeof raw.sink === 'object' ? { url: text(raw.sink.url, 'research.sink.url', 500, true), ...(raw.sink.token ? { token: text(raw.sink.token, 'research.sink.token', 500) } : {}) } : undefined;
  return {
    base_url: text(raw.base_url, 'research.base_url', 500, true), model: text(raw.model, 'research.model', 100, true), ...(raw.api_key ? { api_key: text(raw.api_key, 'research.api_key', 500) } : {}),
    timeout_s: Number.isFinite(timeout) ? Math.min(900, Math.max(10, timeout)) : 600, heading: text(raw.heading ?? '', 'research.heading', 200), prompt: text(raw.prompt ?? '', 'research.prompt', 6000), ...(sink ? { sink } : {}),
  };
}

/** Validates a bundle uploaded by the owner's browser; drops keys for jobs the user cannot actually access. */
export function parseBundle(raw: any, userId: string, requireCrypto = true): AgentBundle {
  if (requireCrypto && !serverCryptoAvailable()) throw new ValidationError('Agent access is not configured on this server (SERVER_WRAP_KEY).');
  const jobsIn = raw?.jobs && typeof raw.jobs === 'object' && !Array.isArray(raw.jobs) ? raw.jobs : {};
  const ids = Object.keys(jobsIn);
  if (ids.length > MAX_JOBS) throw new ValidationError(`At most ${MAX_JOBS} jobs per key`);
  const jobs: Record<string, string> = {};
  for (const id of ids) {
    if (!isUuid(id)) throw new ValidationError('Job ids must be UUIDs');
    if (!getJobAccess(id, userId)) continue;
    jobs[id] = key32(jobsIn[id], `jobs.${id}`);
  }
  const research = parseResearchConfig(raw?.research);
  return { v: 1, calendar_key: key32(raw?.calendar_key, 'calendar_key'), inbox: key32(raw?.inbox, 'inbox'), jobs, ...(research ? { research } : {}) };
}

export const sealBundle = (keyId: string, b: AgentBundle): string => wrapForServer(Buffer.from(JSON.stringify(b), 'utf8'), bundleAad(keyId));

export function openBundle(keyId: string, sealed: string): AgentBundle {
  return JSON.parse(unwrapForServer(sealed, bundleAad(keyId)).toString('utf8')) as AgentBundle;
}

/** Adds job keys to an existing bundle (union; the server never removes access on its own except for jobs that no longer exist). */
export function mergeBundle(keyId: string, userId: string, incoming: AgentBundle): void {
  const row = db.prepare('SELECT agent_bundle FROM api_keys WHERE id = ? AND user_id = ?').get(keyId, userId) as any;
  if (!row?.agent_bundle) throw new ValidationError('Agent access is not enabled for this key');
  const current = openBundle(keyId, row.agent_bundle);
  const jobs = { ...current.jobs, ...incoming.jobs };
  for (const id of Object.keys(jobs)) if (!getJobAccess(id, userId)) delete jobs[id];
  db.prepare('UPDATE api_keys SET agent_bundle = ? WHERE id = ?').run(sealBundle(keyId, { ...current, jobs, ...(incoming.research ? { research: incoming.research } : {}) }), keyId);
}
