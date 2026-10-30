import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, ArrowRight, CheckCircle2, KeyRound } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { resetPassword } from '../e2ee/auth';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !email) {
      setStatus('error');
      setErrorMsg('Invalid or missing token/email.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('error');
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (recoveryPhrase.trim().split(/\s+/).length !== 12) {
      setStatus('error');
      setErrorMsg('Recovery phrase must be exactly 12 words.');
      return;
    }

    setStatus('loading');
    
    try {
      // Needs the e-mailed token AND the recovery phrase; the phrase never leaves this device.
      await resetPassword({ token, email, newPassword, mnemonic: recoveryPhrase });
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message || 'Network error occurred or invalid phrase');
    }
  };

  if (!token || !email) {
    return (
      <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
        <div className="bg-[#1c172d]/60 backdrop-blur-2xl border border-white/5 p-8 rounded-3xl shadow-2xl text-center max-w-md w-full">
          <h2 className="text-xl text-red-400 mb-2 font-bold">Invalid Link</h2>
          <p className="text-gray-400 mb-6">The password reset link is invalid or has expired.</p>
          <button onClick={() => navigate('/login')} className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-6 py-2 rounded-xl font-medium transition-colors">Back to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="bg-[#1c172d]/60 backdrop-blur-2xl border border-white/5 p-8 rounded-3xl shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-[#7c3bed] to-purple-400 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-[#7c3bed]/30">
               <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white text-center tracking-tight">
              Set New Password
            </h1>
            <p className="text-gray-400 mt-2 text-center">Enter your new password and your 12-word recovery phrase.</p>
          </div>
          
          {status === 'success' ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-6" />
              <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Password Updated</h2>
              <p className="text-gray-400 mb-8">
                Your password and vault have been successfully restored.
              </p>
              <button 
                onClick={() => navigate('/login')} 
                className="w-full flex items-center justify-center gap-2 bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-[#7c3bed]/20"
              >
                Proceed to Login <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {status === 'error' && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm text-center font-medium">
                  {errorMsg}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 transition-all"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 transition-all"
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">12-Word Recovery Phrase</label>
                <div className="relative">
                  <KeyRound className="absolute left-4 top-4 w-5 h-5 text-gray-500" />
                  <textarea
                    value={recoveryPhrase}
                    onChange={(e) => setRecoveryPhrase(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 transition-all resize-none"
                    placeholder="word1 word2 word3..."
                    required
                    rows={3}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 mt-2 shadow-lg shadow-[#7c3bed]/20"
              >
                {status === 'loading' ? 'Restoring Vault...' : 'Reset Password & Restore Vault'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
