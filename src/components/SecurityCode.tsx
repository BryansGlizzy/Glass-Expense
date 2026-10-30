import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { myFingerprint } from '../e2ee/members';
import { hasSession } from '../e2ee/session';

/** The user's public-key fingerprint. Read it to a job owner when you join a shared job so they can verify your key. */
export default function SecurityCode() {
  const [fp, setFp] = useState<string | null>(null);
  useEffect(() => { if (hasSession()) myFingerprint().then(setFp).catch(() => setFp(null)); }, []);
  if (!fp) return null;
  return (
    <div className="mb-8 pb-8 border-b border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <Fingerprint className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-medium text-gray-300">Your security code</h3>
      </div>
      <p className="text-sm text-gray-400 mb-3">When you join someone's job, they approve you by checking this code with you. It identifies your encryption key; it is safe to share.</p>
      <div className="inline-block rounded-xl bg-black/40 border border-white/10 px-4 py-2 font-mono text-white tracking-widest text-sm">{fp}</div>
    </div>
  );
}
