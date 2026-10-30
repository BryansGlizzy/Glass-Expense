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
export interface AgentScope { access: 'read' | 'write'; all_jobs: boolean }
export interface AgentBundle { v: 1; calendar_key: string; inbox: string; jobs: Record<string, string> }

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
  return { access, all_jobs: Boolean((raw as any)?.all_jobs) };
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
  return { v: 1, calendar_key: key32(raw?.calendar_key, 'calendar_key'), inbox: key32(raw?.inbox, 'inbox'), jobs };
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
  db.prepare('UPDATE api_keys SET agent_bundle = ? WHERE id = ?').run(sealBundle(keyId, { ...current, jobs }), keyId);
}
