import { wrapSocket } from '../e2ee/socket';
import { runDueSubscriptions } from '../e2ee/subscriptions';
import { maintainInvoices } from '../invoice/maintain';
import { scheduleSnapshotRefresh } from '../e2ee/reportSnapshot';
import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { LogOut, Home, ShieldAlert, Menu, X, Settings as SettingsIcon, CreditCard, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';

export default function Layout() {
  const { user, token, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  const toggleMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMenu = () => setIsMobileMenuOpen(false);

  // Close menu when navigating
  React.useEffect(() => {
    closeMenu();
  }, [location.pathname]);

  // Global Notifications & Socket Connection
  React.useEffect(() => {
    if (!token) return;

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    let socket: Socket | null = null;

    fetch('/api/jobs', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(jobs => {
        if (!jobs || !Array.isArray(jobs)) return;
        socket = wrapSocket(io(window.location.origin, { auth: { token } }));
        void runDueSubscriptions();
        void maintainInvoices(); // finishes agent-made invoices and drafts estimates for API-posted jobs (once per session)
        scheduleSnapshotRefresh(1500);
        
        jobs.forEach((job: any) => {
          if (!job.is_archived) {
            socket?.emit('join_job', job.id);
          }
        });
        
        socket.on('subscription_reminder', (data: any) => {
          if ('Notification' in window && Notification.permission === 'granted') {
            const title = 'Upcoming subscription';
            const options = {
              body: `A recurring entry is due in ${data.daysBefore} day(s) (${new Date(data.next_generation_date).toLocaleDateString()}). Open the app to see which one.`,
              icon: '/icon-192.png'
            };
            
            if (navigator.serviceWorker) {
              navigator.serviceWorker.ready.then((registration) => {
                registration.showNotification(title, options);
              }).catch(() => {
                new Notification(title, options);
              });
            } else {
              new Notification(title, options);
            }
          }
        });
      })
      .catch(console.error);

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#121317] text-white font-sans selection:bg-[#7c3bed]/30 overflow-x-hidden">
      <nav className="sticky top-0 z-30 border-b border-white/5 bg-[#121317]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/dashboard" className="flex items-center space-x-2 text-xl font-semibold tracking-tight">
              <img src="/icon-192.png" alt="Logo" className="w-8 h-8 rounded-lg shadow-lg shadow-[#7c3bed]/20" />
              <span className="hidden sm:inline">GlassExpense</span>
            </Link>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-6">
              <div className="text-sm text-gray-400">
                Logged in as <span className="text-white font-medium">{user?.username}</span>
              </div>
              
              {user?.isAdmin && (
                <Link
                  to="/admin"
                  className="flex items-center space-x-2 text-sm text-amber-400/80 hover:text-amber-400 transition-colors"
                  title="Admin Portal"
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>Admin</span>
                </Link>
              )}

              <Link
                to="/settings"
                className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white transition-colors"
                title="Settings & API Keys"
              >
                <SettingsIcon className="w-4 h-4" />
                <span>Settings</span>
              </Link>
              
              {!user?.isAdmin && (
                <Link
                  to="/pricing"
                  className="flex items-center space-x-2 text-sm text-[#7c3bed] hover:text-[#6b33cc] transition-colors font-medium"
                  title="Upgrade Plan"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Pricing</span>
                </Link>
              )}
              
              <Link
                to="/api-docs"
                className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white transition-colors"
                title="API Documentation"
              >
                <Terminal className="w-4 h-4" />
                <span>API Docs</span>
              </Link>
              
              <button
                onClick={logout}
                className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden flex items-center">
              <button
                onClick={toggleMenu}
                className="relative z-[102] p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-white/5 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} GlassExpense. All rights reserved.</p>
          <div className="flex items-center space-x-6">
            <Link to="/legal" className="hover:text-white transition-colors">TOS & Privacy Policy</Link>
          </div>
        </div>
      </footer>

      {/* Mobile Menu Drawer — rendered AFTER main content so it always paints on top */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMenu}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] md:hidden"
            />
            
            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-[300px] bg-[#0d0e12] border-l border-white/10 z-[101] md:hidden shadow-[[-20px_0_50px_-15px_rgba(0,0,0,0.5)]] flex flex-col"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#121317]/50 backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <img src="/icon-192.png" alt="Logo" className="w-6 h-6 rounded" />
                  <span className="font-semibold text-lg tracking-tight">Menu</span>
                </div>
                <button onClick={closeMenu} className="p-2 text-gray-400 hover:text-white transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 flex-1 space-y-8 overflow-y-auto">
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] px-1">Account</p>
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center border border-white/10">
                      <span className="text-sm font-bold text-gray-300">
                        {user?.username?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{user?.username}</p>
                      <p className="text-xs text-gray-500">Member</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] px-1">Navigation</p>
                  <div className="space-y-2">
                    <Link
                      to="/dashboard"
                      className="flex items-center space-x-3 p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#7c3bed]/10 flex items-center justify-center">
                        <Home className="w-4 h-4 text-[#7c3bed]" />
                      </div>
                      <span className="font-medium">Dashboard</span>
                    </Link>

                    {user?.isAdmin && (
                      <Link
                        to="/admin"
                        className="flex items-center space-x-3 p-3.5 rounded-2xl bg-amber-400/5 border border-amber-400/10 text-amber-400 hover:bg-amber-400/10 transition-all active:scale-[0.98]"
                      >
                        <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
                          <ShieldAlert className="w-4 h-4" />
                        </div>
                        <span className="font-medium">Admin Portal</span>
                      </Link>
                    )}

                    <Link
                      to="/settings"
                      className="flex items-center space-x-3 p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-400/10 flex items-center justify-center">
                        <SettingsIcon className="w-4 h-4 text-gray-400" />
                      </div>
                      <span className="font-medium">Settings</span>
                    </Link>

                    {!user?.isAdmin && (
                      <Link
                        to="/pricing"
                        className="flex items-center space-x-3 p-3.5 rounded-2xl bg-[#7c3bed]/5 border border-[#7c3bed]/10 hover:bg-[#7c3bed]/10 transition-all active:scale-[0.98] text-[#7c3bed]"
                      >
                        <div className="w-8 h-8 rounded-lg bg-[#7c3bed]/10 flex items-center justify-center">
                          <CreditCard className="w-4 h-4 text-[#7c3bed]" />
                        </div>
                        <span className="font-medium">Pricing</span>
                      </Link>
                    )}

                    <Link
                      to="/api-docs"
                      className="flex items-center space-x-3 p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all active:scale-[0.98]"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gray-400/10 flex items-center justify-center">
                        <Terminal className="w-4 h-4 text-gray-400" />
                      </div>
                      <span className="font-medium">API & Hosting</span>
                    </Link>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-white/5 bg-black/20">
                <button
                  onClick={() => {
                    logout();
                    closeMenu();
                  }}
                  className="w-full flex items-center justify-center space-x-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all active:scale-[0.98]"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Sign Out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
