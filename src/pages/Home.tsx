import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import {
  Shield,
  Zap,
  BarChart3,
  Calendar,
  Lock,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Globe
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#121317] text-white selection:bg-[#7c3bed]/30 overflow-hidden relative">
      {/* Technical Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#1c172d_0%,#121317_100%)]" />
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(#7c3bed 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }} />
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.2, 0.1],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] rounded-full bg-[#7c3bed]/10 blur-[120px]"
        />
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.05, 0.15, 0.05],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] rounded-full bg-emerald-500/5 blur-[120px]"
        />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-white/5 bg-[#121317]/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center space-x-2">
              <img src="/icon-192.png" alt="Logo" className="w-10 h-10 rounded-xl shadow-lg shadow-[#7c3bed]/20" />
              <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                GlassExpense
              </span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <Link to="/legal" className="text-sm text-gray-400 hover:text-white transition-colors">Privacy</Link>
              <Link to="/login" className="text-sm font-medium hover:text-[#7c3bed] transition-colors">Sign In</Link>
              <Link
                to="/register"
                className="px-5 py-2.5 rounded-xl bg-[#7c3bed] hover:bg-[#6b33cc] text-white text-sm font-semibold transition-all shadow-lg shadow-[#7c3bed]/25 active:scale-95"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="pt-24 pb-32 px-4">
          <div className="max-w-7xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="px-4 py-1.5 rounded-full bg-[#7c3bed]/10 border border-[#7c3bed]/20 text-[#7c3bed] text-xs font-bold uppercase tracking-widest mb-8 inline-block">
                Next-Gen Expense Intelligence
              </span>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-[1.1]">
                Master Your Finances with <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7c3bed] via-purple-400 to-emerald-400">
                  Crystal Clarity
                </span>
              </h1>
              <p className="max-w-2xl mx-auto text-gray-400 text-lg md:text-xl leading-relaxed mb-12">
                Securely track expenses, automate receipt scanning with AI, and sync your budget directly to your calendar.
                End-to-end encrypted for your eyes only.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  to="/register"
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-bold text-lg transition-all shadow-xl shadow-[#7c3bed]/20 flex items-center justify-center gap-2 group"
                >
                  Start Tracking Free
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  to="/login"
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-lg transition-all backdrop-blur-md"
                >
                  Existing Users
                </Link>
              </div>
            </motion.div>

            {/* Visual Teaser */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="mt-20 relative mx-auto max-w-5xl"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-[#121317] via-transparent to-transparent z-10" />
              <div className="rounded-3xl border border-white/10 bg-[#1c172d]/40 backdrop-blur-2xl p-2 shadow-2xl overflow-hidden">
                <img
                  src="/dashboard-preview.png"
                  alt="GlassExpense Dashboard"
                  className="w-full h-auto rounded-2xl border border-white/5 shadow-2xl"
                />
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-32 bg-[#0d0e12]/50 backdrop-blur-sm border-y border-white/5">
          <div className="max-w-7xl mx-auto px-4">
            <div className="text-center mb-20">
              <h2 className="text-3xl md:text-5xl font-bold mb-6">Built for Modern Teams & Individuals</h2>
              <p className="text-gray-400 max-w-2xl mx-auto">
                Powerful tools that stay out of your way, so you can focus on what matters most.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  icon: <Lock className="w-8 h-8 text-[#7c3bed]" />,
                  title: "E2E Encryption",
                  desc: "Jobs, expenses, notes, tax data and receipts are encrypted on your device before they reach our servers. Only you and the people you invite can read them."
                },
                {
                  icon: <Cpu className="w-8 h-8 text-emerald-400" />,
                  title: "Local AI OCR",
                  desc: "Scan receipts instantly on your device. Privacy-first data extraction."
                },
                {
                  icon: <Calendar className="w-8 h-8 text-blue-400" />,
                  title: "Calendar Sync",
                  desc: "Automagically sync project budgets and expenses to Google Calendar."
                }
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  whileHover={{ y: -8 }}
                  className="p-8 rounded-3xl bg-[#1c172d]/30 border border-white/5 hover:border-[#7c3bed]/30 transition-all"
                >
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-4">{feature.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Google OAuth Transparency Section */}
        <section className="py-32 px-4">
          <div className="max-w-4xl mx-auto bg-gradient-to-br from-[#1c172d]/60 to-[#121317] border border-white/10 rounded-[2.5rem] p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Globe className="w-32 h-32" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 text-emerald-400 mb-6">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-bold tracking-widest uppercase text-sm">Verified Integration</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-8">Google Calendar Integration</h2>
              <p className="text-gray-300 text-lg leading-relaxed mb-8">
                GlassExpense requests access to your Google Calendar to provide seamless synchronization between your financial planning and your schedule.
              </p>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-[#7c3bed]" />
                  </div>
                  <div>
                    <h4 className="font-bold mb-1">Project Deadlines</h4>
                    <p className="text-gray-400">Keep track of budget periods and project timelines directly in your calendar.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-[#7c3bed]" />
                  </div>
                  <div>
                    <h4 className="font-bold mb-1">Expense Reminders</h4>
                    <p className="text-gray-400">Never miss a recurring payment or a project milestone.</p>
                  </div>
                </div>
              </div>
              <div className="mt-12 p-6 rounded-2xl bg-white/5 border border-white/5 text-sm text-gray-400 italic">
                Note: We only access your calendar data to create and sync events you explicitly authorize. We do not store or share your calendar information with third parties.
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-20 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center space-x-2">
            <img src="/icon-192.png" alt="Logo" className="w-8 h-8 rounded-lg opacity-80" />
            <span className="font-bold text-gray-400 tracking-tight">GlassExpense</span>
          </div>
          <div className="flex gap-8 text-sm text-gray-500">
            <Link to="/legal" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link to="/legal" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link to="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          </div>
          <div className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} GlassExpense. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
