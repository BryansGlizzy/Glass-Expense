import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { motion } from 'motion/react';
import { generateMnemonic } from '../e2ee/crypto';
import { register, passwordProblem } from '../e2ee/auth';

export default function Register() {
  const [step, setStep] = useState<'form' | 'mnemonic' | 'registering'>('form');
  const [mnemonic, setMnemonic] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, setMasterKey } = useAuth();
  const navigate = useNavigate();

  const handleInitialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    const problem = passwordProblem(password);
    if (problem) { setError(problem); return; }
    setError('');
    const newMnemonic = generateMnemonic();
    setMnemonic(newMnemonic);
    setStep('mnemonic');
  };

  const handleConfirmMnemonic = async () => {
    setStep('registering');
    try {
      // Keys are derived here in the browser; the password itself is never sent to the server.
      const out = await register({ username, email, password, mnemonic });
      setMasterKey(out.masterKeyB64);
      login(out.token, out.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setStep('form');
    }
  };

  if (step === 'mnemonic' || step === 'registering') {
    return (
      <div className="min-h-screen bg-[#121317] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg bg-[#1c172d]/60 backdrop-blur-2xl border border-white/5 p-8 rounded-3xl shadow-2xl shadow-black/50"
        >
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white tracking-tight">Save Your Recovery Phrase</h2>
            <p className="text-amber-400/90 mt-2 text-sm bg-amber-500/10 p-4 rounded-xl border border-amber-500/20">
              GlassExpense uses End-to-End Encryption. If you forget your password, you will permanently lose access to your receipts unless you have these 12 words.
            </p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            {mnemonic.split(' ').map((word, index) => (
              <div key={index} className="bg-black/40 border border-white/10 rounded-lg p-2 text-center flex items-center justify-center gap-2">
                <span className="text-gray-500 text-xs">{index + 1}.</span>
                <span className="text-white font-mono font-medium">{word}</span>
              </div>
            ))}
          </div>

          <button
            onClick={handleConfirmMnemonic}
            disabled={step === 'registering'}
            className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-[#7c3bed]/20 disabled:opacity-50"
          >
            {step === 'registering' ? 'Creating Account...' : 'I have saved these 12 words securely'}
          </button>
        </motion.div>
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
          <h2 className="text-3xl font-bold text-white tracking-tight">Create Account</h2>
          <p className="text-gray-400 mt-2">Join GlassExpense today</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleInitialSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 focus:border-transparent transition-all"
              placeholder="Choose a username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 focus:border-transparent transition-all"
              placeholder="Enter your email"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 focus:border-transparent transition-all"
              placeholder="Create a password"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-[#7c3bed]/20"
          >
            Continue
          </button>
        </form>

        <p className="mt-8 text-center text-gray-400 text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-[#7c3bed] hover:text-purple-400 font-medium transition-colors">
            Sign in
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
