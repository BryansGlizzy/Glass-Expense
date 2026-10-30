import React from 'react';
import { motion } from 'motion/react';
import { Check, Star, Shield, Server } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Pricing() {
  const { user } = useAuth();
  
  const [info, setInfo] = React.useState<any>(null);
  const [licenseKey, setLicenseKey] = React.useState('');
  const [isActivating, setIsActivating] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/info')
      .then(res => res.json())
      .then(setInfo);
  }, []);
  
  const handleActivate = async () => {
    setIsActivating(true);
    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ key: licenseKey })
      });
      if (res.ok) {
        alert('License activated! Please refresh your page.');
        window.location.reload();
      } else {
        const err = await res.json();
        alert(err.error || 'Activation failed');
      }
    } catch (err) {
      alert('Activation failed');
    } finally {
      setIsActivating(false);
    }
  };

  const handleUpgrade = async (plan: string) => {
    try {
      const res = await fetch('/api/payments/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ plan })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          alert('Billing integration is not configured.');
        }
      }
    } catch (err) {
      alert('Failed to initiate upgrade.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-12 px-4">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Choose Your Plan</h1>
        <p className="text-xl text-gray-400">Scale your expense tracking as your needs grow.</p>
      </div>

      {user?.isAdmin ? (
        <div className="max-w-2xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1c172d]/60 border border-amber-500/30 rounded-3xl p-10 text-center space-y-6 backdrop-blur-md shadow-2xl"
          >
            <div className="w-20 h-20 mx-auto bg-gradient-to-tr from-amber-500 to-orange-500 rounded-3xl flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Shield className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white mb-3">Administrator Access</h2>
              <p className="text-slate-400 text-lg">
                As a system administrator, you already have unrestricted access to all features and capabilities.
              </p>
            </div>
          </motion.div>
        </div>
      ) : info && !info.isSaaS && !info.isUnlocked ? (
        <div className="max-w-2xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1c172d]/60 border border-emerald-500/30 rounded-3xl p-10 text-center space-y-8 backdrop-blur-md shadow-2xl"
          >
            <div className="w-20 h-20 mx-auto bg-gradient-to-tr from-emerald-500 to-teal-500 rounded-3xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Server className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white mb-3">Upgrade to SaaS Mode</h2>
              <p className="text-slate-400 text-lg">
                Unlock multi-user support, unlimited projects, and centralized administration for your self-hosted instance.
              </p>
            </div>
            <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6 space-y-4">
              <div className="text-left">
                <label className="text-sm font-medium text-slate-400 block mb-2 px-1">SaaS License Key</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    placeholder="sk_..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <button
                    onClick={handleActivate}
                    disabled={isActivating || !licenseKey}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    {isActivating ? 'Activating...' : 'Upgrade Now'}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-500 italic">
              Don't have a key? Visit <a href="https://expenses.futurelabz.dev" className="text-emerald-400 hover:underline">expenses.futurelabz.dev</a> to purchase one.
            </p>
          </motion.div>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-8">
          {/* Free Plan */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#1c172d]/60 border border-white/10 rounded-3xl p-8 flex flex-col"
          >
            <div className="mb-8">
              <h3 className="text-xl font-bold text-white mb-2">Free</h3>
              <div className="text-4xl font-bold text-white mb-2">$0<span className="text-lg text-gray-400 font-normal">/mo</span></div>
              <p className="text-sm text-gray-400">Perfect for trying out GlassExpense.</p>
            </div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-gray-500" /> Up to 2 Active Jobs</li>
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-gray-500" /> Up to 6 Archived Jobs</li>
              <li className="flex items-center gap-3 text-gray-300 opacity-50"><Check className="w-5 h-5" /> No AI Receipt Scanning</li>
              <li className="flex items-center gap-3 text-gray-300 opacity-50"><Check className="w-5 h-5" /> No API Access</li>
            </ul>
            
            <button 
              disabled={user?.plan === 'free'}
              className="w-full py-3 rounded-xl font-bold text-white bg-white/5 border border-white/10 disabled:opacity-50"
            >
              {user?.plan === 'free' ? 'Current Plan' : 'Downgrade'}
            </button>
          </motion.div>

          {/* Paid Plan */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-b from-[#7c3bed]/20 to-[#1c172d] border border-[#7c3bed]/50 rounded-3xl p-8 flex flex-col relative shadow-[0_0_40px_rgba(124,59,237,0.15)]"
          >
            <div className="absolute top-0 right-8 -translate-y-1/2">
              <span className="bg-[#7c3bed] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full flex items-center gap-1">
                <Star className="w-3 h-3" /> Most Popular
              </span>
            </div>
            <div className="mb-8">
              <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
              <div className="text-4xl font-bold text-white mb-2">$10<span className="text-lg text-gray-400 font-normal">/mo</span></div>
              <p className="text-sm text-gray-300">Unlock the full power of AI and limitless tracking.</p>
            </div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-[#7c3bed]" /> Unlimited Active Jobs</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-[#7c3bed]" /> Unlimited Archives</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-emerald-400" /> AI Receipt Scanning (Local & Cloud)</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-emerald-400" /> Full API Access</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-[#7c3bed]" /> Priority Support</li>
            </ul>
            
            <button 
              onClick={() => handleUpgrade('pro')}
              className="w-full py-3 rounded-xl font-bold text-white bg-[#7c3bed] hover:bg-[#6b33cc] transition-colors shadow-lg shadow-[#7c3bed]/20"
            >
              {user?.plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
            </button>
          </motion.div>

          {/* Personal Edition */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#1c172d]/60 border border-emerald-500/30 rounded-3xl p-8 flex flex-col"
          >
            <div className="mb-8">
              <h3 className="text-xl font-bold text-white mb-2">Personal Edition</h3>
              <div className="text-4xl font-bold text-white mb-2">Open<span className="text-lg text-emerald-400 font-normal ml-2">Source</span></div>
              <p className="text-sm text-gray-400">Self-host GlassExpense on your own hardware.</p>
            </div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-gray-300"><Server className="w-5 h-5 text-emerald-500" /> Self-Hosted Data Control</li>
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-emerald-500" /> Unlimited Jobs & Archives</li>
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-emerald-500" /> Local WebGPU OCR included</li>
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-emerald-500" /> API Access Included</li>
              <li className="flex items-center gap-3 text-gray-300"><Check className="w-5 h-5 text-emerald-500" /> End-to-End Encrypted</li>
            </ul>
            
            <a 
              href="/api-docs"
              className="w-full py-3 rounded-xl font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-center transition-colors block"
            >
              View Self-Hosting Guide
            </a>
          </motion.div>
        </div>
      )}
    </div>
  );
}
