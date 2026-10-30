/**
 * In-memory E2EE session: the unlocked key material and the authenticated HTTP helper.
 * The master key is the only secret persisted (sessionStorage, tab-scoped, by AuthContext); everything else is
 * re-derived from it on page load via restoreSession().
 */
import * as C from './crypto';

// The original fetch, captured before the router patches window.fetch.
export const rawFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  (globalThis as any).__ge_original_fetch ? (globalThis as any).__ge_original_fetch(input, init) : fetch(input, init);

export interface Session {
  token: string;
  userId: string;
  username: string;
  keys: C.UnlockedKeys;
}

let current: Session | null = null;
const jobKeys = new Map<string, Uint8Array>();
let jobKeysLoaded: Promise<void> | null = null;

const cache = new Map<string, { at: number; value: Promise<any> }>();
export const hasSession = () => current !== null;
export const getSession = (): Session => {
  if (!current) throw new HttpError(401, 'Your vault is locked. Please sign in again.');
  return current;
};
export const setSession = (s: Session | null) => {
  // Any change of session (logout, or signing in as someone else) must drop every decrypted value and key held for the previous one.
  current = s; jobKeys.clear(); jobKeysLoaded = null; cache.clear(); C.clearKeyCache();
};
export const updateToken = (token: string) => { if (current) current.token = token; };

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

/** Authenticated JSON/multipart call to the server. Throws HttpError on non-2xx. */
export async function api<T = any>(method: string, path: string, opts: { body?: any; form?: FormData; raw?: boolean } = {}): Promise<T> {
  const s = getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token}` };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form; else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  // The server rate-limits bursts; back off and retry instead of failing a long operation such as the migration.
  let res = await rawFetch(path, { method, headers, body });
  for (let attempt = 0; res.status === 429 && attempt < 6; attempt++) {
    const wait = Math.min(15000, (Number(res.headers.get('retry-after')) || 2 + attempt * 2) * 1000);
    await new Promise(r => setTimeout(r, wait));
    res = await rawFetch(path, { method, headers, body });
  }
  if (opts.raw) {
    if (!res.ok) throw new HttpError(res.status, `Request failed (${res.status})`);
    return res as unknown as T;
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new HttpError(res.status, json?.error || `Request failed (${res.status})`, json);
  return json as T;
}

// ── Job keys ─────────────────────────────────────────────────────────────────
async function loadJobKeys() {
  const s = getSession();
  const rows = await api<Array<{ job_id: string; encrypted_key: string; wrapped_by: string | null; wrapper_public_key: string | null }>>('GET', '/api/v2/keys');
  const adopted: string[] = [];
  for (const r of rows) {
    try {
      let raw: Uint8Array;
      if (r.wrapped_by?.startsWith('agent:')) {
        // Job created by an API key with agent access: open it with that key's inbox, then take ownership of the key below.
        raw = await C.unwrapAgentInboxJobKey(await C.agentInboxKey(s.keys.masterKey, r.wrapped_by.slice(6)), r.job_id, r.encrypted_key);
        adopted.push(r.job_id);
      } else {
        raw = r.wrapped_by && r.wrapper_public_key
          ? await C.unwrapJobKeyFromMember(s.keys.privateKeyPkcs8, r.wrapper_public_key, r.job_id, r.encrypted_key)
          : await C.unwrapJobKeyForSelf(s.keys.mk, r.encrypted_key);
      }
      jobKeys.set(r.job_id, raw);
    } catch (e) {
      console.warn(`Could not unwrap the key for job ${r.job_id}`);
    }
  }
  // Re-seal agent-created job keys under the master key so they no longer depend on the API key (best effort; retried next load).
  for (const id of adopted) {
    try { await api('PUT', `/api/v2/jobs/${id}/key`, { body: { encrypted_key: await C.wrapJobKeyForSelf(s.keys.mk, jobKeys.get(id)!) } }); } catch { /* retry later */ }
  }
  void import('./agent').then(m => m.syncAgentBundles()).catch(() => {});
}

/** Snapshot of every job key this session holds (used to hand keys to an API key the user explicitly enabled for agents). */
export const heldJobKeys = (): Map<string, Uint8Array> => new Map(jobKeys);

let lastKeyLoad = 0;
export async function ensureJobKeys(force = false) {
  if (force || !jobKeysLoaded) { lastKeyLoad = Date.now(); jobKeysLoaded = loadJobKeys(); }
  await jobKeysLoaded;
}

/** Key already held in memory (no network). */
export const peekJobKey = (jobId: string): Uint8Array | null => jobKeys.get(jobId) ?? null;

/** The job's AES key, or null if this user doesn't (yet) hold it. A missing key triggers at most one refresh per 15 s. */
export async function getJobKey(jobId: string): Promise<Uint8Array | null> {
  await ensureJobKeys();
  if (!jobKeys.has(jobId) && Date.now() - lastKeyLoad > 15000) await ensureJobKeys(true);
  return jobKeys.get(jobId) ?? null;
}
export const rememberJobKey = (jobId: string, key: Uint8Array) => { jobKeys.set(jobId, key); };
export const requireJobKey = async (jobId: string): Promise<Uint8Array> => {
  const k = await getJobKey(jobId);
  if (!k) throw new HttpError(423, 'You do not have the key for this job yet. Ask the owner to approve your invite.');
  return k;
};

// ── Tiny TTL cache so list screens don't re-download and re-decrypt on every render ─
export function cached<T>(key: string, load: () => Promise<T>, ttlMs = 8000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = load().catch(e => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const invalidate = (prefix = '') => {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  if ('expenses:bulk'.startsWith(prefix) || prefix.startsWith('expenses')) cache.delete('expenses:bulk');
};
/** Seeds the cache with an already-computed value (used after one bulk request). */
export const prime = <T>(key: string, value: T) => { cache.set(key, { at: Date.now(), value: Promise.resolve(value) }); };
