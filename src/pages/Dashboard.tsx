import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Plus, Briefcase, ChevronRight, Link as LinkIcon, Archive, Trash2, Search, Filter, Calendar, LogOut, Tag as TagIcon, BarChart3, Calculator, FileText, AlertTriangle } from 'lucide-react';
import { invoicesApi, type InvoiceRecord } from '../invoice/client';
import { attentionItems, jobBadge, type BadgeTone } from '../invoice/attention';
import { todayIso } from '../invoice/model';
import { formatCurrency } from '../invoice/format';
import { motion } from 'motion/react';
import { generateEncryptionKey, importEncryptionKey, wrapKey } from '../utils/crypto';
import CalendarView from '../components/CalendarView';
import ReportsWorkspace from '../components/ReportsWorkspace';
import TaxCenter from './TaxCenter';
import InvoiceWorkspace from '../components/invoice/InvoiceWorkspace';

type ViewMode = 'mine' | 'joined' | 'calendar' | 'reports' | 'invoices' | 'taxes' | 'archived';
const VIEW_MODES: ViewMode[] = ['mine', 'joined', 'calendar', 'reports', 'invoices', 'taxes', 'archived'];

interface Job {
  id: string;
  title: string;
  description: string;
  is_archived: number;
  created_by: string;
  created_at: string;
  mode: 'expense' | 'budget';
  start_date?: string | null;
  end_date?: string | null;
  total_expenses: number;
  total_income: number;
  updated_at: string;
  google_event_id?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  invoice_number?: string | null;
  invoice_tag?: string | null;
  invoice_seq?: number | null;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewModeState, setViewModeState] = useState<ViewMode>(
    (searchParams.get('view') as ViewMode) || 'mine'
  );

  const viewMode = viewModeState;

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    setSearchParams(prev => {
      prev.set('view', mode);
      prev.delete('job'); prev.delete('open'); // deep links into the invoice workspace only apply once
      return prev;
    }, { replace: true });
  };

  useEffect(() => {
    const view = searchParams.get('view') as ViewMode;
    if (view && VIEW_MODES.includes(view) && view !== viewModeState) {
      setViewModeState(view);
    }
  }, [searchParams]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'expense' | 'budget'>('expense');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [joinJobId, setJoinJobId] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'expense' | 'budget'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'activity'>('activity');
  const { token, user, masterKey, isVaultLocked } = useAuth();
  const [limitError, setLimitError] = useState<string | null>(null);
  const [limits, setLimits] = useState({ active: 2, joined: 4, archived: 6 });
  const [globalTags, setGlobalTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [invoiceTemplate, setInvoiceTemplate] = useState<{ default_prefix?: string } | null>(null);
  const [invoiceTag, setInvoiceTag] = useState('');
  const [previewInvoiceNumber, setPreviewInvoiceNumber] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/info')
      .then(res => res.json())
      .then(data => {
        if (data.limits) setLimits(data.limits);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchInvoiceTemplate = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/invoice-templates', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setInvoiceTemplate(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetch('/api/tags', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : [])
      .then(setGlobalTags)
      .catch(console.error);

    fetchInvoiceTemplate();
  }, [token]);

  const fetchPreviewInvoiceNumber = async (tag: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/jobs/next-invoice-number?tag=${encodeURIComponent(tag)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.invoiceNumber) {
          setPreviewInvoiceNumber(data.invoiceNumber);
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const defaultPrefix = (invoiceTemplate?.default_prefix || 'INV').toUpperCase();
    const prefix = tag ? tag.toUpperCase() : defaultPrefix;
    setPreviewInvoiceNumber(`${prefix}-A00001`);
  };

  useEffect(() => {
    if (isModalOpen) {
      fetchInvoiceTemplate();
      fetchPreviewInvoiceNumber(invoiceTag);
    }
  }, [isModalOpen, invoiceTag]);


  const fetchJobs = async () => {
    const res = await fetch('/api/jobs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setJobs(await res.json());
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user?.plan === 'free' && !user?.isAdmin && jobs.filter(j => !j.is_archived).length >= limits.active) {
      setLimitError(`You have reached the limit of ${limits.active} active jobs on the Free tier. Please upgrade or archive an existing job to create more.`);
      return;
    }
    if (isCreating) return;
    setIsCreating(true);
    
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          title, 
          description, 
          mode, 
          start_date: startDate ? startDate : null, 
          end_date: endDate ? endDate : null,
          invoice_tag: invoiceTag || null,
        }),
      });
      
      if (res.ok) {
        const newJob = await res.json();
        
        setJobs([newJob, ...jobs]);
        setIsModalOpen(false);
        setTitle('');
        setDescription('');
        setMode('expense');
        setStartDate('');
        setEndDate('');
        setInvoiceTag('');
        setPreviewInvoiceNumber('');
      }
    } catch (err) {
      console.error("Failed to create job", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isJoining) return;
    setIsJoining(true);
    setJoinError('');

    try {
      const res = await fetch('/api/jobs/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: joinJobId.trim() }),
      });

      if (res.ok) {
        const joinedJob = await res.json();
        if (joinedJob.pending) {
          // Invite accepted; the owner still has to approve you (this shares the job key with you).
          setJoinError('');
          alert('Invite accepted. The job owner now needs to approve you; tell them your security code (Settings → Security).');
          setIsJoinModalOpen(false);
          setJoinJobId('');
          return;
        }

        if (!jobs.find(j => j.id === joinedJob.id)) {
          setJobs([joinedJob, ...jobs]);
        }
        setIsJoinModalOpen(false);
        setJoinJobId('');
      } else {
        const data = await res.json();
        setJoinError(data.error || 'Failed to join job');
      }
    } catch (err) {
      setJoinError('An error occurred while joining the job.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleDeleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this job? All expenses and data associated with it will be permanently deleted.')) return;

    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setJobs(jobs.filter(j => j.id !== jobId));
    }
  };

  const handleLeaveJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to leave this job? You will lose access to it.')) return;

    const res = await fetch(`/api/jobs/${jobId}/leave`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setJobs(jobs.filter(j => j.id !== jobId));
    }
  };
  // Invoices and estimates (encrypted; decrypted here). Failures just mean no badges: the dashboard never depends on them.
  const [docs, setDocs] = useState<InvoiceRecord[]>([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    invoicesApi.list().then(r => { if (alive) setDocs(r); }).catch(() => {});
    return () => { alive = false; };
  }, [token, jobs.length]);
  const today = todayIso();
  const docsByJob = React.useMemo(() => {
    const m = new Map<string, InvoiceRecord[]>();
    for (const d of docs) { if (!m.has(d.job_id)) m.set(d.job_id, []); m.get(d.job_id)!.push(d); }
    return m;
  }, [docs]);
  const attention = React.useMemo(() => attentionItems(docs, Object.fromEntries(jobs.map(j => [j.id, j.title])), today), [docs, jobs, today]);
  const BADGE_TONE: Record<BadgeTone, string> = {
    gray: 'text-slate-300 bg-slate-500/10 border-slate-500/20', blue: 'text-sky-300 bg-sky-500/10 border-sky-500/20', green: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20', red: 'text-red-300 bg-red-500/10 border-red-500/20',
  };

  const myJobs = jobs.filter(j => j.created_by === user?.id && !j.is_archived);
  const joinedJobs = jobs.filter(j => j.created_by !== user?.id && !j.is_archived);
  const archivedJobs = jobs.filter(j => j.is_archived);
  
  const filteredJobs = jobs.filter(j => {
    if (viewMode === 'mine' && (j.created_by !== user?.id || j.is_archived)) return false;
    if (viewMode === 'joined' && (j.created_by === user?.id || j.is_archived)) return false;
    if (viewMode === 'archived' && !j.is_archived) return false;
    
    if (modeFilter !== 'all' && j.mode !== modeFilter) return false;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      const matchTitle = j.title.toLowerCase().includes(query);
      const matchDesc = j.description?.toLowerCase().includes(query) || false;
      const matchInvoice = j.invoice_number?.toLowerCase().includes(query) || false;
      const matchId = j.id?.toLowerCase().includes(query) || false;
      const matchClient = j.client_name?.toLowerCase().includes(query) || false;
      const matchClientEmail = j.client_email?.toLowerCase().includes(query) || false;
      const matchTag = j.invoice_tag?.toLowerCase().includes(query) || false;
      if (!matchTitle && !matchDesc && !matchInvoice && !matchId && !matchClient && !matchClientEmail && !matchTag) return false;
    }
    
    return true;
  });

  const displayedJobs = filteredJobs.sort((a, b) => {
    if (sortOrder === 'newest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortOrder === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (sortOrder === 'activity') {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA;
    }
    return 0;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Jobs</h1>
          <p className="text-gray-400 mt-1">Manage your expense tracking projects</p>
          {user?.plan === 'free' && !user?.isAdmin && (
            <div className="mt-3 text-xs text-amber-500 bg-amber-500/10 px-3 py-1.5 rounded-lg inline-flex flex-wrap items-center gap-2 border border-amber-500/20">
              <span className="font-bold uppercase tracking-wider">{user.plan} Tier</span>
              <span className="opacity-70">•</span>
              <span className={`${myJobs.length >= limits.active ? 'text-red-400 font-bold' : ''}`}>{myJobs.length}/{limits.active} Active Jobs</span>
              <span className="opacity-70">•</span>
              <span>{joinedJobs.length}/{limits.joined} Joined Jobs</span>
              <span className="opacity-70">•</span>
              <span>{archivedJobs.length}/{limits.archived} Archived Jobs</span>
              <Link to="/pricing" className="ml-2 font-bold underline hover:text-amber-400">Upgrade</Link>
            </div>
          )}
        </div>
        <div className="flex flex-col xs:flex-row items-center gap-3">
          <button
            onClick={() => setIsJoinModalOpen(true)}
            className="w-full xs:w-auto bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 text-white px-4 py-2.5 rounded-xl font-medium flex items-center justify-center space-x-2 transition-all backdrop-blur-md"
          >
            <LinkIcon className="w-4 h-4" />
            <span>Join Job</span>
          </button>
          <button
            onClick={() => {
              if (user?.plan === 'free' && !user?.isAdmin && myJobs.length >= limits.active) {
                setLimitError(`You have reached the limit of ${limits.active} active jobs on the Free tier. Please upgrade or archive an existing job to create more.`);
              }
              setIsModalOpen(true);
            }}
            className="w-full xs:w-auto bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-5 py-2.5 rounded-xl font-medium flex items-center justify-center space-x-2 transition-all shadow-lg shadow-[#7c3bed]/20"
          >
            <Plus className="w-5 h-5" />
            <span>New Job</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4 z-10 relative">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setViewMode('mine')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'mine' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            My Jobs ({myJobs.length})
          </button>
          <button
            onClick={() => setViewMode('joined')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'joined' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            Joined Jobs ({joinedJobs.length})
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'calendar' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            Calendar
          </button>
          <button
            onClick={() => setViewMode('reports')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${viewMode === 'reports' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <BarChart3 className="w-4 h-4" />
            Reports
          </button>
          <button
            onClick={() => setViewMode('invoices')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${viewMode === 'invoices' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <FileText className="w-4 h-4" />
            Invoices{attention.length > 0 && <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300" title="Documents waiting for you">{attention.length}</span>}
          </button>
          <button
            onClick={() => setViewMode('taxes')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${viewMode === 'taxes' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <Calculator className="w-4 h-4" />
            Taxes
          </button>
          <button
            onClick={() => setViewMode('archived')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${viewMode === 'archived' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
          >
            <Archive className="w-4 h-4" />
            Archived ({archivedJobs.length})
          </button>
        </div>
        
        {viewMode !== 'reports' && viewMode !== 'taxes' && viewMode !== 'invoices' && (
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input 
                type="text"
                placeholder="Search jobs (title, client, invoice #)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1c172d]/60 border border-white/5 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#7c3bed]/50 transition-all backdrop-blur-md"
              />
            </div>
            <div className="relative group">
              <button className="bg-[#1c172d]/60 border border-white/5 hover:border-white/10 rounded-xl p-2.5 text-gray-400 hover:text-white transition-all backdrop-blur-md flex items-center justify-center">
                <Filter className="w-4 h-4" />
              </button>
              <div className="absolute right-0 top-full mt-2 w-48 bg-[#1c172d] border border-white/10 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 overflow-hidden">
                <div className="p-2 border-b border-white/5">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2 py-1">Type</div>
                  <button onClick={() => setModeFilter('all')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${modeFilter === 'all' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>All Jobs</button>
                  <button onClick={() => setModeFilter('expense')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${modeFilter === 'expense' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>Expenses Only</button>
                  <button onClick={() => setModeFilter('budget')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${modeFilter === 'budget' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>Budgets Only</button>
                </div>
                <div className="p-2">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2 py-1">Sort By</div>
                  <button onClick={() => setSortOrder('activity')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${sortOrder === 'activity' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>Recent Activity</button>
                  <button onClick={() => setSortOrder('newest')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${sortOrder === 'newest' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>Newest Added</button>
                  <button onClick={() => setSortOrder('oldest')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${sortOrder === 'oldest' ? 'bg-[#7c3bed]/20 text-[#7c3bed]' : 'text-gray-300 hover:bg-white/5'}`}>Oldest Added</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {attention.length > 0 && (viewMode === 'mine' || viewMode === 'invoices') && (
        <section aria-label="Needs attention" className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200 mb-2"><AlertTriangle className="w-4 h-4" />Needs your attention ({attention.length})</h2>
          <ul className="divide-y divide-white/5">
            {attention.slice(0, 6).map(a => (
              <li key={a.id}>
                <Link to={`/dashboard?view=invoices&open=${a.recordId}`} className="flex items-center justify-between gap-3 py-2 group">
                  <span className="min-w-0 text-sm">
                    <span className={`mr-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${a.kind === 'overdue' ? 'bg-red-500/15 text-red-300' : a.kind === 'agent-final' ? 'bg-violet-500/15 text-violet-300' : 'bg-sky-500/15 text-sky-300'}`}>{a.kind === 'overdue' ? 'Overdue' : a.kind === 'agent-final' ? 'Agent finalized' : 'Review estimate'}</span>
                    <span className="text-white font-medium">{a.title}</span>
                    <span className="block text-xs text-gray-400 truncate">{a.detail}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          {attention.length > 6 && <p className="text-xs text-gray-500 mt-2">and {attention.length - 6} more. Open a job’s invoice chip to see the rest.</p>}
        </section>
      )}

      {viewMode === 'reports' ? (
        <ReportsWorkspace jobs={jobs} tags={globalTags} />
      ) : viewMode === 'invoices' ? (
        <React.Fragment key={`${searchParams.get('job') ?? ''}|${searchParams.get('open') ?? ''}`}>
          <InvoiceWorkspace jobId={searchParams.get('job')} openId={searchParams.get('open')} />
        </React.Fragment>
      ) : viewMode === 'taxes' ? (
        <TaxCenter />
      ) : viewMode === 'calendar' ? (
        <CalendarView 
          jobs={jobs.filter(j => !j.is_archived)} 
          onDateClick={(date) => {
            setStartDate(date);
            setEndDate(date);
            setIsModalOpen(true);
          }}
        />
      ) : displayedJobs.length === 0 ? (
        <div className="bg-[#1c172d]/40 border border-white/5 rounded-3xl p-12 text-center backdrop-blur-sm">
          <div className="w-16 h-16 mx-auto bg-white/5 rounded-2xl flex items-center justify-center mb-4">
            <Briefcase className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-xl font-medium text-white mb-2">
            {viewMode === 'archived' ? 'No archived jobs' : 'No active jobs yet'}
          </h3>
          <p className="text-gray-400 max-w-sm mx-auto">
            {viewMode === 'archived' 
              ? 'Archived jobs will appear here.' 
              : 'Create your first job or join an existing one to start tracking expenses.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayedJobs.map((job, index) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={job.id}
              className="h-full"
            >
              <Link
                to={`/jobs/${job.id}`}
                className="flex flex-col h-full group bg-[#1c172d]/60 hover:bg-[#1c172d]/80 border border-white/5 hover:border-[#7c3bed]/30 rounded-2xl p-6 transition-all backdrop-blur-md"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center group-hover:bg-[#7c3bed]/20 group-hover:text-[#7c3bed] transition-colors">
                    <Briefcase className="w-6 h-6 text-gray-400 group-hover:text-[#7c3bed]" />
                  </div>
                  <div className="flex items-center gap-2">
                    {job.mode === 'budget' ? (
                      <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-emerald-500/20">
                        Budget
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-blue-500/20">
                        Expense
                      </span>
                    )}
                    {job.google_event_id && (
                      <div className="p-1.5 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20" title="Synced to Google Calendar">
                        <Calendar className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {job.created_by === user?.id ? (
                      <button
                        onClick={(e) => handleDeleteJob(e, job.id)}
                        className="p-2 text-gray-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"
                        title="Delete Job"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleLeaveJob(e, job.id)}
                        className="p-2 text-gray-500 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors"
                        title="Leave Job"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    )}
                    <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors" />
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">{job.title}</h3>
                  {job.invoice_number && (
                    <span className="text-[11px] font-mono font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md" title="Invoice Number">
                      {job.invoice_number}
                    </span>
                  )}
                  {(() => {
                    const badge = jobBadge(docsByJob.get(job.id) ?? [], today);
                    return badge ? (
                      <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded-md inline-flex items-center gap-1 ${BADGE_TONE[badge.tone]}`} title={`${badge.count > 1 ? `${badge.count} documents; latest: ` : ''}${badge.label}`}>
                        <FileText className="w-3 h-3" />{badge.label}<span className="font-mono opacity-80">{formatCurrency(badge.total)}</span>
                      </span>
                    ) : null;
                  })()}
                  {job.invoice_tag && (
                    <span className="text-[11px] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md flex items-center gap-1" title={`Job Category / Tag: ${job.invoice_tag}`}>
                      <TagIcon className="w-3 h-3 text-purple-400" />
                      {job.invoice_tag}
                    </span>
                  )}
                </div>
                {job.client_name && (
                  <p className="text-xs text-gray-400 mb-2 truncate">
                    <span className="text-gray-500">Client:</span> {job.client_name}
                  </p>
                )}
                <p className="text-sm text-gray-400 line-clamp-2 mb-4">{job.description || 'No description'}</p>
                <div className="flex justify-between items-end mt-auto pt-4">
                  <div className="text-xs text-gray-500 font-mono">
                    {new Date(job.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    {job.mode === 'expense' ? (
                      <div className="text-lg font-bold text-white">
                        ${(job.total_expenses || 0).toFixed(2)}
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-end gap-2 text-emerald-400">
                          <span className="text-sm font-medium uppercase tracking-wider">Income</span>
                          <span className="text-lg font-bold text-white">${(job.total_income || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-end gap-2 text-red-400">
                          <span className="text-sm font-medium uppercase tracking-wider">Expenses</span>
                          <span className="text-lg font-bold text-white">${(job.total_expenses || 0).toFixed(2)}</span>
                        </div>
                        <div className="border-t border-white/10 pt-1 mt-0.5 flex items-center justify-end gap-2 text-white">
                          <span className="text-sm font-bold uppercase tracking-wider">Net</span>
                          <span className="text-lg font-bold text-white">${((job.total_income || 0) - (job.total_expenses || 0)).toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1c172d] border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl"
          >
            <h2 className="text-2xl font-bold mb-6">Create New Job</h2>
            {limitError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex flex-col gap-3">
                <p>{limitError}</p>
                <Link to="/pricing" className="bg-red-500 text-white px-4 py-2 rounded-xl text-center font-bold hover:bg-red-600 transition-colors">
                  View Pricing & Upgrade
                </Link>
              </div>
            )}
            <form onSubmit={handleCreateJob} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Job Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                  placeholder="e.g. Office Renovation"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Description (Optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 min-h-[100px] resize-none"
                  placeholder="Brief description of the job..."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">Invoice Tag / Category (Optional)</label>
                  {previewInvoiceNumber && (
                    <span className="text-xs font-mono font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 rounded-lg flex items-center gap-1.5" title="Auto-generated sequential Invoice ID">
                      Invoice #: {previewInvoiceNumber}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <select
                    value={invoiceTag}
                    onChange={(e) => {
                      setInvoiceTag(e.target.value);
                      fetchPreviewInvoiceNumber(e.target.value);
                    }}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 appearance-none text-sm cursor-pointer"
                  >
                    <option value="">[Default] ({invoiceTemplate?.default_prefix || 'INV'})</option>
                    {globalTags.map(t => (
                      <option key={t.id} value={t.name}>{t.name.toUpperCase()}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
                    ▼
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-gray-400">
                  Assign a tag to encompass this job and automatically prefix its sequential invoice ID.
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Start Date (Optional)</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">End Date (Optional)</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">Project Mode</label>
                <div className="flex bg-black/20 p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setMode('expense')}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${mode === 'expense' ? 'bg-[#1c172d] text-white shadow-md border border-white/5' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Expense Tracker
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('budget')}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${mode === 'budget' ? 'bg-[#1c172d] text-white shadow-md border border-white/5' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Budget Tracker
                  </button>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  {mode === 'budget' ? 'Track both income (+) and expenses (-) to monitor net cash flow.' : 'Traditional mode. Track out-of-pocket costs and expenses.'}
                </p>
              </div>
              <div className="flex justify-end space-x-3 mt-8">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setLimitError(null); setInvoiceTag(''); setPreviewInvoiceNumber(''); }}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-[#7c3bed]/20 disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create Job'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {isJoinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1c172d] border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl"
          >
            <h2 className="text-2xl font-bold mb-6">Join Existing Job</h2>
            {joinError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {joinError}
              </div>
            )}
            <form onSubmit={handleJoinJob} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Invite code</label>
                <input
                  type="text"
                  value={joinJobId}
                  onChange={(e) => setJoinJobId(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 font-mono text-sm"
                  placeholder="Paste the invite code (gi_…) here"
                  required
                />
              </div>
              <div className="flex justify-end space-x-3 mt-8">
                <button
                  type="button"
                  onClick={() => {
                    setIsJoinModalOpen(false);
                    setJoinError('');
                  }}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isJoining}
                  className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-[#7c3bed]/20 disabled:opacity-50"
                >
                  {isJoining ? 'Joining...' : 'Join Job'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
