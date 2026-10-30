import * as C from './crypto';
import { api, getSession, requireJobKey, invalidate } from './session';

export interface PendingMember { user_id: string; username: string; email: string | null; public_key: string; fingerprint: string; status: string }

/** Members of a job I own who still need me to wrap the job key for them. Includes a fingerprint to verify out-of-band. */
export async function listMembersNeedingKey(jobId: string): Promise<PendingMember[]> {
  const rows = await api<any[]>('GET', `/api/v2/jobs/${jobId}/members`);
  const out: PendingMember[] = [];
  for (const r of rows) {
    if (r.has_key && r.status === 'active') continue;
    if (!r.public_key) continue; // hasn't upgraded their account yet; nothing to wrap for
    out.push({ user_id: r.user_id, username: r.username, email: r.email, public_key: r.public_key, status: r.status, fingerprint: await C.fingerprint(r.public_key) });
  }
  return out;
}

/**
 * Owner approves a member: wraps the job key for the member's public key and uploads only the wrapped copy.
 * `expectedFingerprint` must be what the owner verified with the member; if the server had substituted a key, it won't match.
 */
export async function approveMember(jobId: string, member: PendingMember, expectedFingerprint?: string): Promise<void> {
  if (expectedFingerprint && expectedFingerprint.replace(/\s/g, '').toUpperCase() !== member.fingerprint) {
    throw new Error('Fingerprint mismatch: this invitee’s key is not the one you verified. Do not approve.');
  }
  const s = getSession();
  const wrapped = await C.wrapJobKeyForMember(s.keys.privateKeyPkcs8, member.public_key, jobId, await requireJobKey(jobId));
  await api('PUT', `/api/v2/jobs/${jobId}/members/${member.user_id}/key`, { body: { encrypted_key: wrapped } });
  invalidate('');
}

/** Everyone's own fingerprint (to read aloud to a job owner when joining). */
export const myFingerprint = () => C.fingerprint(getSession().keys.publicKey);
