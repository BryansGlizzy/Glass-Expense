import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { fingerprint } from '../e2ee/crypto';
import { approveMember } from '../e2ee/members';

interface Props { jobId: string; member: { id: string; username: string; email?: string | null; public_key: string; status?: string }; onApproved: () => void }

/**
 * An invited member can't read anything until the owner wraps the job key for them. The fingerprint below identifies
 * the member's public key: confirm it with them (call/message) so a tampering server can't swap in its own key.
 */
export default function MemberApproval({ jobId, member, onApproved }: Props) {
  const [fp, setFp] = useState('…');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fingerprint(member.public_key).then(setFp).catch(() => setFp('unavailable')); }, [member.public_key]);

  const approve = async () => {
    setBusy(true); setError('');
    try {
      await approveMember(jobId, { user_id: member.id, username: member.username, email: member.email ?? null, public_key: member.public_key, status: member.status || 'pending', fingerprint: fp }, fp);
      onApproved();
    } catch (e: any) { setError(e.message || 'Could not approve'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2">
      <div className="flex items-center gap-2 text-amber-300 font-medium"><ShieldCheck className="w-4 h-4" /> Waiting for your approval</div>
      <div className="text-gray-300">Security code for <strong>{member.username}</strong>: <span className="font-mono text-white tracking-wider">{fp}</span></div>
      <label className="flex items-start gap-2 text-gray-300">
        <input type="checkbox" className="mt-0.5" checked={verified} onChange={e => setVerified(e.target.checked)} />
        <span>I confirmed this code with {member.username} (it should match what they see under Settings → Security).</span>
      </label>
      {error && <div className="text-red-400">{error}</div>}
      <button disabled={!verified || busy} onClick={approve} className="rounded-lg bg-emerald-500/90 px-3 py-1.5 font-semibold text-black disabled:opacity-40">{busy ? 'Approving…' : 'Approve & share job key'}</button>
    </div>
  );
}
