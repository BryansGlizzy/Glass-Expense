import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileSpreadsheet,
  Receipt,
  Briefcase,
  Download,
  Printer,
  Search,
  Eye,
  ArrowUpDown,
  ExternalLink,
  Shield,
  Tag as TagIcon,
  Layers,
  BarChart3,
  CheckCircle,
  AlertCircle,
  X,
  Maximize2,
  Award,
  AlertTriangle,
  Activity,
  FileText,
  Sliders,
  Check
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
  ComposedChart,
  Line
} from 'recharts';
import ReportWizard, { ReportFilters } from './ReportWizard';
import { importEncryptionKey, unwrapKey, decryptFile } from '../utils/crypto';

interface ReportsWorkspaceProps {
  jobs: any[];
  tags: Array<{ id: string; name: string; color: string }>;
}

export default function ReportsWorkspace({ jobs, tags }: ReportsWorkspaceProps) {
  const { token, masterKey, isVaultLocked } = useAuth();

  const [filters, setFilters] = useState<ReportFilters>({
    jobIds: [],
    tagIds: [],
    jobTags: [],
    datePreset: 'all',
    startDate: '',
    endDate: '',
    entryType: 'all',
    includeArchived: false,
    minAmount: '',
    maxAmount: '',
    hasReceiptOnly: false
  });

  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'analytics' | 'transactions' | 'receipts' | 'jobs'>('analytics');
  const [analyticsGraphType, setAnalyticsGraphType] = useState<'bars' | 'timeline' | 'whisker' | 'categories'>('bars');

  // Company / Invoice Template for Print Preview
  const [template, setTemplate] = useState<{
    company_name?: string;
    company_address?: string;
    company_logo_url?: string;
    default_hourly_rate?: number;
  } | null>(null);

  // Print Preview Modal State
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Search & Sorting for transaction data table
  const [tableSearch, setTableSearch] = useState('');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'job_title' | 'description'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Decryption cache: jobId -> rawKeyBase64
  const [unwrappedJobKeys, setUnwrappedJobKeys] = useState<Record<string, string>>({});
  // Decrypted thumbnails cache: expenseId -> objectUrl
  const [decryptedUrls, setDecryptedUrls] = useState<Record<string, string>>({});
  const [decryptingExpenseIds, setDecryptingExpenseIds] = useState<Record<string, boolean>>({});

  // Fullscreen receipt modal state
  const [previewReceipt, setPreviewReceipt] = useState<{
    url: string;
    title: string;
    amount: number;
    date: string;
    description: string;
    invoiceNumber?: string;
  } | null>(null);

  // Fetch report data from backend
  const fetchReport = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/reports/custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jobIds: filters.jobIds,
          tagIds: filters.tagIds,
          jobTags: filters.jobTags,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          entryType: filters.entryType,
          includeArchived: filters.includeArchived,
          minAmount: filters.minAmount ? parseFloat(filters.minAmount) : undefined,
          maxAmount: filters.maxAmount ? parseFloat(filters.maxAmount) : undefined,
          hasReceiptOnly: filters.hasReceiptOnly
        })
      });

      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch (err) {
      console.error('Failed to generate report', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    if (token) {
      fetch('/api/invoice-templates', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then(setTemplate)
        .catch(() => {});
    }
  }, []);

  // Background E2EE Job Key Unwrapping
  useEffect(() => {
    if (!reportData?.jobKeys || !masterKey || isVaultLocked) return;

    const unwrapKeys = async () => {
      try {
        const mkCrypto = await importEncryptionKey(masterKey);
        const resolved: Record<string, string> = { ...unwrappedJobKeys };

        for (const [jobId, encryptedKey] of Object.entries(reportData.jobKeys as Record<string, string>)) {
          if (!resolved[jobId] && encryptedKey) {
            try {
              const rawKey = await unwrapKey(encryptedKey, mkCrypto);
              resolved[jobId] = rawKey;
            } catch (e) {
              console.warn(`Could not unwrap key for job ${jobId}`, e);
            }
          }
        }
        setUnwrappedJobKeys(resolved);
      } catch (err) {
        console.error('Failed to prepare master key for unwrapping', err);
      }
    };

    unwrapKeys();
  }, [reportData?.jobKeys, masterKey, isVaultLocked]);

  // Helper to decrypt receipt blob
  const decryptExpenseReceipt = async (expense: any): Promise<string | null> => {
    if (!expense.receipt_url) return null;
    if (!expense.is_encrypted) return expense.receipt_url;
    if (decryptedUrls[expense.id]) return decryptedUrls[expense.id];

    let key = unwrappedJobKeys[expense.job_id];
    if (!key) {
      const local = localStorage.getItem(`job_key_${expense.job_id}`);
      if (local) key = local;
    }

    if (!key) {
      const userInput = prompt(`Vault is locked or key not found. Please enter project encryption key for ${expense.job_title}:`);
      if (!userInput) return null;
      key = userInput.trim();
    }

    setDecryptingExpenseIds((prev) => ({ ...prev, [expense.id]: true }));
    try {
      const res = await fetch(expense.receipt_url);
      const encryptedBlob = await res.blob();
      const decryptedBlob = await decryptFile(encryptedBlob, key, 'image/jpeg');
      const objUrl = URL.createObjectURL(decryptedBlob);
      setDecryptedUrls((prev) => ({ ...prev, [expense.id]: objUrl }));
      return objUrl;
    } catch (e) {
      console.error('Decryption failed for receipt', e);
      alert('Failed to decrypt receipt. The key may be incorrect.');
      return null;
    } finally {
      setDecryptingExpenseIds((prev) => ({ ...prev, [expense.id]: false }));
    }
  };

  // Auto-decrypt top 12 thumbnails in gallery if vault unlocked
  useEffect(() => {
    if (!reportData?.transactions || !masterKey || isVaultLocked) return;

    const autoDecrypt = async () => {
      const receiptsToDecrypt = reportData.transactions.filter(
        (t: any) => t.receipt_url && t.is_encrypted && !decryptedUrls[t.id] && unwrappedJobKeys[t.job_id]
      );

      const slice = receiptsToDecrypt.slice(0, 12);
      for (const t of slice) {
        decryptExpenseReceipt(t);
      }
    };

    autoDecrypt();
  }, [reportData?.transactions, unwrappedJobKeys, isVaultLocked]);

  // Highlight Jobs: Most Profitable vs Highest Debt / Exposure
  const { topProfitJob, topDebtJob } = useMemo(() => {
    if (!reportData?.jobBreakdown?.length) return { topProfitJob: null, topDebtJob: null };

    const sortedByNet = [...reportData.jobBreakdown].sort((a, b) => b.net - a.net);
    const mostProfitable = sortedByNet[0]?.net > 0 ? sortedByNet[0] : null;

    // Highest debt / deficit job (most negative net, or job with highest expenses)
    const sortedByLoss = [...reportData.jobBreakdown].sort((a, b) => a.net - b.net);
    let highestDebt = sortedByLoss[0]?.net < 0 ? sortedByLoss[0] : null;

    // If no job has negative net, highlight the job with the highest expenses
    if (!highestDebt) {
      const sortedByExpense = [...reportData.jobBreakdown].sort((a, b) => b.expense - a.expense);
      if (sortedByExpense[0]?.expense > 0) {
        highestDebt = sortedByExpense[0];
      }
    }

    return { topProfitJob: mostProfitable, topDebtJob: highestDebt };
  }, [reportData?.jobBreakdown]);

  // Periodic Bar Chart Data: Income vs Expense Buckets (Daily/Weekly/Monthly)
  const periodicBarData = useMemo(() => {
    if (!reportData?.transactions?.length) return [];

    const sorted = [...reportData.transactions].sort(
      (a, b) => new Date(a.date || a.created_at).getTime() - new Date(b.date || b.created_at).getTime()
    );

    // Grouping strategy based on duration
    const firstDate = new Date(sorted[0].date || sorted[0].created_at);
    const lastDate = new Date(sorted[sorted.length - 1].date || sorted[sorted.length - 1].created_at);
    const diffDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));

    const bucketMap = new Map<string, { label: string; income: number; expense: number; net: number; count: number }>();

    sorted.forEach((t) => {
      const d = new Date((t.date || t.created_at).replace(' ', 'T'));
      let key = '';
      let label = '';

      if (diffDays <= 31) {
        // Daily
        key = (t.date || t.created_at).split(' ')[0];
        label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } else if (diffDays <= 120) {
        // Weekly (Sunday key)
        const dayOfWeek = d.getDay();
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - dayOfWeek);
        key = startOfWeek.toISOString().split('T')[0];
        label = `Wk ${startOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      } else {
        // Monthly
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        label = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      }

      const existing = bucketMap.get(key) || { label, income: 0, expense: 0, net: 0, count: 0 };
      const amt = Number(t.amount) || 0;
      if (t.entry_type === 'income') {
        existing.income += amt;
      } else {
        existing.expense += amt;
      }
      existing.net = existing.income - existing.expense;
      existing.count++;
      bucketMap.set(key, existing);
    });

    return Array.from(bucketMap.values());
  }, [reportData?.transactions]);

  // Box & Whisker ("Cat Whisker") Range Distribution Data
  const whiskerData = useMemo(() => {
    if (!reportData?.transactions?.length) return [];

    // Group transaction amounts by category
    const catAmounts = new Map<string, { name: string; color: string; amounts: number[] }>();

    reportData.transactions.forEach((t: any) => {
      const amt = Number(t.amount) || 0;
      if (t.tags && t.tags.length > 0) {
        t.tags.forEach((tag: any) => {
          const entry = catAmounts.get(tag.id) || { name: tag.name, color: tag.color, amounts: [] };
          entry.amounts.push(amt);
          catAmounts.set(tag.id, entry);
        });
      } else {
        const untaggedId = 'untagged';
        const entry = catAmounts.get(untaggedId) || { name: 'Untagged', color: '#6b7280', amounts: [] };
        entry.amounts.push(amt);
        catAmounts.set(untaggedId, entry);
      }
    });

    const result = Array.from(catAmounts.values())
      .filter((c) => c.amounts.length > 0)
      .map((c) => {
        const sorted = [...c.amounts].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;

        // Quartiles
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const median = sorted[Math.floor(sorted.length * 0.5)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];

        return {
          name: c.name,
          color: c.color,
          min,
          q1,
          median,
          q3,
          max,
          mean,
          count: sorted.length
        };
      })
      .sort((a, b) => b.max - a.max);

    return result;
  }, [reportData?.transactions]);

  // Cash flow timeline data for Recharts Area
  const timelineData = useMemo(() => {
    if (!reportData?.transactions?.length) return [];
    const sorted = [...reportData.transactions].sort(
      (a, b) => new Date(a.date || a.created_at).getTime() - new Date(b.date || b.created_at).getTime()
    );

    let cumulative = 0;
    const points = [{ date: 'Start', balance: 0, income: 0, expense: 0 }];

    sorted.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (t.entry_type === 'income') {
        cumulative += amt;
        points.push({
          date: new Date((t.date || t.created_at).replace(' ', 'T')).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
          }),
          balance: cumulative,
          income: amt,
          expense: 0
        });
      } else {
        cumulative -= amt;
        points.push({
          date: new Date((t.date || t.created_at).replace(' ', 'T')).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
          }),
          balance: cumulative,
          income: 0,
          expense: amt
        });
      }
    });

    return points;
  }, [reportData?.transactions]);

  // Filtered & Sorted Transactions for Table
  const processedTransactions = useMemo(() => {
    if (!reportData?.transactions) return [];
    let list = [...reportData.transactions];

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.description?.toLowerCase().includes(q) ||
          t.job_title?.toLowerCase().includes(q) ||
          t.invoice_number?.toLowerCase().includes(q) ||
          t.tags?.some((tag: any) => tag.name.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        const dateA = new Date(a.date || a.created_at).getTime();
        const dateB = new Date(b.date || b.created_at).getTime();
        comparison = dateA - dateB;
      } else if (sortField === 'amount') {
        comparison = Number(a.amount) - Number(b.amount);
      } else if (sortField === 'job_title') {
        comparison = (a.job_title || '').localeCompare(b.job_title || '');
      } else if (sortField === 'description') {
        comparison = (a.description || '').localeCompare(b.description || '');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [reportData?.transactions, tableSearch, sortField, sortOrder]);

  // CSV Export Engine
  const handleExportCSV = () => {
    if (!reportData?.transactions?.length) {
      alert('No transactions available to export.');
      return;
    }

    const headers = [
      'Transaction Date',
      'Job Title',
      'Invoice Number',
      'Job Tag',
      'Client',
      'Entry Type',
      'Category / Tags',
      'Description',
      'Amount',
      'Receipt Attached',
      'Receipt URL',
      'Transaction ID'
    ];

    const rows = reportData.transactions.map((t: any) => [
      `"${(t.date || t.created_at).split(' ')[0]}"`,
      `"${(t.job_title || '').replace(/"/g, '""')}"`,
      `"${(t.invoice_number || '').replace(/"/g, '""')}"`,
      `"${(t.invoice_tag || '').replace(/"/g, '""')}"`,
      `"${(t.client_name || '').replace(/"/g, '""')}"`,
      `"${t.entry_type || 'expense'}"`,
      `"${(t.tags?.map((tg: any) => tg.name).join(', ') || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      Number(t.amount || 0).toFixed(2),
      t.receipt_url ? 'Yes' : 'No',
      `"${t.receipt_url || ''}"`,
      `"${t.id}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r: string[]) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `GlassExpense_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = reportData?.summary || {
    totalIncome: 0,
    totalExpense: 0,
    net: 0,
    transactionCount: 0,
    receiptCount: 0,
    jobCount: 0
  };

  return (
    <div className="space-y-6">
      {/* Wizard Filter Controller */}
      <ReportWizard
        jobs={jobs}
        tags={tags}
        filters={filters}
        onChangeFilters={setFilters}
        onGenerate={fetchReport}
        isLoading={isLoading}
      />

      {/* Report Action Header & View Selector */}
      <div className="bg-[#1c172d]/70 border border-white/5 rounded-3xl p-4 sm:p-6 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'analytics', label: 'Executive Summary', icon: BarChart3 },
              { id: 'transactions', label: `Transactions (${summary.transactionCount})`, icon: FileSpreadsheet },
              { id: 'receipts', label: `Receipts Gallery (${summary.receiptCount})`, icon: Receipt },
              { id: 'jobs', label: `Jobs Matrix (${summary.jobCount})`, icon: Briefcase }
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#7c3bed] text-white shadow-lg shadow-[#7c3bed]/30 font-semibold'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-all cursor-pointer"
            title="Download CSV Spreadsheet"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowPrintModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-all cursor-pointer"
            title="Open Print Preview & PDF Layout"
          >
            <Printer className="w-4 h-4" />
            <span>Print Preview</span>
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total Income */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block mb-1">
            Total Income
          </span>
          <div className="text-xl sm:text-2xl font-bold text-white flex items-center gap-1">
            <span>${summary.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Total Expenses */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-rose-400 uppercase tracking-wider block mb-1">
            Total Expenses
          </span>
          <div className="text-xl sm:text-2xl font-bold text-white flex items-center gap-1">
            <span>${summary.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Net Cash Flow */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-purple-400 uppercase tracking-wider block mb-1">
            Net Cash Flow
          </span>
          <div
            className={`text-xl sm:text-2xl font-bold flex items-center gap-1 ${
              summary.net >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            <span>{summary.net >= 0 ? '+' : '-'}${Math.abs(summary.net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Transactions */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider block mb-1">
            Transactions
          </span>
          <div className="text-xl sm:text-2xl font-bold text-white">{summary.transactionCount}</div>
        </div>

        {/* Attached Receipts */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wider block mb-1">
            Receipts Attached
          </span>
          <div className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <span>{summary.receiptCount}</span>
            {summary.transactionCount > 0 && (
              <span className="text-xs text-gray-500 font-normal">
                ({Math.round((summary.receiptCount / summary.transactionCount) * 100)}%)
              </span>
            )}
          </div>
        </div>

        {/* Jobs Filtered */}
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md">
          <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider block mb-1">
            Jobs Spanned
          </span>
          <div className="text-xl sm:text-2xl font-bold text-white">{summary.jobCount}</div>
        </div>
      </div>

      {/* HIGHLIGHT CARDS: TOP PROFIT & HIGHEST DEBT / COST JOBS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Most Profitable Job Card */}
        {topProfitJob ? (
          <div className="bg-gradient-to-br from-emerald-500/10 via-[#1c172d]/80 to-[#1c172d]/60 border border-emerald-500/20 rounded-3xl p-5 backdrop-blur-md relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Top Profit Driver
                    </span>
                    {topProfitJob.invoice_number && (
                      <span className="text-[11px] font-mono text-gray-400">{topProfitJob.invoice_number}</span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-white mt-1 truncate" title={topProfitJob.title}>
                    {topProfitJob.title}
                  </h4>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold text-emerald-400">
                  +${Number(topProfitJob.net).toFixed(2)}
                </div>
                <div className="text-[10px] text-gray-400">Net Profit</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 text-xs">
              <div>
                <span className="text-[10px] text-gray-400 block">Income</span>
                <span className="font-semibold text-emerald-400">${Number(topProfitJob.income).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Expenses</span>
                <span className="font-semibold text-rose-400">${Number(topProfitJob.expense).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Margin</span>
                <span className="font-semibold text-white">
                  {topProfitJob.income > 0
                    ? `${Math.round((topProfitJob.net / topProfitJob.income) * 100)}%`
                    : '100%'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#1c172d]/40 border border-white/5 rounded-3xl p-5 backdrop-blur-md flex items-center justify-center text-xs text-gray-500">
            No profitable jobs in this scope
          </div>
        )}

        {/* Highest Debt / Cost Burden Job Card */}
        {topDebtJob ? (
          <div className="bg-gradient-to-br from-rose-500/10 via-[#1c172d]/80 to-[#1c172d]/60 border border-rose-500/20 rounded-3xl p-5 backdrop-blur-md relative overflow-hidden flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                      {topDebtJob.net < 0 ? 'Highest Deficit' : 'Largest Cost Center'}
                    </span>
                    {topDebtJob.invoice_number && (
                      <span className="text-[11px] font-mono text-gray-400">{topDebtJob.invoice_number}</span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-white mt-1 truncate" title={topDebtJob.title}>
                    {topDebtJob.title}
                  </h4>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-extrabold ${topDebtJob.net < 0 ? 'text-rose-400' : 'text-amber-400'}`}>
                  {topDebtJob.net < 0 ? `-$${Math.abs(topDebtJob.net).toFixed(2)}` : `$${topDebtJob.expense.toFixed(2)}`}
                </div>
                <div className="text-[10px] text-gray-400">
                  {topDebtJob.net < 0 ? 'Net Deficit' : 'Total Spent'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 text-xs">
              <div>
                <span className="text-[10px] text-gray-400 block">Total Expenses</span>
                <span className="font-semibold text-rose-400">${Number(topDebtJob.expense).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Income</span>
                <span className="font-semibold text-emerald-400">${Number(topDebtJob.income).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 block">Transactions</span>
                <span className="font-semibold text-white">{topDebtJob.transactionCount} entries</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#1c172d]/40 border border-white/5 rounded-3xl p-5 backdrop-blur-md flex items-center justify-center text-xs text-gray-500">
            No expense records in this scope
          </div>
        )}
      </div>

      {/* VIEW 1: EXECUTIVE ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Graph Type Switcher Controls */}
          <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-4 backdrop-blur-md flex items-center justify-between flex-wrap gap-3">
            <span className="text-xs font-semibold text-gray-300 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              Visual Graph Views:
            </span>

            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'bars', label: 'Income vs Expenses Bars' },
                { id: 'timeline', label: 'Cash Flow Trend' },
                { id: 'whisker', label: 'Cat Whisker (Range Variance)' },
                { id: 'categories', label: 'Category Spending' }
              ].map((g) => (
                <button
                  key={g.id}
                  onClick={() => setAnalyticsGraphType(g.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    analyticsGraphType === g.id
                      ? 'bg-[#7c3bed] text-white shadow-md shadow-[#7c3bed]/25 font-semibold'
                      : 'bg-black/20 hover:bg-black/40 text-gray-400 hover:text-white border border-white/5'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* GRAPH VIEW A: Periodic Income vs Expenses Grouped Bar Chart */}
          {analyticsGraphType === 'bars' && (
            <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    Income vs Expenses Over Date Range
                  </h3>
                  <p className="text-xs text-gray-400">
                    Side-by-side periodic cashflow comparison across active filter timeline
                  </p>
                </div>
              </div>

              {periodicBarData.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-xs text-gray-500">
                  No transaction data to display
                </div>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={periodicBarData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                      <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c172d',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          color: '#fff'
                        }}
                        formatter={(val: any) => [`$${Number(val).toFixed(2)}`]}
                      />
                      <Legend wrapperStyle={{ paddingTop: 10 }} />
                      <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" name="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* GRAPH VIEW B: Box & Whisker ("Cat Whisker") Range Distribution Chart */}
          {analyticsGraphType === 'whisker' && (
            <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  Cat Whisker Transaction Variance Chart
                </h3>
                <p className="text-xs text-gray-400">
                  Box &amp; Whisker distribution showing transaction Min, 25% (Q1), Median, 75% (Q3), and Max spread per category
                </p>
              </div>

              {whiskerData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-gray-500">
                  No category distributions available
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {whiskerData.slice(0, 10).map((item) => {
                    // Global max across all categories to ground the scale
                    const globalMax = Math.max(...whiskerData.map((w) => w.max), 1);
                    const leftPct = (item.min / globalMax) * 100;
                    const rightPct = (item.max / globalMax) * 100;
                    const q1Pct = (item.q1 / globalMax) * 100;
                    const q3Pct = (item.q3 / globalMax) * 100;
                    const medPct = (item.median / globalMax) * 100;

                    return (
                      <div
                        key={item.name}
                        className="bg-black/20 border border-white/5 rounded-2xl p-4 space-y-2 hover:bg-black/30 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="font-semibold text-white">{item.name}</span>
                            <span className="text-[10px] text-gray-500">({item.count} transactions)</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-gray-400 font-mono">
                            <span>Min: ${item.min.toFixed(2)}</span>
                            <span className="text-purple-300 font-bold">Med: ${item.median.toFixed(2)}</span>
                            <span>Max: ${item.max.toFixed(2)}</span>
                          </div>
                        </div>

                        {/* Cat Whisker Visual Track */}
                        <div className="relative h-6 w-full flex items-center bg-black/40 rounded-lg px-2">
                          {/* Whisker Line (Min to Max) */}
                          <div
                            className="absolute h-0.5 bg-gray-500"
                            style={{
                              left: `${Math.max(2, leftPct)}%`,
                              width: `${Math.max(2, rightPct - leftPct)}%`
                            }}
                          />
                          {/* Min End Cap */}
                          <div
                            className="absolute w-1 h-3 bg-gray-400 rounded-sm"
                            style={{ left: `${Math.max(2, leftPct)}%` }}
                          />
                          {/* Max End Cap */}
                          <div
                            className="absolute w-1 h-3 bg-gray-400 rounded-sm"
                            style={{ left: `${Math.min(98, rightPct)}%` }}
                          />

                          {/* Box (Q1 to Q3) */}
                          <div
                            className="absolute h-4 rounded opacity-75 border"
                            style={{
                              left: `${Math.max(2, q1Pct)}%`,
                              width: `${Math.max(2, q3Pct - q1Pct)}%`,
                              backgroundColor: `${item.color}50`,
                              borderColor: item.color
                            }}
                          />

                          {/* Median Divider */}
                          <div
                            className="absolute w-1.5 h-5 bg-white rounded-full shadow"
                            style={{ left: `${Math.min(98, Math.max(2, medPct))}%` }}
                            title={`Median: $${item.median.toFixed(2)}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* GRAPH VIEW C: Cash Flow Trend Area Chart */}
          {analyticsGraphType === 'timeline' && (
            <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md">
              <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                Cumulative Cash Flow Trend
              </h3>
              <p className="text-xs text-gray-400 mb-6">Running balance trajectory across the reporting window</p>

              {timelineData.length <= 1 ? (
                <div className="h-64 flex items-center justify-center text-xs text-gray-500">
                  Not enough historical entries to display timeline
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#7c3bed" stopOpacity={0.6} />
                          <stop offset="95%" stopColor="#7c3bed" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
                      <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c172d',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          color: '#fff'
                        }}
                        formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Cumulative Balance']}
                      />
                      <Area
                        type="monotone"
                        dataKey="balance"
                        stroke="#7c3bed"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorBalance)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* GRAPH VIEW D: Category Spending Horizontal Bar Chart */}
          {analyticsGraphType === 'categories' && (
            <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md">
              <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                <TagIcon className="w-4 h-4 text-blue-400" />
                Expenses by Category &amp; Tag
              </h3>
              <p className="text-xs text-gray-400 mb-6">Aggregate distribution of tagged expenses</p>

              {!reportData?.categoryBreakdown?.length ? (
                <div className="h-64 flex items-center justify-center text-xs text-gray-500">
                  No tagged categories found in this scope
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.categoryBreakdown.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis type="number" stroke="#9ca3af" fontSize={11} tickFormatter={(v) => `$${v}`} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke="#9ca3af"
                        fontSize={11}
                        width={90}
                        tick={{ fill: '#d1d5db' }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c172d',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          color: '#fff'
                        }}
                        formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Total']}
                      />
                      <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                        {reportData.categoryBreakdown.slice(0, 10).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color || '#7c3bed'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: COMPREHENSIVE DATA TABLE */}
      {activeTab === 'transactions' && (
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Transaction Ledger</h3>
              <p className="text-xs text-gray-400">Detailed itemized list of all matching records</p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search description, job, tag..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th
                    className="p-3.5 cursor-pointer hover:text-white"
                    onClick={() => {
                      if (sortField === 'date') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else { setSortField('date'); setSortOrder('desc'); }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Date</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-white"
                    onClick={() => {
                      if (sortField === 'job_title') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else { setSortField('job_title'); setSortOrder('asc'); }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Job &amp; Invoice #</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5">Category</th>
                  <th
                    className="p-3.5 cursor-pointer hover:text-white"
                    onClick={() => {
                      if (sortField === 'description') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else { setSortField('description'); setSortOrder('asc'); }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Description</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5">Type</th>
                  <th
                    className="p-3.5 text-right cursor-pointer hover:text-white"
                    onClick={() => {
                      if (sortField === 'amount') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else { setSortField('amount'); setSortOrder('desc'); }
                    }}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Amount</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5 text-center">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {processedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-gray-500">
                      No transactions match the selected criteria
                    </td>
                  </tr>
                ) : (
                  processedTransactions.map((t: any) => {
                    const isIncome = t.entry_type === 'income';
                    const hasReceipt = Boolean(t.receipt_url);

                    return (
                      <tr key={t.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3.5 whitespace-nowrap text-gray-300">
                          {new Date((t.date || t.created_at).replace(' ', 'T')).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-white">{t.job_title}</div>
                          {t.invoice_number && (
                            <div className="text-[11px] font-mono text-purple-400 mt-0.5">
                              {t.invoice_number}
                            </div>
                          )}
                        </td>
                        <td className="p-3.5">
                          {t.tags?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {t.tags.map((tag: any) => (
                                <span
                                  key={tag.id}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                                  style={{
                                    backgroundColor: `${tag.color}20`,
                                    color: tag.color,
                                    border: `1px solid ${tag.color}40`
                                  }}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-500 text-[11px]">Untagged</span>
                          )}
                        </td>
                        <td className="p-3.5 text-gray-300 max-w-xs truncate" title={t.description}>
                          {t.description || '—'}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isIncome
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {isIncome ? 'Income' : 'Expense'}
                          </span>
                        </td>
                        <td
                          className={`p-3.5 text-right font-semibold whitespace-nowrap ${
                            isIncome ? 'text-emerald-400' : 'text-white'
                          }`}
                        >
                          {isIncome ? '+' : '-'}${Number(t.amount).toFixed(2)}
                        </td>
                        <td className="p-3.5 text-center">
                          {hasReceipt ? (
                            <button
                              onClick={async () => {
                                const url = await decryptExpenseReceipt(t);
                                if (url) {
                                  setPreviewReceipt({
                                    url,
                                    title: t.job_title,
                                    amount: t.amount,
                                    date: (t.date || t.created_at).split(' ')[0],
                                    description: t.description,
                                    invoiceNumber: t.invoice_number
                                  });
                                }
                              }}
                              disabled={decryptingExpenseIds[t.id]}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 transition-colors cursor-pointer"
                              title="View and inspect attached receipt"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{decryptingExpenseIds[t.id] ? 'Decrypting...' : 'View'}</span>
                            </button>
                          ) : (
                            <span className="text-gray-600 text-[11px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: ENHANCED EXPENSE DOCUMENTATION & RECEIPT GALLERY */}
      {activeTab === 'receipts' && (
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-purple-400" />
                Receipt &amp; Documentation Gallery
              </h3>
              <p className="text-xs text-gray-400">
                Visual audit archive with End-to-End Encrypted (E2EE) on-the-fly client decryption
              </p>
            </div>

            {isVaultLocked && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl">
                <Shield className="w-4 h-4 shrink-0" />
                <span>Vault locked: Click individual cards to decrypt receipt images</span>
              </div>
            )}
          </div>

          {reportData?.transactions?.filter((t: any) => Boolean(t.receipt_url)).length === 0 ? (
            <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
              <Receipt className="w-10 h-10 text-gray-500 mx-auto mb-3" />
              <h4 className="text-sm font-semibold text-white">No Receipts Found</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                None of the transactions in this filter set have receipt attachments. Upload receipts in your jobs to view them in the gallery.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {reportData.transactions
                .filter((t: any) => Boolean(t.receipt_url))
                .map((t: any) => {
                  const resolvedUrl = decryptedUrls[t.id] || (!t.is_encrypted ? t.receipt_url : null);
                  const isDecrypting = decryptingExpenseIds[t.id];

                  return (
                    <div
                      key={t.id}
                      className="bg-black/30 border border-white/5 rounded-2xl overflow-hidden hover:border-purple-500/30 transition-all group flex flex-col justify-between"
                    >
                      {/* Image Preview Box */}
                      <div className="relative aspect-video bg-black/40 flex items-center justify-center overflow-hidden">
                        {resolvedUrl ? (
                          <img
                            src={resolvedUrl}
                            alt="Receipt"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="p-4 text-center">
                            <Shield className="w-8 h-8 text-purple-400/60 mx-auto mb-2" />
                            <p className="text-[11px] text-gray-400 mb-2">Encrypted E2EE Receipt</p>
                            <button
                              type="button"
                              onClick={() => decryptExpenseReceipt(t)}
                              disabled={isDecrypting}
                              className="px-3 py-1 rounded-lg text-xs font-medium bg-[#7c3bed] hover:bg-[#6b33cc] text-white transition-colors cursor-pointer"
                            >
                              {isDecrypting ? 'Decrypting...' : 'Decrypt Now'}
                            </button>
                          </div>
                        )}

                        {resolvedUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewReceipt({
                                url: resolvedUrl,
                                title: t.job_title,
                                amount: t.amount,
                                date: (t.date || t.created_at).split(' ')[0],
                                description: t.description,
                                invoiceNumber: t.invoice_number
                              })
                            }
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Fullscreen Preview"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Card Metadata */}
                      <div className="p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">${Number(t.amount).toFixed(2)}</span>
                          <span className="text-[10px] text-gray-400">
                            {new Date((t.date || t.created_at).replace(' ', 'T')).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric'
                            })}
                          </span>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-gray-200 truncate" title={t.job_title}>
                            {t.job_title}
                          </div>
                          {t.invoice_number && (
                            <div className="text-[10px] font-mono text-purple-400">{t.invoice_number}</div>
                          )}
                        </div>

                        {t.description && (
                          <p className="text-[11px] text-gray-400 line-clamp-1" title={t.description}>
                            {t.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 4: JOB BREAKDOWN MATRIX */}
      {activeTab === 'jobs' && (
        <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 backdrop-blur-md space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Job Performance Matrix</h3>
            <p className="text-xs text-gray-400">Cross-comparison of income, costs, and net margins across all jobs</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/20">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="p-3.5">Job Title</th>
                  <th className="p-3.5">Invoice #</th>
                  <th className="p-3.5">Client</th>
                  <th className="p-3.5 text-right">Income</th>
                  <th className="p-3.5 text-right">Expenses</th>
                  <th className="p-3.5 text-right">Net Margin</th>
                  <th className="p-3.5 text-center">Entries</th>
                  <th className="p-3.5 text-center">Receipts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {!reportData?.jobBreakdown?.length ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
                      No jobs matched the current criteria
                    </td>
                  </tr>
                ) : (
                  reportData.jobBreakdown.map((j: any) => (
                    <tr key={j.jobId} className="hover:bg-white/5 transition-colors">
                      <td className="p-3.5 font-medium text-white">{j.title}</td>
                      <td className="p-3.5 font-mono text-purple-400">{j.invoice_number || '—'}</td>
                      <td className="p-3.5 text-gray-400">{j.client_name || '—'}</td>
                      <td className="p-3.5 text-right text-emerald-400 font-semibold">
                        ${Number(j.income).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-right text-rose-400 font-semibold">
                        ${Number(j.expense).toFixed(2)}
                      </td>
                      <td
                        className={`p-3.5 text-right font-bold ${
                          j.net >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {j.net >= 0 ? '+' : '-'}${Math.abs(j.net).toFixed(2)}
                      </td>
                      <td className="p-3.5 text-center text-gray-300">{j.transactionCount}</td>
                      <td className="p-3.5 text-center text-indigo-400 font-medium">{j.receiptCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FULLSCREEN RECEIPT MODAL */}
      {previewReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1c172d] border border-white/10 rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl relative flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">{previewReceipt.title}</h3>
                <p className="text-xs text-gray-400">
                  {previewReceipt.date} • ${Number(previewReceipt.amount).toFixed(2)}
                  {previewReceipt.invoiceNumber && ` • ${previewReceipt.invoiceNumber}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewReceipt.url}
                  target="_blank"
                  rel="noreferrer"
                  download="receipt.jpg"
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
                  title="Open or Download in New Tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setPreviewReceipt(null)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-black/40">
              <img
                src={previewReceipt.url}
                alt="Receipt Full Preview"
                className="max-h-[65vh] w-auto object-contain rounded-xl shadow-lg"
              />
            </div>

            {previewReceipt.description && (
              <div className="p-4 border-t border-white/5 text-xs text-gray-300 bg-black/20">
                <strong>Description:</strong> {previewReceipt.description}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DEDICATED PRINT PREVIEW MODAL (UNCLIPPED FULL DOCUMENT) */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-6 overflow-y-auto">
          <div className="bg-white text-gray-900 rounded-3xl max-w-5xl w-full shadow-2xl overflow-hidden flex flex-col my-auto border border-gray-200">
            {/* Top Toolbar (Excluded from print) */}
            <div className="no-print p-4 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-gray-700" />
                <span className="font-semibold text-gray-800 text-sm">Print / PDF Preview Mode</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-semibold text-xs rounded-xl shadow transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Document Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  className="p-2 rounded-xl hover:bg-gray-200 text-gray-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Document Body */}
            <div id="printable-report-area" className="p-8 sm:p-12 space-y-8 bg-white text-gray-900 text-sm font-sans">
              {/* Header */}
              <div className="flex justify-between items-start border-b-2 border-gray-200 pb-6">
                <div>
                  {template?.company_logo_url ? (
                    <img
                      src={template.company_logo_url}
                      alt="Company Logo"
                      className="h-14 mb-3 object-contain"
                      crossOrigin="anonymous"
                    />
                  ) : null}
                  <h1 className="text-2xl font-bold text-gray-900">
                    {template?.company_name || 'GlassExpense'}
                  </h1>
                  {template?.company_address && (
                    <p className="text-xs text-gray-500 whitespace-pre-wrap mt-1">{template.company_address}</p>
                  )}
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-light text-gray-500 tracking-wider">FINANCIAL REPORT</h2>
                  <p className="text-xs text-gray-600 font-medium mt-1">
                    Generated: {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <p className="text-xs text-gray-500">
                    Window: {filters.startDate || 'Beginning'} — {filters.endDate || 'Present'}
                  </p>
                </div>
              </div>

              {/* KPI Executive Summary Ledger */}
              <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-semibold">Total Income</span>
                  <span className="text-base font-bold text-emerald-600">${summary.totalIncome.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-semibold">Total Expenses</span>
                  <span className="text-base font-bold text-rose-600">${summary.totalExpense.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-semibold">Net Profit / Margin</span>
                  <span className={`text-base font-bold ${summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {summary.net >= 0 ? '+' : '-'}${Math.abs(summary.net).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block font-semibold">Total Entries</span>
                  <span className="text-base font-bold text-gray-800">{summary.transactionCount} transactions</span>
                </div>
              </div>

              {/* UNCLIPPED: Complete Jobs Included in this Report */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800 border-b border-gray-200 pb-2">
                  Jobs Included in this Report ({reportData?.jobBreakdown?.length || 0})
                </h3>
                <table className="w-full text-left text-xs border border-gray-200">
                  <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="p-2.5">Job Title</th>
                      <th className="p-2.5">Invoice #</th>
                      <th className="p-2.5">Client</th>
                      <th className="p-2.5 text-right">Income</th>
                      <th className="p-2.5 text-right">Expenses</th>
                      <th className="p-2.5 text-right">Net Margin</th>
                      <th className="p-2.5 text-center">Entries</th>
                      <th className="p-2.5 text-center">Receipts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {!reportData?.jobBreakdown?.length ? (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-gray-500">
                          No jobs found in this query
                        </td>
                      </tr>
                    ) : (
                      reportData.jobBreakdown.map((j: any) => (
                        <tr key={j.jobId}>
                          <td className="p-2.5 font-semibold text-gray-900">{j.title}</td>
                          <td className="p-2.5 font-mono text-gray-700">{j.invoice_number || '—'}</td>
                          <td className="p-2.5 text-gray-600">{j.client_name || '—'}</td>
                          <td className="p-2.5 text-right text-emerald-700 font-medium">${Number(j.income).toFixed(2)}</td>
                          <td className="p-2.5 text-right text-rose-700 font-medium">${Number(j.expense).toFixed(2)}</td>
                          <td className={`p-2.5 text-right font-bold ${j.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {j.net >= 0 ? '+' : '-'}${Math.abs(j.net).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-center text-gray-600">{j.transactionCount}</td>
                          <td className="p-2.5 text-center text-gray-600">{j.receiptCount}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* UNCLIPPED: Itemized Transactions Ledger */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800 border-b border-gray-200 pb-2">
                  Itemized Transactions ({reportData?.transactions?.length || 0})
                </h3>
                <table className="w-full text-left text-xs border border-gray-200">
                  <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Job</th>
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Category</th>
                      <th className="p-2">Description</th>
                      <th className="p-2">Type</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {!reportData?.transactions?.length ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-gray-500">
                          No transactions recorded
                        </td>
                      </tr>
                    ) : (
                      reportData.transactions.map((t: any) => {
                        const isIncome = t.entry_type === 'income';
                        return (
                          <tr key={t.id}>
                            <td className="p-2 whitespace-nowrap text-gray-700">
                              {(t.date || t.created_at).split(' ')[0]}
                            </td>
                            <td className="p-2 font-medium text-gray-900">{t.job_title}</td>
                            <td className="p-2 font-mono text-gray-600">{t.invoice_number || '—'}</td>
                            <td className="p-2 text-gray-600">
                              {t.tags?.map((tg: any) => tg.name).join(', ') || 'Untagged'}
                            </td>
                            <td className="p-2 text-gray-700">{t.description || '—'}</td>
                            <td className="p-2 uppercase text-[10px] font-semibold text-gray-600">
                              {isIncome ? 'Income' : 'Expense'}
                            </td>
                            <td className={`p-2 text-right font-semibold ${isIncome ? 'text-emerald-700' : 'text-gray-900'}`}>
                              {isIncome ? '+' : '-'}${Number(t.amount).toFixed(2)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer Notes */}
              <div className="pt-6 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
                <span>Generated by GlassExpense — End-to-End Encrypted Financial Tracking</span>
                <span>Page 1 of 1</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
