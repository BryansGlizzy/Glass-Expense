import ReportFigures from '../components/ReportFigures';
import GoogleServerSync from '../components/GoogleServerSync';
import { changePassword as changePasswordE2ee } from '../e2ee/auth';
import SecurityCode from '../components/SecurityCode';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useSearchParams, useLocation } from 'react-router';
import {
  Key,
  Plus,
  Trash2,
  Check,
  Copy,
  AlertTriangle,
  Sparkles,
  Link as LinkIcon,
  Cpu,
  Save,
  Tag,
  Lock,
  BrainCircuit,
  Mail,
  BarChart,
  Calendar,
  ExternalLink,
  Bell,
  FileText,
  RefreshCw,
  User,
  Shield,
  Building
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  agent_access?: 'read' | 'write' | null;
  agent_all_jobs?: boolean | null;
}

interface UserTag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export type SettingsTab = 'account' | 'invoice' | 'tags' | 'ai' | 'reports' | 'integrations' | 'api';

interface TabDefinition {
  id: SettingsTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const TABS: TabDefinition[] = [
  {
    id: 'account',
    label: 'User Account',
    shortLabel: 'Account',
    icon: User,
    description: 'Profile details, security credentials, and E2EE vault'
  },
  {
    id: 'invoice',
    label: 'Company & Invoice',
    shortLabel: 'Invoices',
    icon: FileText,
    description: 'Company info, invoice prefix, labor rates, and notes'
  },
  {
    id: 'tags',
    label: 'Project Tags',
    shortLabel: 'Tags',
    icon: Tag,
    description: 'Color-coded tags for invoice numbering and job tagging'
  },
  {
    id: 'ai',
    label: 'AI & OCR',
    shortLabel: 'AI & OCR',
    icon: Cpu,
    description: 'On-device local OCR engine and cloud AI providers'
  },
  {
    id: 'reports',
    label: 'Reports & Alerts',
    shortLabel: 'Reports',
    icon: BarChart,
    description: 'Automated email summaries and subscription reminder testing'
  },
  {
    id: 'integrations',
    label: 'Integrations',
    shortLabel: 'Integrations',
    icon: Calendar,
    description: 'External service syncing including Google Calendar'
  },
  {
    id: 'api',
    label: 'API Keys',
    shortLabel: 'API',
    icon: Key,
    description: 'Developer keys to programmatically manage expenses'
  }
];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const getInitialTab = (): SettingsTab => {
    const tabParam = searchParams.get('tab') as SettingsTab;
    if (tabParam && ['account', 'invoice', 'tags', 'ai', 'reports', 'integrations', 'api'].includes(tabParam)) {
      return tabParam;
    }
    const hash = window.location.hash;
    if (hash === '#invoice') return 'invoice';
    if (hash === '#tags-config') return 'tags';
    if (hash === '#ai-config') return 'ai';
    if (hash === '#reports-config' || hash === '#subscription-reminder-test') return 'reports';
    if (hash === '#integrations-config' || searchParams.get('google_sync') === 'success') return 'integrations';
    if (hash === '#api-keys-config') return 'api';
    if (hash === '#security-config') return 'account';
    return 'account';
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>(getInitialTab);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<{ rawKey: string; name: string; agent?: 'read' | 'write' } | null>(null);
  const [copied, setCopied] = useState(false);

  // Optional "agent access" for a new API key (server-assisted: the server can read the chosen jobs while the key exists)
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentAccess, setAgentAccess] = useState<'read' | 'write'>('read');
  const [agentAllJobs, setAgentAllJobs] = useState(false);
  const [agentJobIds, setAgentJobIds] = useState<string[]>([]);
  const [agentAck, setAgentAck] = useState(false);
  const [agentJobs, setAgentJobs] = useState<Array<{ id: string; title: string; locked?: boolean }>>([]);
  const [creatingKey, setCreatingKey] = useState(false);

  // AI Settings
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.openai.com/v1');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiTagGeneration, setAiTagGeneration] = useState(false);
  const [useOnDeviceAi, setUseOnDeviceAi] = useState(false);
  const [onDeviceAiModel, setOnDeviceAiModel] = useState('Xenova/donut-base-finetuned-cord-v2');
  const [isSavingAi, setIsSavingAi] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [aiTestError, setAiTestError] = useState('');

  // Tags
  const [tags, setTags] = useState<UserTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#7c3bed');

  // Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [passwordError, setPasswordError] = useState('');

  // Vault Initialization
  const [showVaultInit, setShowVaultInit] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [generatedPhrase, setGeneratedPhrase] = useState('');
  const [phraseConfirmed, setPhraseConfirmed] = useState(false);
  const [isInitializingVault, setIsInitializingVault] = useState(false);
  const [vaultInitStatus, setVaultInitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [vaultInitError, setVaultInitError] = useState('');

  // Email Update
  const [accountEmail, setAccountEmail] = useState('');
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');

  // Automated Reports
  const [reportFrequency, setReportFrequency] = useState('NONE');
  const [isSavingReportSettings, setIsSavingReportSettings] = useState(false);
  const [reportSaveSuccess, setReportSaveSuccess] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testSendSuccess, setTestSendSuccess] = useState(false);
  const [isGeneratingNow, setIsGeneratingNow] = useState(false);
  const [generateNowSuccess, setGenerateNowSuccess] = useState(false);

  // Google Calendar
  const [googleStatus, setGoogleStatus] = useState({ isConnected: false, calendarId: 'primary', syncJobs: false, syncExpenses: false });
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isSavingGoogle, setIsSavingGoogle] = useState(false);
  const [googleSaveSuccess, setGoogleSaveSuccess] = useState(false);

  // Subscription Reminder Test
  const [isTestingSubscription, setIsTestingSubscription] = useState(false);
  const [subscriptionTestSuccess, setSubscriptionTestSuccess] = useState(false);
  const [subscriptionTestError, setSubscriptionTestError] = useState('');

  // Invoice & Company Settings
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  const [defaultHourlyRate, setDefaultHourlyRate] = useState('');
  const [defaultInvoicePrefix, setDefaultInvoicePrefix] = useState('INV');
  const [footerNotes, setFooterNotes] = useState('');
  const [isSavingInvoiceSettings, setIsSavingInvoiceSettings] = useState(false);
  const [invoiceSaveSuccess, setInvoiceSaveSuccess] = useState(false);
  const [invoiceSaveError, setInvoiceSaveError] = useState('');

  const { token, user, masterKey, isVaultLocked, setMasterKey, login } = useAuth();

  useEffect(() => {
    fetchKeys();
    fetchAiSettings();
    fetchTags();
    fetchReportSettings();
    fetchGoogleSettings();
    fetchInvoiceTemplate();

    if (searchParams.get('google_sync') === 'success') {
      setActiveTab('integrations');
      setGoogleSaveSuccess(true);
      setTimeout(() => {
        setGoogleSaveSuccess(false);
        setSearchParams({ tab: 'integrations' });
      }, 3000);
    }
  }, []);

  // Respond to hash changes for deep linking
  useEffect(() => {
    const hash = location.hash;
    if (hash === '#invoice') setActiveTab('invoice');
    else if (hash === '#tags-config') setActiveTab('tags');
    else if (hash === '#ai-config') setActiveTab('ai');
    else if (hash === '#reports-config' || hash === '#subscription-reminder-test') setActiveTab('reports');
    else if (hash === '#integrations-config') setActiveTab('integrations');
    else if (hash === '#api-keys-config') setActiveTab('api');
    else if (hash === '#security-config') setActiveTab('account');
  }, [location.hash]);

  useEffect(() => {
    if (user) {
      setAccountEmail(user.email || '');
    }
  }, [user]);

  const handleTabClick = (tabId: SettingsTab) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId });
  };

  const fetchTags = async () => {
    const res = await fetch('/api/tags', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setTags(await res.json());
  };

  const fetchInvoiceTemplate = async () => {
    try {
      const res = await fetch('/api/invoice-templates', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setCompanyName(data.company_name || '');
          setCompanyAddress(data.company_address || '');
          setCompanyLogoUrl(data.company_logo_url || '');
          setDefaultHourlyRate(data.default_hourly_rate ? data.default_hourly_rate.toString() : '');
          setDefaultInvoicePrefix(data.default_prefix || 'INV');
          setFooterNotes(data.footer_notes || '');
        }
      }
    } catch (e) {
      console.error('Failed to load invoice template', e);
    }
  };

  const handleSaveInvoiceSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInvoiceSettings(true);
    setInvoiceSaveError('');
    try {
      const res = await fetch('/api/invoice-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          company_name: companyName,
          company_address: companyAddress,
          company_logo_url: companyLogoUrl,
          default_hourly_rate: parseFloat(defaultHourlyRate) || 0,
          default_prefix: defaultInvoicePrefix.trim().toUpperCase() || 'INV',
          footer_notes: footerNotes
        })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.template) {
          setDefaultInvoicePrefix(result.template.default_prefix || 'INV');
        }
        setInvoiceSaveSuccess(true);
        setTimeout(() => setInvoiceSaveSuccess(false), 3000);
      } else {
        const err = await res.json();
        setInvoiceSaveError(err.error || 'Failed to save invoice settings');
      }
    } catch {
      setInvoiceSaveError('Network error while saving invoice settings');
    } finally {
      setIsSavingInvoiceSettings(false);
    }
  };

  const fetchReportSettings = async () => {
    const res = await fetch('/api/settings/reports', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      setReportFrequency(data.frequency || 'NONE');
    }
  };

  const fetchAiSettings = async () => {
    const res = await fetch('/api/settings/ai', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      setAiApiKey(data.ai_api_key || '');
      setAiBaseUrl(data.ai_base_url || 'https://api.openai.com/v1');
      setAiModel(data.ai_model || 'gpt-4o-mini');
      setAiTagGeneration(data.ai_tag_generation === 1);
      setUseOnDeviceAi(data.use_on_device_ai === 1);
      setOnDeviceAiModel(data.on_device_ai_model || 'Xenova/donut-base-finetuned-cord-v2');
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAi(true);
    setAiTestError('');

    // Test endpoint before saving
    if (!useOnDeviceAi) {
      try {
        const verifyRes = await fetch('/api/settings/ai/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ ai_api_key: aiApiKey, ai_base_url: aiBaseUrl })
        });

        if (!verifyRes.ok) {
          const err = await verifyRes.json();
          setAiTestError(err.details || 'Failed to connect to AI provider.');
          setIsSavingAi(false);
          return;
        }
      } catch {
        setAiTestError('Network error connecting to verification endpoint.');
        setIsSavingAi(false);
        return;
      }
    }

    const res = await fetch('/api/settings/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        ai_api_key: aiApiKey,
        ai_base_url: aiBaseUrl,
        ai_model: aiModel,
        ai_tag_generation: aiTagGeneration ? 1 : 0,
        use_on_device_ai: useOnDeviceAi ? 1 : 0,
        on_device_ai_model: onDeviceAiModel
      })
    });
    if (res.ok) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setIsSavingAi(false);
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName) return;

    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: newTagName, color: newTagColor })
    });

    if (res.ok) {
      const tag = await res.json();
      setTags([tag, ...tags]);
      setNewTagName('');
    }
  };

  const handleDeleteTag = async (id: string) => {
    const res = await fetch(`/api/tags/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setTags(tags.filter((t) => t.id !== id));
    }
  };

  const handleSaveReportSettings = async () => {
    setIsSavingReportSettings(true);
    const res = await fetch('/api/settings/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ frequency: reportFrequency })
    });
    if (res.ok) {
      setReportSaveSuccess(true);
      setTimeout(() => setReportSaveSuccess(false), 3000);
    }
    setIsSavingReportSettings(false);
  };

  const handleSendTestReport = async () => {
    setIsSendingTest(true);
    const res = await fetch('/api/settings/reports/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setTestSendSuccess(true);
      setTimeout(() => setTestSendSuccess(false), 3000);
    } else {
      alert('Failed to send test report. Ensure your email is set up.');
    }
    setIsSendingTest(false);
  };

  const handleGenerateReportNow = async () => {
    setIsGeneratingNow(true);
    const res = await fetch('/api/settings/reports/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setGenerateNowSuccess(true);
      setTimeout(() => setGenerateNowSuccess(false), 3000);
    } else {
      alert('Failed to generate report. Ensure your email is set up.');
    }
    setIsGeneratingNow(false);
  };

  const handleTestSubscriptionNotifications = async () => {
    setIsTestingSubscription(true);
    setSubscriptionTestSuccess(false);
    setSubscriptionTestError('');

    try {
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      }

      const res = await fetch('/api/settings/subscriptions/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send test subscription reminder email');
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        const title = 'Subscription Reminder (Test)';
        const options = {
          body: 'Your Netflix Premium (Test) subscription ($14.99) is due in 2 days.',
          icon: '/icon-192.png'
        };
        if (navigator.serviceWorker) {
          navigator.serviceWorker.ready.then((registration) => {
            registration.showNotification(title, options);
          });
        } else {
          new Notification(title, options);
        }
      }

      setSubscriptionTestSuccess(true);
      setTimeout(() => setSubscriptionTestSuccess(false), 3000);
    } catch (err: any) {
      setSubscriptionTestError(err.message);
    } finally {
      setIsTestingSubscription(false);
    }
  };

  const fetchGoogleSettings = async () => {
    const res = await fetch('/api/settings/google', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setGoogleStatus(await res.json());
  };

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await fetch('/api/auth/google', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Disconnect your Google account? Syncing will stop immediately.')) return;
    const res = await fetch('/api/settings/google/disconnect', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setGoogleStatus({ isConnected: false, calendarId: 'primary', syncJobs: false, syncExpenses: false });
    }
  };

  const handleSaveGoogleSettings = async () => {
    setIsSavingGoogle(true);
    const res = await fetch('/api/settings/google', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        calendarId: googleStatus.calendarId,
        syncJobs: googleStatus.syncJobs,
        syncExpenses: googleStatus.syncExpenses
      })
    });
    if (res.ok) {
      setGoogleSaveSuccess(true);
      setTimeout(() => setGoogleSaveSuccess(false), 3000);
    }
    setIsSavingGoogle(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;

    if (isVaultLocked || !masterKey) {
      setPasswordStatus('error');
      setPasswordError('Your Vault is currently locked. You cannot change your password until you unlock your vault.');
      return;
    }

    setIsChangingPassword(true);
    setPasswordStatus('idle');
    setPasswordError('');

    try {
      // Keys are re-derived and the vault key is re-wrapped in the browser; the server only receives derived credentials.
      const newToken = await changePasswordE2ee(currentPassword, newPassword);
      // Changing the password signs out every other session; keep this one alive with the fresh token.
      if (user) login(newToken, user);

      setCurrentPassword('');
      setNewPassword('');
      setPasswordStatus('success');
      setTimeout(() => setPasswordStatus('idle'), 3000);
    } catch (err: any) {
      setPasswordStatus('error');
      setPasswordError(err.message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const fetchKeys = async () => {
    const res = await fetch('/api/keys', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setKeys(await res.json());
    }
  };

  useEffect(() => {
    fetch('/api/info').then(r => r.json()).then(i => setAgentAvailable(Boolean(i?.agent_access_available))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!agentEnabled || agentJobs.length) return;
    fetch('/api/jobs', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((jobs: any[]) => setAgentJobs(jobs.filter(j => j.role === 'owner' || j.role === 'member').filter(j => !j.locked).map(j => ({ id: j.id, title: j.title }))))
      .catch(() => {});
  }, [agentEnabled]);

  const resetAgentForm = () => { setAgentEnabled(false); setAgentAccess('read'); setAgentAllJobs(false); setAgentJobIds([]); setAgentAck(false); };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || creatingKey) return;
    if (agentEnabled && !agentAck) { alert('Please confirm that you understand the privacy implications of agent access.'); return; }
    if (agentEnabled && !agentAllJobs && agentJobIds.length === 0) { alert('Select at least one job, or choose "All jobs".'); return; }

    setCreatingKey(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newKeyName,
          ...(agentEnabled ? { agent: { access: agentAccess, all_jobs: agentAllJobs, job_ids: agentAllJobs ? undefined : agentJobIds } } : {}),
        })
      });

      if (res.ok) {
        const data = await res.json();
        setKeys([{ ...data.key, agent_access: agentEnabled ? agentAccess : null, agent_all_jobs: agentEnabled ? agentAllJobs : null }, ...keys]);
        setGeneratedKey({ rawKey: data.rawKey, name: data.key.name, agent: agentEnabled ? agentAccess : undefined });
        setNewKeyName('');
        resetAgentForm();
      } else {
        let msg = 'Could not create the API key.';
        try { msg = (await res.json())?.error || msg; } catch { /* keep default */ }
        alert(msg);
      }
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRemoveAgentAccess = async (id: string) => {
    if (!confirm('Remove agent access from this key? The server will delete the job keys it holds for it. The key keeps working for the calendar endpoint only.')) return;
    const res = await fetch(`/api/keys/${id}/agent`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setKeys(keys.map(k => (k.id === id ? { ...k, agent_access: null, agent_all_jobs: null } : k)));
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? Any applications relying on it will stop working immediately.')) return;

    const res = await fetch(`/api/keys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) {
      setKeys(keys.filter((k) => k.id !== id));
    }
  };

  const copyToClipboard = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey.rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-gray-400 mt-1">Manage your account preferences, configurations, and integrations</p>
        </div>
      </div>

      {/* Modern Glassmorphic Tab Navigation Bar */}
      <div className="bg-[#1c172d]/70 border border-white/5 p-1.5 rounded-2xl backdrop-blur-md overflow-x-auto no-scrollbar shadow-inner">
        <div className="flex items-center gap-1.5 min-w-max">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#7c3bed] text-white shadow-lg shadow-[#7c3bed]/30 border border-purple-400/30 font-semibold'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                <span>{tab.label}</span>
                {tab.id === 'tags' && tags.length > 0 && (
                  <span className={`text-[11px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-300'}`}>
                    {tags.length}
                  </span>
                )}
                {tab.id === 'api' && keys.length > 0 && (
                  <span className={`text-[11px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-300'}`}>
                    {keys.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content Display */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="space-y-6"
        >
          {/* TAB 1: USER ACCOUNT SETTINGS (DEFAULT) */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              {/* Profile Card */}
              <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7c3bed] to-purple-800 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-[#7c3bed]/30 border border-purple-400/20">
                      {(user?.username?.[0] || 'U').toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-white">{user?.username}</h2>
                        {user?.isAdmin ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Administrator
                          </span>
                        ) : null}
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase">
                          {user?.plan || 'free'} tier
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{user?.email || 'No email attached to this account'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {user?.master_key_encrypted ? (
                      <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                        <Shield className="w-4 h-4" />
                        <span>E2EE Vault Encrypted</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Legacy Vault Unencrypted</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">Account Security & Credentials</h3>
                      <p className="text-xs text-gray-400">Manage your verified email, encryption vault, and password</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Security & Credentials Card */}
              <div id="security-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
                {/* Email Address Section */}
                <div className="mb-8 pb-8 border-b border-white/5">
                  <div className="flex items-center gap-2 mb-4">
                    <Mail className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-medium text-gray-300">Email Address</h3>
                  </div>

                  {emailStatus === 'error' && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-4">
                      {emailError}
                    </div>
                  )}

                  {(() => {
                    const isLegacy = !user?.email;
                    const isAdmin = !!user?.isAdmin;
                    const canEdit = isLegacy || isAdmin;

                    return (
                      <div className="max-w-md space-y-3">
                        <div className="relative">
                          <input
                            type="email"
                            value={accountEmail}
                            onChange={(e) => canEdit && setAccountEmail(e.target.value)}
                            readOnly={!canEdit}
                            className={`w-full bg-black/20 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none transition-all ${
                              canEdit
                                ? 'border-white/10 focus:ring-2 focus:ring-blue-500/50'
                                : 'border-white/5 opacity-60 cursor-not-allowed'
                            }`}
                            placeholder="Enter your email address"
                          />
                          {!canEdit && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <Lock className="w-4 h-4 text-gray-500" />
                            </div>
                          )}
                        </div>
                        {!canEdit && (
                          <p className="text-xs text-gray-500">
                            Your email is locked. Only an administrator can change it.
                          </p>
                        )}
                        {isLegacy && (
                          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <p className="text-xs text-amber-400">
                              <strong>Legacy Account:</strong> Your account was created before email was required. Adding an email enables password recovery and account notifications.
                            </p>
                          </div>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!accountEmail) return;
                              setIsUpdatingEmail(true);
                              setEmailStatus('idle');
                              setEmailError('');
                              try {
                                const res = await fetch('/api/auth/me/email', {
                                  method: 'PATCH',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${token}`
                                  },
                                  body: JSON.stringify({ email: accountEmail })
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Failed to update email');
                                setEmailStatus('success');
                                setTimeout(() => setEmailStatus('idle'), 3000);
                              } catch (err: any) {
                                setEmailStatus('error');
                                setEmailError(err.message);
                              } finally {
                                setIsUpdatingEmail(false);
                              }
                            }}
                            disabled={!accountEmail || isUpdatingEmail || accountEmail === (user?.email || '')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-50 ${
                              emailStatus === 'success'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 hover:border-blue-500/30'
                            }`}
                          >
                            {emailStatus === 'success' ? (
                              <><Check className="w-4 h-4" /> Email Saved!</>
                            ) : isUpdatingEmail ? (
                              'Saving...'
                            ) : (
                              <><Mail className="w-4 h-4" /> {isLegacy ? 'Add Email' : 'Update Email'}</>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* E2EE Vault Setup (For Legacy Accounts) */}
                <SecurityCode />

                {/* Password Update Form */}
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-4">Change Password</h3>
                  <form onSubmit={handleChangePassword} className="space-y-5 max-w-md">
                    {passwordStatus === 'error' && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                        {passwordError}
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-300">Current Password</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="Enter current password"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-300">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="Enter new password"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!currentPassword || !newPassword || isChangingPassword}
                      className={`w-full flex justify-center items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-lg shadow-black/20 disabled:opacity-50 ${
                        passwordStatus === 'success'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20'
                      }`}
                    >
                      {passwordStatus === 'success' ? (
                        <>
                          <Check className="w-5 h-5" />
                          Password Updated!
                        </>
                      ) : isChangingPassword ? (
                        'Updating...'
                      ) : (
                        'Update Password'
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COMPANY & INVOICE SETTINGS */}
          {activeTab === 'invoice' && (
            <div id="invoice" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
              <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
                    <FileText className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">Company & Invoice Settings</h2>
                    <p className="text-sm text-gray-400">Configure global business information, invoice prefix, and payment terms</p>
                  </div>
                </div>
                {invoiceSaveSuccess && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-1.5 rounded-xl text-xs font-medium"
                  >
                    <Check className="w-4 h-4" /> Saved Successfully
                  </motion.div>
                )}
              </div>

              {invoiceSaveError && (
                <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-2xl text-sm flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span>{invoiceSaveError}</span>
                </div>
              )}

              <form onSubmit={handleSaveInvoiceSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Company Name</label>
                      <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="e.g. Acme Contracting & Design LLC"
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Default Invoice Prefix</label>
                        <input
                          type="text"
                          value={defaultInvoicePrefix}
                          onChange={(e) => setDefaultInvoicePrefix(e.target.value.toUpperCase())}
                          placeholder="INV"
                          maxLength={10}
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                        />
                        <p className="text-[11px] text-gray-500 mt-1.5">Default prefix used when no job tag is assigned (e.g. INV-A00001).</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Default Hourly Labor Rate ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={defaultHourlyRate}
                          onChange={(e) => setDefaultHourlyRate(e.target.value)}
                          placeholder="75.00"
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                        />
                        <p className="text-[11px] text-gray-500 mt-1.5">Default hourly rate applied when creating new jobs.</p>
                      </div>
                    </div>
                  </div>

                  {/* Logo URL & Preview */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Company Logo URL</label>
                    <input
                      type="url"
                      value={companyLogoUrl}
                      onChange={(e) => setCompanyLogoUrl(e.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 mb-2"
                    />
                    <div className="w-full h-28 border border-dashed border-white/10 rounded-xl bg-black/20 flex items-center justify-center overflow-hidden p-2">
                      {companyLogoUrl ? (
                        <img
                          src={companyLogoUrl}
                          alt="Logo Preview"
                          className="max-h-full max-w-full object-contain"
                          onError={(e) => {
                            (e.target as any).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span className="text-xs text-gray-500">Logo preview will appear here</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Company Address & Contact</label>
                    <textarea
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      rows={3}
                      placeholder="123 Commercial Blvd, Suite 200&#10;Austin, TX 78701&#10;billing@acme.com | (555) 019-2834"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Default Footer Terms & Payment Notes</label>
                    <textarea
                      value={footerNotes}
                      onChange={(e) => setFooterNotes(e.target.value)}
                      rows={3}
                      placeholder="Payment is due within 30 days of invoice date. Thank you for your business!"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 resize-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSavingInvoiceSettings}
                    className="px-6 py-2.5 rounded-xl text-sm font-medium bg-[#7c3bed] hover:bg-[#6b33cc] text-white transition-colors shadow-lg shadow-[#7c3bed]/20 flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSavingInvoiceSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>{isSavingInvoiceSettings ? 'Saving...' : 'Save Invoice Settings'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: PROJECT TAGS */}
          {activeTab === 'tags' && (
            <div id="tags-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#7c3bed]/10 rounded-xl flex items-center justify-center">
                    <Tag className="w-5 h-5 text-[#7c3bed]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">My Tags</h2>
                    <p className="text-sm text-gray-400">Manage tags shared across jobs and expense tracking</p>
                  </div>
                </div>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 mb-8">
                <form onSubmit={handleCreateTag} className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="space-y-2 flex-grow">
                    <label className="text-sm font-medium text-gray-300">Tag Name</label>
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                      placeholder="e.g., Tools, Materials, Travel"
                      required
                    />
                  </div>
                  <div className="space-y-2 w-full md:w-32">
                    <label className="text-sm font-medium text-gray-300">Color</label>
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-full h-12 bg-black/20 border border-white/10 rounded-xl p-1 cursor-pointer"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!newTagName}
                    className="h-12 px-6 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Tag
                  </button>
                </form>
              </div>

              <div className="flex flex-wrap gap-3">
                {tags.length === 0 ? (
                  <div className="w-full text-center py-8 text-gray-500">
                    No tags created yet. Add one above to organize your jobs and expenses.
                  </div>
                ) : (
                  tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-black/20 group"
                    >
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="text-sm text-gray-200">{tag.name}</span>
                      <button
                        onClick={() => handleDeleteTag(tag.id)}
                        className="ml-2 text-gray-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete Tag"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 4: AI & OCR CONFIGURATION */}
          {activeTab === 'ai' && (
            <div id="ai-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">AI Configuration</h2>
                  <p className="text-sm text-gray-400">Configure On-Device local OCR or Bring-Your-Own API</p>
                </div>
              </div>

              {user?.plan === 'free' && !user?.isAdmin ? (
                <div className="p-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex flex-col items-center justify-center text-center">
                  <Lock className="w-8 h-8 text-blue-400 mb-3" />
                  <h3 className="text-lg font-medium text-white mb-2">AI Features are Locked</h3>
                  <p className="text-sm text-gray-400 mb-4 max-w-md">
                    Magic Scan, Automatic Tagging, and On-Device OCR require a paid subscription. Upgrade to unlock powerful AI receipt processing.
                  </p>
                  <Link to="/pricing" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors">
                    View Plans & Upgrade
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSaveAiSettings} className="space-y-6">
                  {aiTestError && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                      <strong>Connection Failed:</strong> {aiTestError}
                    </div>
                  )}

                  <div className="p-4 bg-black/20 border border-white/5 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => setUseOnDeviceAi(!useOnDeviceAi)}>
                      <div>
                        <h3 className="text-white font-medium">Use On-Device Local OCR</h3>
                        <p className="text-sm text-gray-400">Process images locally on your device GPU using WebGPU. 100% private. Bypasses the backend API.</p>
                      </div>
                      <div className={`w-12 h-6 rounded-full transition-colors ${useOnDeviceAi ? 'bg-purple-500' : 'bg-gray-600'} relative`}>
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${useOnDeviceAi ? 'left-7' : 'left-1'}`}></div>
                      </div>
                    </div>

                    {useOnDeviceAi && (
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <BrainCircuit className="w-5 h-5 text-emerald-400" />
                          <div>
                            <h4 className="text-white font-medium">Tesseract.js OCR Engine Active</h4>
                            <p className="text-sm text-gray-400">Offline WebAssembly OCR. No data is sent to the cloud.</p>
                            <input type="hidden" value="tesseract" onChange={() => setOnDeviceAiModel('tesseract')} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {!useOnDeviceAi && (
                    <div className="space-y-4 opacity-100 transition-opacity">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">OpenAI-Compatible API Key</label>
                        <input
                          type="password"
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                          placeholder="sk-..."
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">API Base URL</label>
                        <input
                          type="text"
                          value={aiBaseUrl}
                          onChange={(e) => setAiBaseUrl(e.target.value)}
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Vision Model Name</label>
                        <input
                          type="text"
                          value={aiModel}
                          onChange={(e) => setAiModel(e.target.value)}
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono text-sm"
                          placeholder="gpt-4o-mini"
                        />
                      </div>
                      <div className="p-4 bg-black/20 border border-white/5 rounded-2xl flex items-center justify-between cursor-pointer" onClick={() => setAiTagGeneration(!aiTagGeneration)}>
                        <div>
                          <h3 className="text-white font-medium">Automatic Tagging</h3>
                          <p className="text-sm text-gray-400">Allow AI to automatically categorize and tag verified expenses.</p>
                        </div>
                        <div className={`w-12 h-6 rounded-full transition-colors ${aiTagGeneration ? 'bg-purple-500' : 'bg-gray-600'} relative`}>
                          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${aiTagGeneration ? 'left-7' : 'left-1'}`}></div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-4 pt-4 border-t border-white/5">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                      <div className="space-y-4 flex-1">
                        <p className="text-xs text-gray-500">
                          Your API key is sent only to your configured endpoint. Use a vision-capable model like gpt-4o, gpt-4o-mini, or compatible local models.
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                          <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          <p className="text-xs text-gray-400">
                            <strong className="text-emerald-400 font-medium">Recommendation:</strong> For API OCR, <strong className="text-white">GLM-OCR</strong> provides the best consistency.
                            <a href="https://huggingface.co/ggml-org/GLM-OCR-GGUF" target="_blank" rel="noreferrer" className="ml-1 text-[#7c3bed] hover:underline inline-flex items-center gap-0.5">
                              Get it on Hugging Face <LinkIcon className="w-3 h-3" />
                            </a>
                          </p>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isSavingAi || (!useOnDeviceAi && !aiApiKey) || (useOnDeviceAi && !onDeviceAiModel)}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-lg whitespace-nowrap disabled:opacity-50 cursor-pointer ${
                          saveSuccess
                            ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                            : 'bg-[#7c3bed] hover:bg-[#6b33cc] text-white shadow-[#7c3bed]/20'
                        }`}
                      >
                        {saveSuccess ? (
                          <>
                            <Check className="w-5 h-5" />
                            <span>Saved!</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-5 h-5" />
                            <span>{isSavingAi ? 'Saving...' : 'Save Configuration'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 5: AUTOMATED REPORTS & NOTIFICATIONS */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              {/* Reports Schedule Card */}
              <div id="reports-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                      <BarChart className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-white">Automated Reports</h2>
                      <p className="text-sm text-gray-400">Schedule regular financial summaries to your email</p>
                    </div>
                  </div>
                </div>

                <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
                  <div className="space-y-6 max-w-xl">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Report Frequency</label>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <select
                          value={reportFrequency}
                          onChange={(e) => setReportFrequency(e.target.value)}
                          className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        >
                          <option value="NONE">Off / Disable</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="BIWEEKLY">Bi-weekly</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
                        <button
                          onClick={handleSaveReportSettings}
                          disabled={isSavingReportSettings}
                          className={`px-6 py-3 rounded-xl font-medium transition-all shadow-lg whitespace-nowrap disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer ${
                            reportSaveSuccess
                              ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                          }`}
                        >
                          {reportSaveSuccess ? (
                            <><Check className="w-4 h-4" /> Saved</>
                          ) : (
                            <><Save className="w-4 h-4" /> Save Schedule</>
                          )}
                        </button>
                      </div>
                    </div>

                    <ReportFigures />

                    <div className="pt-6 border-t border-white/5 space-y-4">
                      <h3 className="text-sm font-medium text-gray-300">Manual Generation</h3>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <button
                          onClick={handleSendTestReport}
                          disabled={isSendingTest}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 hover:border-blue-500/30 rounded-xl font-medium transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {testSendSuccess ? (
                            <><Check className="w-4 h-4" /> Sent to Inbox!</>
                          ) : (
                            <><Mail className="w-4 h-4" /> Send Test Email</>
                          )}
                        </button>
                        <button
                          onClick={handleGenerateReportNow}
                          disabled={isGeneratingNow}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 rounded-xl font-medium transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {generateNowSuccess ? (
                            <><Check className="w-4 h-4" /> Generated!</>
                          ) : (
                            <><BarChart className="w-4 h-4" /> Generate Now</>
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Test emails generate a sample 7-day report. Generate Now uses your configured frequency window. You must have an email configured under User Account.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subscription Notifications Test Card */}
              <div id="subscription-reminder-test" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                      <Bell className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-white">Subscription Notifications Test</h2>
                      <p className="text-sm text-gray-400">Verify your email and browser notification delivery systems</p>
                    </div>
                  </div>
                </div>

                <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
                  <div className="max-w-xl space-y-4">
                    <p className="text-sm text-gray-300">
                      Test your configuration by sending a mock subscription reminder. This will dispatch a styled notification email to your inbox and trigger an immediate local browser push alert.
                    </p>

                    {subscriptionTestError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                        <strong>Test Failed:</strong> {subscriptionTestError}
                      </div>
                    )}

                    <div className="pt-2 flex flex-col sm:flex-row gap-4">
                      <button
                        onClick={handleTestSubscriptionNotifications}
                        disabled={isTestingSubscription}
                        className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-lg whitespace-nowrap disabled:opacity-50 cursor-pointer ${
                          subscriptionTestSuccess
                            ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                            : 'bg-[#7c3bed] hover:bg-[#6b33cc] text-white shadow-[#7c3bed]/20'
                        }`}
                      >
                        {subscriptionTestSuccess ? (
                          <><Check className="w-5 h-5" /> Test Notifications Dispatched!</>
                        ) : (
                          <><Bell className="w-5 h-5" /> {isTestingSubscription ? 'Testing...' : 'Send Test Notification'}</>
                        )}
                      </button>
                    </div>

                    <p className="text-xs text-gray-500">
                      Note: Ensure you have an email configured under User Account and have granted notification permissions to this site when prompted.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: INTEGRATIONS */}
          {activeTab === 'integrations' && (
            <div id="integrations-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Integrations</h2>
                  <p className="text-sm text-gray-400">Connect GlassExpense with external services</p>
                </div>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
                <div className="flex items-start justify-between gap-6 flex-wrap">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center flex-shrink-0">
                      <svg viewBox="0 0 24 24" className="w-7 h-7">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Google Calendar</h3>
                      <p className="text-sm text-gray-400 max-w-md">
                        Sync your project dates and expense entries directly to your Google Calendar.
                      </p>
                    </div>
                  </div>

                  {!googleStatus.isConnected ? (
                    <button
                      onClick={handleConnectGoogle}
                      disabled={isConnectingGoogle}
                      className="flex items-center gap-2 px-6 py-3 bg-white text-black hover:bg-gray-200 rounded-xl font-semibold transition-all shadow-lg cursor-pointer"
                    >
                      {isConnectingGoogle ? (
                        'Connecting...'
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4" />
                          Connect Calendar
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={handleDisconnectGoogle}
                      className="text-sm text-rose-400 hover:text-rose-300 font-medium transition-colors cursor-pointer"
                    >
                      Disconnect Account
                    </button>
                  )}
                </div>

                {googleStatus.isConnected && (
                  <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">Target Calendar ID</label>
                        <input
                          type="text"
                          value={googleStatus.calendarId}
                          onChange={(e) => setGoogleStatus({ ...googleStatus, calendarId: e.target.value })}
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                          placeholder="primary"
                        />
                        <p className="text-[10px] text-gray-500">Use 'primary' or a specific Calendar ID from your Google settings.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-medium text-gray-300">Synchronization Preferences</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="flex items-center justify-between p-4 bg-black/20 border border-white/5 rounded-2xl cursor-pointer group hover:bg-black/40 transition-colors">
                          <div className="flex flex-col">
                            <span className="text-white font-medium">Sync Projects (Jobs)</span>
                            <span className="text-xs text-gray-500">Auto-create events for start/end dates</span>
                          </div>
                          <div className="relative">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={googleStatus.syncJobs}
                              onChange={(e) => setGoogleStatus({ ...googleStatus, syncJobs: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:bg-blue-500 transition-colors"></div>
                            <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                          </div>
                        </label>
                      </div>
                    </div>

                    <GoogleServerSync />

                    <div className="flex justify-end pt-4">
                      <button
                        onClick={handleSaveGoogleSettings}
                        disabled={isSavingGoogle}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all shadow-lg whitespace-nowrap disabled:opacity-50 cursor-pointer ${
                          googleSaveSuccess
                            ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                            : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/20'
                        }`}
                      >
                        {googleSaveSuccess ? (
                          <><Check className="w-4 h-4" /> Settings Saved</>
                        ) : (
                          <><Save className="w-4 h-4" /> {isSavingGoogle ? 'Saving...' : 'Update Sync Settings'}</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: DEVELOPER API KEYS */}
          {activeTab === 'api' && (
            <div id="api-keys-config" className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center">
                  <Key className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">API Keys</h2>
                  <p className="text-sm text-gray-400">Generate keys to programmatically access your expense data</p>
                </div>
              </div>

              {user?.plan === 'free' && !user?.isAdmin ? (
                <div className="p-6 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex flex-col items-center justify-center text-center">
                  <Lock className="w-8 h-8 text-purple-400 mb-3" />
                  <h3 className="text-lg font-medium text-white mb-2">API Access is Locked</h3>
                  <p className="text-sm text-gray-400 mb-4 max-w-md">
                    Developer API access is exclusive to paid tiers. Upgrade your account to generate API keys and build custom integrations.
                  </p>
                  <Link to="/pricing" className="px-6 py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-medium transition-colors">
                    View Plans & Upgrade
                  </Link>
                </div>
              ) : (
                <>
                  {generatedKey && (
                    <div className="mb-8 p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-2 h-full bg-amber-500"></div>
                      <div className="flex items-start gap-4">
                        <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-1" />
                        <div className="flex-1">
                          <h3 className="text-amber-500 font-medium mb-1">Save your API Key</h3>
                          <p className="text-sm text-amber-500/80 mb-2">
                            Copy this key now; <strong>it cannot be shown again</strong>. It has <strong>two parts separated by a dot</strong>.
                          </p>
                          <ul className="text-xs text-amber-500/80 mb-4 list-disc pl-5 space-y-1">
                            <li>Send <strong>only the part before the dot</strong> in the <code>x-api-key</code> header{generatedKey.agent ? <> (calendar endpoint and the <code>/api/agent/v1</code> agent API, {generatedKey.agent === 'write' ? 'read + write' : 'read-only'})</> : <> (it works for the calendar endpoint only)</>}.</li>
                            <li>The part <strong>after the dot is your private decryption secret</strong>: keep it in your app and never send it anywhere. It is what lets your app read job titles; our server never sees it.</li>
                            {generatedKey.agent && <li><strong>Treat this key like a password.</strong> Anyone who has the part before the dot can {generatedKey.agent === 'write' ? 'read and add to' : 'read'} the jobs you selected until you revoke it.</li>}
                          </ul>

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <code className="flex-1 bg-black/40 px-4 py-3 rounded-xl border border-white/10 font-mono text-sm text-gray-200 break-all">
                              {generatedKey.rawKey}
                            </code>
                            <button
                              onClick={copyToClipboard}
                              className="flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors font-medium border border-white/10 cursor-pointer"
                            >
                              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                              <span>{copied ? 'Copied!' : 'Copy'}</span>
                            </button>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <button
                              onClick={() => setGeneratedKey(null)}
                              className="text-sm text-gray-400 hover:text-white cursor-pointer"
                            >
                              I have saved this key
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleCreateKey} className="flex flex-col gap-4 mb-8">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="Key Name (e.g. Zapier Integration)"
                        required
                      />
                      <button
                        type="submit"
                        disabled={creatingKey}
                        className="bg-[#7c3bed] hover:bg-[#6b33cc] disabled:opacity-60 text-white px-6 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#7c3bed]/20 whitespace-nowrap cursor-pointer"
                      >
                        <Plus className="w-5 h-5" />
                        <span>{creatingKey ? 'Generating…' : 'Generate Key'}</span>
                      </button>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <label className={`flex items-start gap-3 ${agentAvailable ? 'cursor-pointer' : 'opacity-60'}`}>
                        <input type="checkbox" className="mt-1" checked={agentEnabled} disabled={!agentAvailable} onChange={(e) => setAgentEnabled(e.target.checked)} />
                        <span>
                          <span className="block text-sm font-medium text-white">Agent access for AI agents &amp; automations (optional)</span>
                          <span className="block text-xs text-gray-400 mt-0.5">
                            By default a key can only read your calendar. Turn this on to let the key list jobs, read entries, add entries and create jobs through a plain JSON API.
                          </span>
                          {!agentAvailable && <span className="block text-xs text-amber-400 mt-1">This server is not configured for agent access (SERVER_WRAP_KEY is not set).</span>}
                        </span>
                      </label>

                      {agentEnabled && (
                        <div className="mt-4 space-y-4">
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200/90 space-y-2">
                            <div className="flex items-center gap-2 text-amber-400 font-medium text-sm"><AlertTriangle className="w-4 h-4" /> Privacy implications — please read</div>
                            <p>GlassExpense normally cannot read your data: everything is encrypted in your browser. Agent access <strong>weakens that on purpose</strong> for the jobs you select below:</p>
                            <ul className="list-disc pl-5 space-y-1">
                              <li>Your browser gives <strong>our server the decryption keys</strong> for the selected jobs. The server stores them (encrypted with a server secret) for as long as this key exists, and can read those jobs&apos; titles, clients, amounts and descriptions.</li>
                              <li><strong>If this API key leaks</strong>, anyone holding it can read those jobs{agentAccess === 'write' ? ' and add entries or create jobs in your account' : ''} until you revoke it. The key is a bearer secret: no password is needed.</li>
                              <li><strong>If the server&apos;s database and its server secret are both compromised</strong>, the selected jobs can be read. Jobs you do not select are not affected, and your password, recovery phrase, tax data and AI provider key are never shared.</li>
                              <li>Anything an agent reads is sent wherever the agent sends it (for example to an AI provider). Only connect agents you trust.</li>
                              <li>Receipts, tags and tax data are not available through this API. Agents cannot edit or delete anything.</li>
                              <li>You can remove agent access or revoke the key at any time; the server then deletes the keys it held.</li>
                            </ul>
                          </div>

                          <div>
                            <div className="text-xs font-medium text-gray-300 mb-2">What may this key do?</div>
                            <div className="flex flex-col sm:flex-row gap-3">
                              <label className="flex items-center gap-2 text-sm text-gray-200"><input type="radio" name="agent-access" checked={agentAccess === 'read'} onChange={() => setAgentAccess('read')} /> Read only</label>
                              <label className="flex items-center gap-2 text-sm text-gray-200"><input type="radio" name="agent-access" checked={agentAccess === 'write'} onChange={() => setAgentAccess('write')} /> Read + write (add entries, create jobs)</label>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-medium text-gray-300 mb-2">Which jobs?</div>
                            <label className="flex items-center gap-2 text-sm text-gray-200 mb-2"><input type="radio" name="agent-scope" checked={!agentAllJobs} onChange={() => setAgentAllJobs(false)} /> Only the jobs I select (recommended)</label>
                            {!agentAllJobs && (
                              <div className="max-h-44 overflow-auto rounded-xl border border-white/10 bg-black/30 p-2 mb-2 space-y-1">
                                {agentJobs.length === 0 ? <div className="text-xs text-gray-500 p-2">No jobs found.</div> : agentJobs.map(j => (
                                  <label key={j.id} className="flex items-center gap-2 text-sm text-gray-200 px-2 py-1 rounded-lg hover:bg-white/5">
                                    <input type="checkbox" checked={agentJobIds.includes(j.id)} onChange={(e) => setAgentJobIds(e.target.checked ? [...agentJobIds, j.id] : agentJobIds.filter(x => x !== j.id))} />
                                    <span className="truncate">{j.title}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                            <label className="flex items-center gap-2 text-sm text-gray-200"><input type="radio" name="agent-scope" checked={agentAllJobs} onChange={() => setAgentAllJobs(true)} /> All my jobs, including ones I create or join later</label>
                            {agentAllJobs && <p className="text-xs text-amber-400 mt-1 ml-6">Your browser keeps this key topped up with new jobs whenever you open the app.</p>}
                          </div>

                          <label className="flex items-start gap-2 text-sm text-white">
                            <input type="checkbox" className="mt-1" checked={agentAck} onChange={(e) => setAgentAck(e.target.checked)} />
                            <span>I understand that this gives the server (and anyone holding this key) access to the selected jobs&apos; data.</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </form>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-4 px-1">Active Keys</h3>
                    {keys.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 bg-black/20 rounded-2xl border border-white/5">
                        No API keys generated yet.
                      </div>
                    ) : (
                      keys.map((key, i) => (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          key={key.id}
                          className="flex items-center justify-between p-5 bg-black/20 hover:bg-black/40 border border-white/5 rounded-2xl transition-colors group"
                        >
                          <div>
                            <h4 className="font-medium text-white mb-1 group-hover:text-[#7c3bed] transition-colors">{key.name}</h4>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span>Generated on {new Date(key.created_at).toLocaleDateString()}</span>
                              {key.agent_access && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  Agent access: {key.agent_access === 'write' ? 'read + write' : 'read only'} · {key.agent_all_jobs ? 'all jobs' : 'selected jobs'}
                                </span>
                              )}
                            </div>
                            {key.agent_access && (
                              <button onClick={() => handleRemoveAgentAccess(key.id)} className="mt-2 text-xs text-gray-400 hover:text-amber-400 underline cursor-pointer">Remove agent access</button>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteKey(key.id)}
                            className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-colors cursor-pointer"
                            title="Revoke Key"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </motion.div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
