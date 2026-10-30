import React, { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { motion } from 'motion/react';
import { loginWithPassword, upgradeLegacyAccount, type AuthOutcome, type LegacyLogin } from '../e2ee/auth';
import { migrateLegacyData } from '../e2ee/migration';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [phrase, setPhrase] = useState<string | null>(null);
  const phraseSaved = useRef<null | (() => void)>(null);
  const { login, setMasterKey } = useAuth();
  const navigate = useNavigate();

  const finish = (out: AuthOutcome) => {
    setMasterKey(out.masterKeyB64);
    login(out.token, out.user);
    navigate('/dashboard');
  };

  // One-time upgrade of data created before end-to-end encryption: encrypted locally, resumable if interrupted.
  const migrate = async (out: AuthOutcome) => {
    setStatus('Upgrading your encryption…');
    await migrateLegacyData((message, fraction) => { setStatus(message); setProgress(fraction); });
    const me = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${out.token}` } }).then(r => r.json());
    finish({ ...out, user: me.user });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await loginWithPassword(username, password);
      if (!r.legacy) {
        const out = r as AuthOutcome;
        if ((out.user.e2ee_version ?? 2) < 2) await migrate(out); else finish(out);
        return;
      }
      if (!r.masterKey) throw new Error('Your existing vault could not be opened with this password. Use "Forgot password" with your recovery phrase.');
      if (r.newMnemonic) {
        // Very old account that never had a recovery phrase: create one and make the user save it before continuing.
        await new Promise<void>(resolve => { phraseSaved.current = resolve; setPhrase(r.newMnemonic); });
        setPhrase(null);
      }
      await migrate(await upgradeLegacyAccount(r as LegacyLogin));
    } catch (err: any) {
      setStatus('');
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  if (phrase) {
    return (
      <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#1c172d]/60 border border-white/5 p-8 rounded-3xl space-y-5">
          <h2 className="text-2xl font-bold text-white">Save your recovery phrase</h2>
          <p className="text-sm text-gray-400">Your data is now end-to-end encrypted. These 12 words are the only way to recover it if you forget your password. We cannot recover them for you.</p>
          <div className="grid grid-cols-3 gap-2">
            {phrase.split(' ').map((w, i) => (
              <div key={i} className="rounded-lg bg-black/30 border border-white/10 px-2 py-2 text-sm text-white"><span className="text-gray-500 mr-1">{i + 1}.</span>{w}</div>
            ))}
          </div>
          <button className="w-full rounded-xl bg-[#7c3bed] py-3 font-semibold text-white" onClick={() => phraseSaved.current?.()}>I have saved my recovery phrase</button>
        </div>
      </div>
    );
  }

  if (status) {
    return (
      <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#1c172d]/60 border border-white/5 p-8 rounded-3xl space-y-4 text-center">
          <h2 className="text-xl font-bold text-white">Securing your data</h2>
          <p className="text-sm text-gray-400">Everything is being encrypted on this device. Please keep this page open.</p>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden"><div className="h-full bg-[#7c3bed] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="text-xs text-gray-400">{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#1c172d]/60 backdrop-blur-2xl border border-white/5 p-8 rounded-3xl shadow-2xl shadow-black/50"
      >
        <div className="text-center mb-10">
          <img src="/icon-192.png" alt="Logo" className="w-16 h-16 mx-auto rounded-2xl shadow-lg shadow-[#7c3bed]/30 mb-6" />
          <h2 className="text-3xl font-bold text-white tracking-tight">Welcome back</h2>
          <p className="text-gray-400 mt-2">Sign in to your account</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Username or Email</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 focus:border-transparent transition-all"
              placeholder="Enter your username or email"
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Password</label>
              <Link to="/forgot-password" className="text-xs text-[#7c3bed] hover:text-purple-400 font-medium transition-colors">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 focus:border-transparent transition-all"
              placeholder="Enter your password"
              required
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-[#7c3bed]/20"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-8 text-center text-gray-400 text-sm">
          Don't have an account?{' '}
          <Link to="/register" className="text-[#7c3bed] hover:text-purple-400 font-medium transition-colors">
            Create one
          </Link>
        </p>

        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <Link to="/legal" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Terms of Service & Privacy Policy
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
