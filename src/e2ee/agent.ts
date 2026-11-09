import * as C from './crypto';
import { api, getSession, heldJobKeys } from './session';

/**
 * Agent access for API keys (opt-in, see server/agent-keys.ts). The server can only use the job keys this browser hands over for a
 * key the user explicitly enabled. Keys that cover "all jobs" are topped up here whenever new jobs appear.
 */
export interface AgentBundleBody { calendar_key: string; inbox: string; jobs: Record<string, string>; research?: Record<string, unknown> }

export async function buildAgentBundle(apiKeyId: string, jobIds: string[] | null, research?: Record<string, unknown>): Promise<AgentBundleBody> {
  const s = getSession();
  const held = heldJobKeys();
  const ids = jobIds ?? [...held.keys()];
  const jobs: Record<string, string> = {};
  for (const id of ids) {
    const k = held.get(id);
    if (!k) throw new Error('You do not hold the key for one of the selected jobs yet.');
    jobs[id] = C.toB64(k);
  }
  return { calendar_key: C.toB64(s.keys.calendarKey), inbox: C.toB64(await C.agentInboxKey(s.keys.masterKey, apiKeyId)), jobs, ...(research ? { research } : {}) };
}

let lastFingerprint = '';
let running = false;

/** Adds keys of newly created/joined jobs to every "all jobs" agent key. Cheap no-op when nothing changed. */
export async function syncAgentBundles(): Promise<void> {
  if (running) return;
  const fingerprint = [...heldJobKeys().keys()].sort().join(',');
  if (fingerprint === lastFingerprint) return;
  running = true;
  try {
    const keys = await api<Array<{ id: string; agent_access: string | null; agent_all_jobs: boolean | null }>>('GET', '/api/keys');
    for (const k of keys.filter(x => x.agent_access && x.agent_all_jobs)) {
      await api('PUT', `/api/keys/${k.id}/agent-bundle`, { body: await buildAgentBundle(k.id, null) });
    }
    lastFingerprint = fingerprint;
  } catch { /* retried on the next key load */ } finally { running = false; }
}
