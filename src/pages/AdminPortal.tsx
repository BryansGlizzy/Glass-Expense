import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, LayoutDashboard, Search, Key, Mail, ShieldAlert, BarChart3, Edit2, AlertTriangle, CheckCircle2, Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router';

// Add to your globals or separate types file in real apps
interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  created_at: string;
  plan: string;
}

interface Stats {
  users: number;
  jobs: number;
  expenses: number;
  dbSizeBytes: number;
  uploadsSizeBytes: number;
  isSaaSMode: boolean;
  isUnlocked: boolean;
}

interface ConfigItem {
  key_name: string;
  value: string;
}

interface LicenseKey {
  id: string;
  plan: string;
  status: string;
  created_at: string;
  activated_at: string | null;
  activator_username: string | null;
}

export default function AdminPortal() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [licenses, setLicenses] = useState<LicenseKey[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'config' | 'licenses'>('users');
  
  // Settings / License State
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [configSaving, setConfigSaving] = useState(false);

  // Modal State
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [modalMode, setModalMode] = useState<'email' | 'password' | 'delete' | null>(null);
  const [modalInput, setModalInput] = useState('');
  const [modalStatus, setModalStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
      return;
    }

    const fetchData = async () => {
      try {
        const statsRes = await fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
          
          if (statsData.isSaaSMode || statsData.isUnlocked) {
            const [usersRes, configRes, licensesRes] = await Promise.all([
              fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
              fetch('/api/admin/config', { headers: { Authorization: `Bearer ${token}` } }),
              fetch('/api/admin/licenses', { headers: { Authorization: `Bearer ${token}` } })
            ]);

            if (usersRes.ok) setUsers(await usersRes.json());
            if (configRes.ok) setConfig(await configRes.json());
            if (licensesRes.ok) setLicenses(await licensesRes.json());
          }
        }
      } catch (err) {
        console.error('Failed to load admin data', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user, token, navigate]);

  const handleUpdate = async () => {
    if (!selectedUser || !modalMode || !modalInput) return;
    setModalStatus('loading');
    setModalError('');

    try {
      if (modalMode === 'delete') {
        const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Delete failed');
        }
        setUsers(users.filter(u => u.id !== selectedUser.id));
      } else {
        let payload = {};
        if (modalMode === 'email') payload = { email: modalInput };
        else if (modalMode === 'password') payload = { password: modalInput };
        else if (modalMode === 'plan') payload = { plan: modalInput };
        
        const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
          method: 'PATCH',
          headers: { 
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Update failed');
        }

        if (modalMode === 'email') {
          setUsers(users.map(u => u.id === selectedUser.id ? { ...u, email: modalInput } : u));
        } else if (modalMode === 'plan') {
          setUsers(users.map(u => u.id === selectedUser.id ? { ...u, plan: modalInput } : u));
        }
      }

      setModalStatus('success');

      setTimeout(() => {
        closeModal();
      }, 1500);

    } catch (err: any) {
      setModalStatus('error');
      setModalError(err.message || 'An error occurred');
    }
  };

  const closeModal = () => {
    setSelectedUser(null);
    setModalMode(null);
    setModalInput('');
    setModalStatus('idle');
    setModalError('');
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      if (res.ok) alert('Settings saved successfully');
    } catch (e) {
      alert('Failed to save settings');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleGenerateLicense = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/admin/license/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ plan: 'pro' })
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.key);
        // Refresh licenses list
        const lRes = await fetch('/api/admin/licenses', { headers: { Authorization: `Bearer ${token}` } });
        if (lRes.ok) setLicenses(await lRes.json());
      }
    } catch (e) {
      alert('Failed to generate key');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleActivateLicense = async () => {
    if (!licenseKeyInput) return;
    setIsActivating(true);
    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ key: licenseKeyInput })
      });
      const data = await res.json();
      if (res.ok) {
        alert('License activated successfully! Reloading...');
        window.location.reload();
      } else {
        alert(data.error || 'Failed to activate license');
      }
    } catch (e) {
      alert('Error connecting to server');
    } finally {
      setIsActivating(false);
    }
  };

  const handleRevokeLicense = async (id: string) => {
    if (!confirm('Are you sure you want to delete/revoke this license key?')) return;
    try {
      const res = await fetch(`/api/admin/license/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setLicenses(licenses.filter(l => l.id !== id));
      } else {
        alert('Failed to revoke license');
      }
    } catch (e) {
      alert('Error connecting to server');
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(search.toLowerCase()) || 
    (u.email && u.email.toLowerCase().includes(search.toLowerCase()))
  );

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-white">Loading Admin Portal...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Admin Portal</h1>
          <p className="text-slate-400">Manage users and monitor system health.</p>
        </div>
        <div className="flex bg-amber-500/10 text-amber-400 px-4 py-2 rounded-xl border border-amber-500/20 text-sm font-medium items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          Restricted Access
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel p-6 shadow-lg shadow-blue-500/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-500/20 text-blue-400 rounded-xl">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Accounts</p>
                <p className="text-3xl font-bold text-white">{stats.users}</p>
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel p-6 shadow-lg shadow-emerald-500/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Projects</p>
                <p className="text-3xl font-bold text-white">{stats.jobs}</p>
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel p-6 shadow-lg shadow-purple-500/5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-500/20 text-purple-400 rounded-xl">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Data Storage</p>
                <p className="text-xl font-bold text-white">
                  DB: {(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB
                </p>
                <p className="text-sm text-slate-400">
                  Files: {(stats.uploadsSizeBytes / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {stats && !stats.isSaaSMode && !stats.isUnlocked ? (
        <div className="glass-panel overflow-hidden p-8">
          <div className="max-w-xl mx-auto text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-gradient-to-tr from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Key className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Unlock Multi-User Support</h2>
              <p className="text-slate-400">
                You are running the Personal Edition. Enter a license key to unlock multi-user support and become your own SaaS administrator.
              </p>
            </div>
            <div className="flex gap-3 max-w-md mx-auto">
              <input
                type="text"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value)}
                placeholder="sk_..."
                className="flex-1 bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleActivateLicense}
                disabled={isActivating || !licenseKeyInput}
                className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isActivating ? 'Activating...' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex border-b border-white/10 gap-6">
            <button
              onClick={() => setActiveTab('users')}
              className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'users' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              User Management
              {activeTab === 'users' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'config' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              SaaS Configuration
              {activeTab === 'config' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
            {stats?.isSaaSMode && (
              <button
                onClick={() => setActiveTab('licenses')}
                className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'licenses' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                License Keys
                {activeTab === 'licenses' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
              </button>
            )}
          </div>

          {activeTab === 'users' && (
            <div className="glass-panel overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-800/20">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            User Management
          </h2>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search users..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/50 rounded-xl py-2 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/40 text-slate-400 text-sm">
                <th className="p-4 font-medium border-b border-white/5">Username</th>
                <th className="p-4 font-medium border-b border-white/5">Email</th>
                <th className="p-4 font-medium border-b border-white/5">Plan</th>
                <th className="p-4 font-medium border-b border-white/5">Joined</th>
                <th className="p-4 font-medium border-b border-white/5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 text-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-blue-200 border border-white/5">
                        {u.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{u.username}</span>
                      {u.email === user?.email && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full uppercase tracking-wider">You</span>}
                    </div>
                  </td>
                  <td className="p-4 text-slate-400">{u.email || <span className="italic opacity-50">Not set</span>}</td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-white/5 rounded-lg text-xs font-medium border border-white/10 uppercase tracking-wider text-slate-300">
                      {u.plan}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-sm">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => { setSelectedUser(u); setModalMode('email'); }}
                        title="Change Email"
                        className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-400 transition"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => { setSelectedUser(u); setModalMode('plan'); }}
                        title="Change Plan"
                        className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-purple-400 transition"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                      {u.email !== user?.email && (
                        <button 
                          onClick={() => { setSelectedUser(u); setModalMode('delete'); }}
                          title="Delete User"
                          className="p-2 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition"
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No users found matching "{search}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeTab === 'config' && (
        <div className="glass-panel overflow-hidden p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-white/5 pb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              SaaS Configuration
            </h2>
            <button
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {configSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {config.map((item, idx) => (
              <div key={item.key_name} className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{item.key_name.replace(/_/g, ' ').toUpperCase()}</label>
                <input
                  type="text"
                  value={item.value}
                  onChange={(e) => {
                    const newConfig = [...config];
                    newConfig[idx].value = e.target.value;
                    setConfig(newConfig);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'licenses' && stats?.isSaaSMode && (
        <div className="glass-panel overflow-hidden p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-white/5 pb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-emerald-400" />
              License Keys
            </h2>
            <button
              onClick={handleGenerateLicense}
              disabled={isGenerating}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate New Key'}
            </button>
          </div>

          {generatedKey && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-sm text-emerald-400 mb-1">New Key Generated (Copy it now, it won't be shown again):</p>
                <p className="font-mono text-white text-lg select-all">{generatedKey}</p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedKey);
                  alert('Copied to clipboard');
                }}
                className="text-emerald-400 hover:text-white"
              >
                Copy
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/40 text-slate-400 text-sm">
                  <th className="p-4 font-medium border-b border-white/5">Plan</th>
                  <th className="p-4 font-medium border-b border-white/5">Status</th>
                  <th className="p-4 font-medium border-b border-white/5">Created</th>
                  <th className="p-4 font-medium border-b border-white/5">Activated By</th>
                  <th className="p-4 font-medium border-b border-white/5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map(l => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-slate-800/30">
                    <td className="p-4">
                      <span className="px-2.5 py-1 bg-white/5 rounded-lg text-xs font-medium border border-white/10 uppercase text-slate-300">
                        {l.plan}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${l.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                        {l.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-slate-400 text-sm">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="p-4 text-slate-400">{l.activator_username || '-'}</td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={() => handleRevokeLicense(l.id)}
                        title="Revoke License"
                        className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 transition"
                      >
                        <AlertTriangle className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    )}

    {selectedUser && modalMode && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-1">
                    {modalMode === 'delete' ? 'Delete Account' : modalMode === 'email' ? 'Update Email' : modalMode === 'plan' ? 'Change Plan' : 'Force Password Change'}
                  </h3>
                  <p className="text-sm text-slate-400">
                    For user <strong className="text-white">{selectedUser.username}</strong>
                  </p>
                </div>
                <div className={`p-2 rounded-xl ${modalMode === 'delete' ? 'bg-red-500/20 text-red-500' : modalMode === 'email' ? 'bg-blue-500/20 text-blue-400' : modalMode === 'plan' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {modalMode === 'delete' ? <AlertTriangle className="w-5 h-5" /> : modalMode === 'email' ? <Mail className="w-5 h-5" /> : modalMode === 'plan' ? <Star className="w-5 h-5" /> : <Key className="w-5 h-5" />}
                </div>
              </div>

              {modalStatus === 'error' && (
                <div className="p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  <p className="text-sm text-red-300">{modalError}</p>
                </div>
              )}

              {modalStatus === 'success' ? (
                <div className="py-6 text-center text-emerald-400">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="font-medium">Update successful</p>
                </div>
              ) : modalMode === 'delete' ? (
                <div className="space-y-4">
                  <p className="text-red-400 font-medium border border-red-500/20 bg-red-500/10 p-3 rounded-lg text-sm">
                    WARNING: This will permanently delete the user's account, including all their jobs, expenses, wishlists, api keys, and data. This cannot be undone.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      To confirm, type their username: <span className="text-white font-bold">{selectedUser.username}</span>
                    </label>
                    <input
                      type="text"
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      placeholder={selectedUser.username}
                      className="w-full bg-slate-900 border border-red-500/50 rounded-xl py-3 px-4 text-white focus:border-red-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
              ) : modalMode === 'plan' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Select Plan
                    </label>
                    <select
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 text-white focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select a plan</option>
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="personal">Personal</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      {modalMode === 'email' ? 'New Email Address' : 'New Password (Temporary)'}
                    </label>
                    <input
                      type={modalMode === 'email' ? 'email' : 'text'}
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      placeholder={modalMode === 'email' ? 'user@example.com' : 'Enter a secure password'}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 text-white focus:border-blue-500 focus:outline-none"
                      autoFocus
                    />
                  </div>
                  
                  {modalMode === 'password' && (
                    <p className="text-xs text-amber-400/80 bg-amber-400/5 p-3 rounded-lg border border-amber-500/10">
                      You are manually overriding the password. Make sure to share this via a secure channel.
                    </p>
                  )}
                </div>
              )}
            </div>
            
            {modalStatus !== 'success' && (
              <div className="p-4 bg-slate-800/50 border-t border-slate-700 flex gap-3 justify-end">
                <button 
                  onClick={closeModal}
                  className="px-4 py-2 text-slate-300 hover:text-white transition"
                  disabled={modalStatus === 'loading'}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleUpdate}
                  disabled={!modalInput || modalStatus === 'loading' || (modalMode === 'delete' && modalInput !== selectedUser.username)}
                  className={`px-6 py-2 rounded-xl text-white font-medium transition disabled:opacity-50
                    ${modalMode === 'delete' ? 'bg-red-600 hover:bg-red-500' : modalMode === 'email' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500'}
                  `}
                >
                  {modalStatus === 'loading' ? 'Processing...' : modalMode === 'delete' ? 'Permanently Delete' : 'Save Changes'}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
