import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { unlockVault } from '../e2ee/auth';

/** Shown when the user is signed in but this tab doesn't hold the vault key. Only their password can unlock it. */
export default function UnlockVault() {
  const { token, user, setMasterKey, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;
    setBusy(true); setError('');
    try {
      const out = await unlockVault(token, user, password);
      setMasterKey(out.masterKeyB64);
    } catch (err: any) {
      setError(err.message || 'Could not unlock your vault.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#0f0c1b]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#1c172d]/80 p-8 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-[#7c3bed]/20 flex items-center justify-center"><Lock className="w-7 h-7 text-[#7c3bed]" /></div>
          <h1 className="text-xl font-bold text-white">Unlock your vault</h1>
          <p className="text-sm text-gray-400">Signed in as <strong>{user?.username}</strong>. Enter your password to decrypt your data on this device.</p>
        </div>
        {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>}
        <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
          className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-white outline-none focus:border-[#7c3bed]" />
        <button disabled={busy || !password} className="w-full rounded-xl bg-[#7c3bed] py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Unlocking…' : 'Unlock'}</button>
        <button type="button" onClick={logout} className="w-full text-sm text-gray-400 hover:text-white">Sign out</button>
      </form>
    </div>
  );
}
