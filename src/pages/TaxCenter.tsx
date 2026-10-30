import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FileText,
  Calculator,
  ShieldCheck,
  TrendingUp,
  Car,
  Building2,
  Briefcase,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Upload,
  Download,
  Printer,
  Eye,
  Settings as SettingsIcon,
  Layers,
  Info,
  HelpCircle,
  Plus,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Filter,
  Receipt,
  FileCheck,
  Tag,
  Home,
  Check,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SCHEDULE_C_LINE_METADATA,
  ScheduleCLine,
  TaxYear,
  FilingStatus,
  EntityType,
  TaxCalculationResult,
  STANDARD_MILEAGE_RATES
} from '../utils/taxCalculator';
import { runLocalOcr, parseW2TextLocally } from '../utils/ocr';
import { decryptFile } from '../utils/crypto';

export default function TaxCenter() {
  const { user, token } = useAuth();

  // State
  const [taxYear, setTaxYear] = useState<TaxYear>(2025);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule_c' | 'sole_prop_forms' | 'w2' | 'vouchers' | 'export'>('overview');
  const [solePropSubTab, setSolePropSubTab] = useState<'schedule_c' | 'schedule_se' | 'form_1040' | 'form_1040_es'>('schedule_c');
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  const [reassigningExpenseId, setReassigningExpenseId] = useState<string | null>(null);
  const [reassignToast, setReassignToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [calcData, setCalcData] = useState<any>(null);
  const [profileSettings, setProfileSettings] = useState<any>(null);
  const [w2Forms, setW2Forms] = useState<any[]>([]);
  const [accessibleJobs, setAccessibleJobs] = useState<any[]>([]);
  const [tagMappings, setTagMappings] = useState<any[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [unclaimedSuggestions, setUnclaimedSuggestions] = useState<any[]>([]);
  const [isDeductionDiscoveryModalOpen, setIsDeductionDiscoveryModalOpen] = useState(false);
  const [claimingSuggestionId, setClaimingSuggestionId] = useState<string | null>(null);
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const [suggestionLineOverrides, setSuggestionLineOverrides] = useState<Record<string, string>>({});
  const [guideEntityTab, setGuideEntityTab] = useState<'sole_prop' | 'llc' | 'scorp'>('sole_prop');

  // Modals
  const [isW2ModalOpen, setIsW2ModalOpen] = useState(false);
  const [editingW2, setEditingW2] = useState<any>(null);
  const [isJobScopeModalOpen, setIsJobScopeModalOpen] = useState(false);
  const [isTagMappingModalOpen, setIsTagMappingModalOpen] = useState(false);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState<string | null>(null);
  const [decryptedReceiptSrc, setDecryptedReceiptSrc] = useState<string | null>(null);
  const [isDecryptingReceipt, setIsDecryptingReceipt] = useState(false);

  // OCR state
  const [isScanningW2, setIsScanningW2] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Print ref
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Form state for W-2 modal
  const [w2FormState, setW2FormState] = useState({
    id: '',
    employer_name: '',
    employer_ein: '',
    is_scorp_officer_w2: false,
    wages_box1: 0,
    fed_withholding_box2: 0,
    ss_wages_box3: 0,
    ss_withholding_box4: 0,
    medicare_wages_box5: 0,
    medicare_withholding_box6: 0,
    state_code: '',
    state_wages_box16: 0,
    state_withholding_box17: 0
  });

  // Fetch complete tax data
  const fetchTaxData = async (selectedYear = taxYear) => {
    if (!token) return;
    setLoading(true);
    try {
      // 1. Fetch tax profile
      const profRes = await fetch(`/api/taxes/profile?year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (profRes.ok) {
        const profData = await profRes.json();
        setProfileSettings(profData.settings || {});
        if (profData.settings?.entity_type === 'llc_scorp') {
          setGuideEntityTab('scorp');
        } else if (profData.settings?.entity_type === 'llc_single_member') {
          setGuideEntityTab('llc');
        } else {
          setGuideEntityTab('sole_prop');
        }
        setW2Forms(profData.w2Forms || []);
        setAccessibleJobs(profData.accessibleJobs || []);
        setTagMappings(profData.tagMappings || []);
        setAvailableTags(profData.availableTags || []);
      }

      // 2. Fetch live calculation
      const calcRes = await fetch(`/api/taxes/calculate?year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (calcRes.ok) {
        const cData = await calcRes.json();
        setCalcData(cData);
      }

      // 3. Fetch unclaimed deductions suggestions
      const uncRes = await fetch(`/api/taxes/unclaimed-suggestions?year=${selectedYear}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (uncRes.ok) {
        const uncData = await uncRes.json();
        setUnclaimedSuggestions(uncData.suggestions || []);
      }
    } catch (e) {
      console.error('Failed to load tax data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTaxData(taxYear);
  }, [taxYear, token]);

  // Update profile settings
  const updateSettings = async (updates: Record<string, any>) => {
    if (!token) return;
    setSavingSettings(true);
    try {
      const merged = { ...profileSettings, ...updates, tax_year: taxYear };
      const res = await fetch('/api/taxes/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(merged)
      });
      if (res.ok) {
        const data = await res.json();
        setProfileSettings(data.settings);
        // Refresh calculation
        const calcRes = await fetch(`/api/taxes/calculate?year=${taxYear}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (calcRes.ok) setCalcData(await calcRes.json());
      }
    } catch (e) {
      console.error('Failed to update settings:', e);
    } finally {
      setSavingSettings(false);
    }
  };

  // Save W-2 Form
  const handleSaveW2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const res = await fetch('/api/taxes/w2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...w2FormState,
          tax_year: taxYear
        })
      });
      if (res.ok) {
        setIsW2ModalOpen(false);
        fetchTaxData(taxYear);
      }
    } catch (err) {
      console.error('Error saving W-2:', err);
    }
  };

  // Delete W-2 Form
  const handleDeleteW2 = async (id: string) => {
    if (!token || !window.confirm('Are you sure you want to delete this W-2 form?')) return;
    try {
      const res = await fetch(`/api/taxes/w2/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchTaxData(taxYear);
      }
    } catch (err) {
      console.error('Error deleting W-2:', err);
    }
  };

  // Open W-2 Modal
  const openW2Modal = (w2?: any) => {
    if (w2) {
      setEditingW2(w2);
      setW2FormState({
        id: w2.id,
        employer_name: w2.employer_name || '',
        employer_ein: w2.employer_ein || '',
        is_scorp_officer_w2: Boolean(w2.is_scorp_officer_w2),
        wages_box1: w2.wages_box1 || 0,
        fed_withholding_box2: w2.fed_withholding_box2 || 0,
        ss_wages_box3: w2.ss_wages_box3 || 0,
        ss_withholding_box4: w2.ss_withholding_box4 || 0,
        medicare_wages_box5: w2.medicare_wages_box5 || 0,
        medicare_withholding_box6: w2.medicare_withholding_box6 || 0,
        state_code: w2.state_code || '',
        state_wages_box16: w2.state_wages_box16 || 0,
        state_withholding_box17: w2.state_withholding_box17 || 0
      });
    } else {
      setEditingW2(null);
      setW2FormState({
        id: '',
        employer_name: '',
        employer_ein: '',
        is_scorp_officer_w2: profileSettings?.entity_type === 'llc_scorp',
        wages_box1: 0,
        fed_withholding_box2: 0,
        ss_wages_box3: 0,
        ss_withholding_box4: 0,
        medicare_wages_box5: 0,
        medicare_withholding_box6: 0,
        state_code: profileSettings?.state_code || '',
        state_wages_box16: 0,
        state_withholding_box17: 0
      });
    }
    setIsW2ModalOpen(true);
  };

  // OCR Upload Handling (Cloud Vision or On-Device Local OCR)
  const handleW2FileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    setIsScanningW2(true);
    setScanStatus('Analyzing document...');
    setScanProgress(20);

    const formData = new FormData();
    formData.append('w2', file);

    try {
      // 1. Try Cloud Vision endpoint first
      const res = await fetch('/api/taxes/w2/ocr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        if (data.parsed) {
          openW2Modal({
            ...data.parsed,
            id: '',
            tax_year: taxYear
          });
          setIsScanningW2(false);
          return;
        }
      }

      // 2. Fallback to On-Device Local OCR (Tesseract.js)
      setScanStatus('Running local OCR recognition...');
      const localUrl = URL.createObjectURL(file);
      const ocrResult = await runLocalOcr(localUrl, 'tesseract', (info) => {
        if (info.progress) setScanProgress(info.progress);
        if (info.status) setScanStatus(info.status);
      });

      const parsed = parseW2TextLocally(ocrResult.generated_text || '');
      openW2Modal({
        ...parsed,
        id: '',
        tax_year: taxYear
      });
    } catch (err: any) {
      console.error('W-2 OCR Error:', err);
      alert('Could not automatically parse the document. Opening manual entry form.');
      openW2Modal();
    } finally {
      setIsScanningW2(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // View Decrypted Receipt
  const handleViewReceipt = async (receiptUrl: string, jobId: string, isEncrypted: boolean) => {
    setSelectedReceiptUrl(receiptUrl);
    setDecryptedReceiptSrc(null);
    setIsDecryptingReceipt(true);

    try {
      if (!isEncrypted) {
        setDecryptedReceiptSrc(receiptUrl);
        setIsDecryptingReceipt(false);
        return;
      }

      const jobKey = calcData?.jobKeys?.[jobId];
      if (!jobKey) {
        alert('Job encryption key is not available in your session.');
        setIsDecryptingReceipt(false);
        return;
      }

      const res = await fetch(receiptUrl, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const decrypted = await decryptFile(blob, jobKey, 'image/jpeg');
      setDecryptedReceiptSrc(URL.createObjectURL(decrypted));
    } catch (err) {
      console.error('Decryption failed:', err);
      alert('Failed to decrypt receipt.');
    } finally {
      setIsDecryptingReceipt(false);
    }
  };

  // Handle Export to CSV
  const handleExportCsv = () => {
    if (!calcData?.transactions) return;
    const headers = ['Date', 'Job', 'Invoice #', 'Type', 'Schedule C Line', 'Description', 'Amount', 'Receipt Attached'];
    const rows = calcData.transactions.map((t: any) => [
      t.date || t.created_at,
      `"${(t.job_title || '').replace(/"/g, '""')}"`,
      t.job_invoice_number || '',
      t.entry_type,
      t.assigned_schedule_c_line || 'None',
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.amount.toFixed(2),
      t.receipt_url ? 'Yes' : 'No'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `GlassExpense_TaxPackage_${taxYear}_${user?.username || 'user'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Print
  const handlePrint = () => {
    window.print();
  };

  // Handle Expense Reassignment to a different Schedule C category
  const handleReassignExpense = async (expenseId: string, newLine: string) => {
    if (!token) return;
    setReassigningExpenseId(expenseId);
    try {
      const res = await fetch('/api/taxes/reassign-expense', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ expense_id: expenseId, schedule_c_line: newLine })
      });
      if (res.ok) {
        const lineName = newLine === 'auto'
          ? 'Automatic Categorization'
          : SCHEDULE_C_LINE_METADATA[newLine as ScheduleCLine]?.title || newLine;
        setReassignToast(`Transaction reassigned to ${lineName}`);
        setTimeout(() => setReassignToast(null), 3500);
        await fetchTaxData(taxYear);
      }
    } catch (err) {
      console.error('Error reassigning expense:', err);
    } finally {
      setReassigningExpenseId(null);
    }
  };

  // Claim single deduction suggestion
  const handleClaimSuggestion = async (suggestion: any, targetLine?: string) => {
    if (!token) return;
    const lineToAssign = targetLine || suggestion.suggestedLine;
    setClaimingSuggestionId(suggestion.expenseId);
    try {
      const res = await fetch('/api/taxes/reassign-expense', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          expense_id: suggestion.expenseId,
          schedule_c_line: lineToAssign
        })
      });
      if (res.ok) {
        setUnclaimedSuggestions(prev => prev.filter(s => s.expenseId !== suggestion.expenseId));
        const lineTitle = SCHEDULE_C_LINE_METADATA[lineToAssign as ScheduleCLine]?.title || lineToAssign;
        setReassignToast(`Claimed "${suggestion.description || 'Expense'}" as ${lineTitle}! +$${suggestion.estimatedTaxSavings.toFixed(2)} tax savings.`);
        setTimeout(() => setReassignToast(null), 4000);
        await fetchTaxData(taxYear);
      }
    } catch (e) {
      console.error('Failed to claim suggestion:', e);
    } finally {
      setClaimingSuggestionId(null);
    }
  };

  // Claim all deduction suggestions in 1 batch
  const handleClaimAllSuggestions = async () => {
    if (!token || unclaimedSuggestions.length === 0) return;
    setIsClaimingAll(true);
    try {
      const assignments = unclaimedSuggestions.map(s => ({
        expense_id: s.expenseId,
        schedule_c_line: suggestionLineOverrides[s.expenseId] || s.suggestedLine
      }));
      const res = await fetch('/api/taxes/reassign-expenses-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ assignments })
      });
      if (res.ok) {
        const totalSaved = unclaimedSuggestions.reduce((a, s) => a + s.estimatedTaxSavings, 0);
        const count = unclaimedSuggestions.length;
        setUnclaimedSuggestions([]);
        setIsDeductionDiscoveryModalOpen(false);
        setReassignToast(`Successfully claimed all ${count} write-offs! Added ~$${totalSaved.toFixed(2)} in tax deductions.`);
        setTimeout(() => setReassignToast(null), 5000);
        await fetchTaxData(taxYear);
      }
    } catch (e) {
      console.error('Failed to claim all suggestions:', e);
    } finally {
      setIsClaimingAll(false);
    }
  };

  const handleDismissSuggestion = (expenseId: string) => {
    setUnclaimedSuggestions(prev => prev.filter(s => s.expenseId !== expenseId));
  };

  const calc: TaxCalculationResult | null = calcData?.calculation || null;
  const isSCorp = (profileSettings?.entity_type || 'sole_proprietorship') === 'llc_scorp';

  return (
    <div className="min-h-screen bg-[#121317] text-white py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header & Context Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#7c3bed] to-[#4f46e5] text-white shadow-lg shadow-[#7c3bed]/25">
                <Calculator className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                  Tax Center & Calculator
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#7c3bed]/20 text-[#7c3bed] font-medium border border-[#7c3bed]/30">
                    Phase 4
                  </span>
                </h1>
                <p className="text-sm text-gray-400">
                  Comprehensive Schedule C, Form 1120-S & 1040 Tax Engine with FICA Coordination
                </p>
              </div>
            </div>
          </div>

          {/* Controls: Year, Entity, Refresh */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Tax Year Selector */}
            <div className="flex items-center bg-[#1a1c23] border border-white/10 rounded-xl p-1 shadow-inner">
              {([2024, 2025, 2026] as TaxYear[]).map((y) => (
                <button
                  key={y}
                  onClick={() => setTaxYear(y)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    taxYear === y
                      ? 'bg-[#7c3bed] text-white shadow-md shadow-[#7c3bed]/30'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            {/* Entity Selector */}
            <select
              value={profileSettings?.entity_type || 'sole_proprietorship'}
              onChange={(e) => updateSettings({ entity_type: e.target.value })}
              className="bg-[#1a1c23] border border-white/10 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:border-[#7c3bed]"
            >
              <option value="sole_proprietorship">Sole Proprietorship</option>
              <option value="single_member_llc">Single-Member LLC (Disregarded)</option>
              <option value="llc_scorp">LLC + S-Corp Election (Form 1120-S)</option>
            </select>

            {/* Filing Status */}
            <select
              value={profileSettings?.filing_status || 'single'}
              onChange={(e) => updateSettings({ filing_status: e.target.value })}
              className="bg-[#1a1c23] border border-white/10 text-xs text-white rounded-xl px-3 py-2 focus:outline-none focus:border-[#7c3bed]"
            >
              <option value="single">Single</option>
              <option value="mfj">Married Filing Jointly</option>
              <option value="hoh">Head of Household</option>
              <option value="mfs">Married Filing Separately</option>
            </select>

            {/* Job Scope Filter Button */}
            <button
              onClick={() => setIsJobScopeModalOpen(true)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-[#1a1c23] border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 flex items-center gap-1.5 transition-colors"
            >
              <Filter className="w-3.5 h-3.5 text-[#7c3bed]" />
              <span>Jobs Included ({calcData?.jobsIncluded?.length || 0})</span>
            </button>

            {/* Refresh */}
            <button
              onClick={() => fetchTaxData(taxYear)}
              disabled={loading}
              className="p-2 rounded-xl bg-[#1a1c23] border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Refresh Tax Math"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#7c3bed]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Executive Hero Gauge: Refund or Balance Due */}
        {calc && (
          <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border border-white/10 bg-gradient-to-br from-[#1a1c23] via-[#161820] to-[#121317] shadow-2xl backdrop-blur-xl">
            {/* Ambient Background Glow */}
            <div
              className={`absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none ${
                calc.reconciliation.isRefund ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold text-gray-400 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-[#7c3bed]" />
                  Tax Year {taxYear} Estimated Net Position
                </span>
                <div className="flex items-baseline gap-3 mt-2">
                  <span
                    className={`text-4xl sm:text-6xl font-black tracking-tight ${
                      calc.reconciliation.isRefund ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {calc.reconciliation.isRefund ? '+' : '-'}${calc.reconciliation.refundOrBalanceAmount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                  <span
                    className={`text-sm px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                      calc.reconciliation.isRefund
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {calc.reconciliation.isRefund ? 'Estimated Federal Refund' : 'Estimated Balance Owed'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-2 max-w-2xl">
                  Reconciled against ${calc.reconciliation.totalFederalTaxLiability.toFixed(2)} total federal liability
                  (Income Tax + Self-Employment Tax) minus ${calc.reconciliation.totalPaymentsAndCredits.toFixed(2)} in W-2 withholdings and estimated 1040-ES payments.
                </p>
              </div>

              {/* S-Corp FICA Savings Gauge Callout (if active) */}
              {isSCorp && calc.scorpSummary && (
                <div className="bg-gradient-to-br from-[#7c3bed]/15 to-[#4f46e5]/10 border border-[#7c3bed]/30 rounded-2xl p-4 sm:p-5 max-w-md shadow-lg">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#7c3bed] uppercase tracking-wider">
                    <Sparkles className="w-4 h-4" />
                    S-Corp Tax Advantage Active
                  </div>
                  <div className="text-2xl font-bold text-white mt-1">
                    +${calc.scorpSummary.ficaTaxSavingsVsSoleProp.toFixed(2)} Saved
                  </div>
                  <p className="text-xs text-gray-300 mt-1">
                    K-1 distributions (${calc.scorpSummary.k1OrdinaryIncome.toFixed(2)}) are 100% exempt from self-employment taxes, saving you 15.3% in FICA!
                  </p>
                </div>
              )}
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-8 pt-6 border-t border-white/10">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">Gross Revenue</span>
                <div className="text-base sm:text-lg font-bold text-white mt-0.5">
                  ${calc.scheduleC.grossRevenue.toFixed(2)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">Allowable Expenses</span>
                <div className="text-base sm:text-lg font-bold text-emerald-400 mt-0.5">
                  ${calc.scheduleC.totalAllowableExpenses.toFixed(2)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">Deduction Savings</span>
                <div className="text-base sm:text-lg font-bold text-purple-400 mt-0.5">
                  +${calc.estimatedTaxSavingsFromDeductions.toFixed(2)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">W-2 Wages</span>
                <div className="text-base sm:text-lg font-bold text-white mt-0.5">
                  ${calc.incomeTax.totalW2Wages.toFixed(2)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">Adjusted Gross (AGI)</span>
                <div className="text-base sm:text-lg font-bold text-white mt-0.5">
                  ${calc.incomeTax.agi.toFixed(2)}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[11px] text-gray-400 uppercase font-medium">Total Liability</span>
                <div className="text-base sm:text-lg font-bold text-white mt-0.5">
                  ${calc.reconciliation.totalFederalTaxLiability.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Unclaimed Deductions Smart Alert Banner */}
        {unclaimedSuggestions.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-200">
                  Deduction Discovery: {unclaimedSuggestions.length} Untagged Transactions Found!
                </h4>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  We scanned your receipts and found potential write-offs (e.g. Home Depot, fuel, software) worth approx{' '}
                  <span className="font-bold text-white">
                    ${unclaimedSuggestions.reduce((acc, s) => acc + s.estimatedTaxSavings, 0).toFixed(2)}
                  </span>{' '}
                  in direct tax savings!
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsDeductionDiscoveryModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors shrink-0 flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Review Deductions ({unclaimedSuggestions.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Navigation Tab Bar */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Tax Overview & Brackets', icon: Layers },
            { id: 'schedule_c', label: 'Schedule C & Write-Offs', icon: FileText },
            { id: 'sole_prop_forms', label: 'Sole Proprietor Tax Forms (1040/SE/C/ES)', icon: FileCheck },
            { id: 'w2', label: 'W-2 Ingestion & Forms', icon: Briefcase },
            { id: 'vouchers', label: '1040-ES Quarterly Vouchers', icon: Calendar },
            { id: 'export', label: 'IRS Package & Audit Ledger', icon: Download }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                  isActive
                    ? 'bg-[#7c3bed] text-white shadow-lg shadow-[#7c3bed]/25'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Category Reassignment Success Notification */}
        {reassignToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-200 text-xs flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-purple-400" />
              <span className="font-medium">{reassignToast}</span>
            </div>
            <button onClick={() => setReassignToast(null)} className="text-gray-400 hover:text-white text-xs">
              ✕
            </button>
          </motion.div>
        )}

        {/* TAB 1: OVERVIEW & PROGRESSIVE BRACKETS */}
        {activeTab === 'overview' && calc && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Progressive Tax Brackets Staircase */}
              <div className="lg:col-span-2 rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-6 backdrop-blur-xl">
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-[#7c3bed]" />
                      Progressive Federal Tax Brackets ({taxYear})
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Filing Status: <span className="text-white capitalize">{calc.filingStatus}</span> | Marginal Rate:{' '}
                      <span className="text-purple-400 font-bold">{(calc.incomeTax.marginalRate * 100).toFixed(0)}%</span> | Effective Rate:{' '}
                      <span className="text-white font-bold">{calc.incomeTax.effectiveRate}%</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-gray-400">Taxable Income</span>
                    <div className="text-lg font-bold text-white">${calc.incomeTax.taxableIncome.toFixed(2)}</div>
                  </div>
                </div>

                <div className="space-y-3 mt-4">
                  {calc.incomeTax.bracketsBreakdown.map((b, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-12 text-xs font-bold text-purple-400">{(b.rate * 100).toFixed(0)}%</span>
                        <div>
                          <div className="text-xs text-gray-300">
                            ${b.min.toLocaleString()} – {b.max === -1 ? 'Above' : `$${b.max.toLocaleString()}`}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            ${b.taxableInBracket.toLocaleString()} taxed in this bracket
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-white">${b.taxAmount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
                  <span>Total Calculated Federal Income Tax:</span>
                  <span className="text-sm font-bold text-white">${calc.incomeTax.federalIncomeTax.toFixed(2)}</span>
                </div>
              </div>

              {/* Deductions & Special Calculations Sidebar */}
              <div className="space-y-6">
                {/* Standard Deduction & QBI §199A */}
                <div className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-6 backdrop-blur-xl space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Statutory Deductions
                  </h3>
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-300">Standard Deduction</div>
                      <div className="text-[11px] text-gray-500">IRS statutory allowance for {calc.filingStatus.toUpperCase()}</div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      -${calc.incomeTax.standardDeduction.toFixed(2)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-300">Qualified Business Income (QBI §199A)</div>
                      <div className="text-[11px] text-gray-500">20% Pass-through deduction on eligible profit</div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      -${calc.incomeTax.qbiDeduction.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Self-Employment Tax Summary (Schedule SE) */}
                <div className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-6 backdrop-blur-xl space-y-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-[#7c3bed]" />
                    Self-Employment Tax (Schedule SE)
                  </h3>
                  {isSCorp ? (
                    <div className="text-xs text-gray-400 p-3 rounded-xl bg-[#7c3bed]/10 border border-[#7c3bed]/20">
                      <span className="font-semibold text-white">S-Corp Status:</span> S-Corp shareholder distributions are exempt from self-employment taxes! Your FICA contributions are processed through your officer W-2 salary.
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-xs text-gray-300">
                        <span>Net SE Earnings (92.35%):</span>
                        <span className="font-mono font-bold">${calc.selfEmployment.netEarningsSubjectToSE.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-300">
                        <span>Social Security Tax (12.4%):</span>
                        <span className="font-mono">${calc.selfEmployment.ssTax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-300">
                        <span>Medicare Tax (2.9%):</span>
                        <span className="font-mono">${calc.selfEmployment.medicareTax.toFixed(2)}</span>
                      </div>
                      {calc.selfEmployment.additionalMedicareTax > 0 && (
                        <div className="flex justify-between text-xs text-gray-300">
                          <span>Additional Medicare (0.9%):</span>
                          <span className="font-mono text-rose-400">
                            ${calc.selfEmployment.additionalMedicareTax.toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-white/10 flex justify-between text-xs font-bold text-white">
                        <span>Total SE Tax:</span>
                        <span className="font-mono text-purple-400">${calc.selfEmployment.totalSETax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-gray-400">
                        <span>Above-the-Line 50% Deduction:</span>
                        <span className="font-mono text-emerald-400">-${calc.selfEmployment.aboveTheLineDeduction.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* BEGINNER TAX FILING BLUEPRINT & STEP-BY-STEP GUIDES */}
            <div className="rounded-2xl bg-gradient-to-br from-[#1a1c23] to-[#161820] border border-white/10 p-6 sm:p-8 backdrop-blur-xl space-y-6">
              {/* Header & Sub-Navigation */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
                <div className="flex items-start gap-3">
                  <div className="p-3 rounded-xl bg-[#7c3bed]/20 text-[#7c3bed] border border-[#7c3bed]/30 shrink-0">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-bold text-white">
                        First-Time Self-Employed Tax Filing Blueprint
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                        Beginner Guide
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Clear, step-by-step instructions on which official IRS forms to file, how business write-offs & losses work, and exact line-by-line values from GlassExpense to put into your tax return.
                    </p>
                  </div>
                </div>

                {/* 3-Way Entity Switcher Pills */}
                <div className="flex items-center bg-[#121317] border border-white/10 rounded-xl p-1 shrink-0 overflow-x-auto">
                  {[
                    { id: 'sole_prop', label: '1. Sole Proprietor' },
                    { id: 'llc', label: '2. Single-Member LLC' },
                    { id: 'scorp', label: '3. S-Corporation' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setGuideEntityTab(tab.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        guideEntityTab === tab.id
                          ? 'bg-[#7c3bed] text-white shadow-md shadow-[#7c3bed]/20'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* TAB 1: SOLE PROPRIETORSHIP GUIDE */}
              {guideEntityTab === 'sole_prop' && (
                <div className="space-y-6">
                  {/* Entity Overview Banner */}
                  <div className="p-5 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                        Option 1: Sole Proprietorship (Default Self-Employed / 1099)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30 font-medium">
                          No State Registration Needed
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                          Pass-Through on Form 1040
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      If you do freelance work, contract labor, or run a trade without filing formal LLC state paperwork, the IRS automatically classifies you as a <strong>Sole Proprietor</strong>. You and your business are legally and tax-wise the same entity. There is no separate business tax return—all income, write-offs, and losses flow directly onto your personal <strong>Form 1040</strong>.
                    </p>
                  </div>

                  {/* Which Documents You Need to File */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#7c3bed]" />
                      Official IRS Documents You File:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#7c3bed]"></span>
                            Form 1040
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">Due April 15</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Your main individual annual tax return. All your household income (W-2 jobs, interest, and business profit/loss) combines here.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-purple-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                            Schedule C (Form 1040)
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">Attached to 1040</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          <strong>"Profit or Loss From Business"</strong>. The core business form where you report gross receipts (Line 1), deduct allowable write-offs (Part II), and calculate Net Profit or Loss (Line 31).
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            Schedule SE (Form 1040)
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">Only if Profit &gt; $400</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Calculates your 15.3% Self-Employment Tax (Social Security &amp; Medicare). <strong>If you have a net loss or profit under $400, you owe $0 SE tax and this form is $0.</strong>
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                            Schedule 1 (Form 1040)
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">Additional Income/Loss</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Line 3 pulls your Schedule C profit (or negative loss) onto Form 1040 Line 8. Line 15 deducts 50% of any SE tax paid from your adjusted gross income (AGI).
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5 md:col-span-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                            Form 1040-ES (Estimated Quarterly Vouchers)
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">Apr 15 / Jun 15 / Sep 15 / Jan 15</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Quarterly payment vouchers to pay estimated taxes as you earn throughout the year. You only need to pay these if you anticipate owing &gt;$1,000 at year-end. If you are operating at a net loss, you owe $0 quarterly payments.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Line-by-Line: Which Values From GlassExpense To Put On Each Form */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-emerald-400" />
                      Line-by-Line: Which Values From GlassExpense To Put On Each IRS Form:
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-white/5 text-gray-400 text-[10px] uppercase tracking-wider border-b border-white/10 font-semibold">
                          <tr>
                            <th className="py-2.5 px-3">IRS Form &amp; Line</th>
                            <th className="py-2.5 px-3">Where It Lives in GlassExpense</th>
                            <th className="py-2.5 px-3 text-right">Your Live Value</th>
                            <th className="py-2.5 px-3">What This Line Means</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-gray-300">
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule C, Line 1 &amp; 7
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Part I Gross Receipts
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                              ${calc.scheduleC.grossIncome.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Total client invoices, payments, cash, and 1099-NEC receipts received.
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule C, Line 9
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Line 9 Car &amp; Truck
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                              ${calc.scheduleC.lines.line_9_vehicle.deductibleAmount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Vehicle deduction using Standard Mileage ({calc.scheduleC.vehicleBreakdown.milesDriven.toLocaleString()} miles) or Actual Fuel/Repairs.
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule C, Line 22
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Line 22 Supplies
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                              ${calc.scheduleC.lines.line_22_supplies.deductibleAmount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Job materials, hardware, consumables, and building supplies.
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule C, Line 27a / Part V
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Line 27a Other Expenses
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                              ${calc.scheduleC.lines.line_27a_other.deductibleAmount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Other allowable business expenses qualifying under safe harbor ($2,500/item limit).
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule C, Line 28
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Total Allowable
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-300">
                              ${calc.scheduleC.totalAllowableExpenses.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Total allowable write-offs deducted from your gross income.
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02] bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-emerald-400 whitespace-nowrap">
                              Schedule C, Line 31 &amp; Sched 1 Line 3
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Schedule C Tab</span> &rarr; Net Business Profit
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                              ${calc.scheduleC.netBusinessProfit.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-300 text-[11px] font-semibold">
                              {calc.scheduleC.netBusinessProfit < 0
                                ? 'Net Business Loss! Flows as negative onto Form 1040 Line 8 to reduce W-2 wages.'
                                : 'Net Business Profit! Subject to income tax & Self-Employment tax.'}
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule SE, Line 12
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Overview Tab</span> &rarr; Total SE Tax
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-300">
                              ${calc.selfEmployment.totalSETax.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              Social Security (12.4%) &amp; Medicare (2.9%). Flows to Form 1040 Schedule 2 Line 4.
                            </td>
                          </tr>
                          <tr className="hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-bold text-purple-300 whitespace-nowrap">
                              Schedule 1, Line 15
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-medium text-white">Overview Tab</span> &rarr; 50% SE Deduction
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                              -${calc.selfEmployment.aboveTheLineDeduction.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400 text-[11px]">
                              50% of your SE tax is deducted above-the-line to reduce your personal AGI.
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Deep-Dive: Filing with Net Losses */}
                  <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/25 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs uppercase tracking-wider">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Beginner Rule: How To File With Net Losses (When Expenses &gt; Revenue)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-300">
                      <div className="p-3 rounded-lg bg-black/30 border border-white/5 space-y-1">
                        <span className="font-bold text-white block">1. You Owe $0 Business Tax</span>
                        <p className="text-gray-400 text-[11px]">
                          The IRS never taxes a business on a loss. Because your Net Profit is negative, you owe <strong>$0 in Self-Employment tax</strong> and <strong>$0 in federal business income tax</strong>.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-black/30 border border-white/5 space-y-1">
                        <span className="font-bold text-white block">2. Check Line 32a ("At-Risk")</span>
                        <p className="text-gray-400 text-[11px]">
                          On Schedule C Line 32, check Box <strong>32a: "All investment is at risk."</strong> This simply certifies that you funded your tools, gas, and supplies with your own money and are entitled to deduct the full loss.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-black/30 border border-white/5 space-y-1">
                        <span className="font-bold text-emerald-300 block">3. Can Increase Your Tax Refund!</span>
                        <p className="text-gray-400 text-[11px]">
                          If you worked a <strong>W-2 job earlier this year</strong> (or your spouse has W-2 income), your negative business loss subtracts directly from your W-2 wages on Form 1040 Line 8. This lowers your total taxable income, often yielding a <strong>larger refund check</strong> of your W-2 withholdings!
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* How to Actually Submit (2 Practical Paths) */}
                  <div className="p-5 rounded-xl bg-white/5 border border-white/10 space-y-3">
                    <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                      <ExternalLink className="w-4 h-4 text-[#7c3bed]" />
                      How To Submit Your Return (2 Practical Options):
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-2">
                        <span className="font-bold text-purple-300 block">Path A: Self-Filing (FreeTaxUSA, TurboTax, TaxSlayer)</span>
                        <p className="text-gray-400 text-[11px]">
                          In your tax software wizard, select <em>"I was self-employed / had 1099 or business income"</em>. When it prompts you for Schedule C questions, simply enter the category totals shown in the GlassExpense table above.
                        </p>
                        <div className="text-[11px] text-gray-500">
                          &bull; Enter gross receipts into Income.<br />
                          &bull; Enter mileage &amp; supplies into Expenses.<br />
                          &bull; Check box 32a if prompted about at-risk investment.
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-2">
                        <span className="font-bold text-emerald-300 block">Path B: Handing Off To a CPA or Tax Preparer</span>
                        <p className="text-gray-400 text-[11px]">
                          You don't have to fill out any IRS forms by hand. Go to the <strong>IRS Package &amp; Audit Ledger</strong> tab in GlassExpense and click <strong>"Print Tax Package"</strong> or <strong>"Export CSV"</strong>.
                        </p>
                        <div className="text-[11px] text-gray-500">
                          &bull; The CPA receives the complete IRS Schedule C summary.<br />
                          &bull; Includes Schedule SE calculation.<br />
                          &bull; Includes the audit defense itemized ledger with attached receipts.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SINGLE-MEMBER LLC GUIDE */}
              {guideEntityTab === 'llc' && (
                <div className="space-y-6">
                  {/* Entity Overview Banner */}
                  <div className="p-5 rounded-xl bg-teal-500/10 border border-teal-500/20 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-teal-300 uppercase tracking-wider">
                        Option 2: Single-Member LLC (Disregarded Entity)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-200 border border-teal-500/30 font-medium">
                          State Legal Liability Shield
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                          100% Pass-Through on Form 1040
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      A <strong>Single-Member LLC (SMLLC)</strong> is registered with your state secretary of state to protect your personal home, car, and savings from business lawsuits or vendor debts. However, for <strong>federal income taxes</strong>, the IRS treats an SMLLC as a <strong>"Disregarded Entity"</strong> by default. This means you do <em>not</em> file a separate corporate return. Your federal tax forms and line-by-line values are <strong>100% IDENTICAL to a Sole Proprietorship</strong>.
                    </p>
                  </div>

                  {/* Documents Checklist for LLC */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-teal-400" />
                      Documents You File for an LLC:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <span className="font-bold text-white block">1. Federal Return (Form 1040 + Schedule C)</span>
                        <p className="text-gray-400 text-[11px]">
                          Exactly like a Sole Proprietor, you file <strong>Form 1040</strong> with <strong>Schedule C</strong> and <strong>Schedule SE</strong>. Any 1099-NEC forms issued to your LLC's EIN or your SSN are entered on Line 1.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <span className="font-bold text-teal-300 block">2. State Annual LLC Report / Franchise Tax</span>
                        <p className="text-gray-400 text-[11px]">
                          Unlike Sole Proprietors, states typically require an annual renewal or report to keep your LLC in good standing. Depending on your state, this ranges from a simple $25 fee to California's $800 annual minimum tax.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5 md:col-span-2">
                        <span className="font-bold text-white block">3. Pass-Through of Profits &amp; Losses</span>
                        <p className="text-gray-400 text-[11px]">
                          All profits or losses pass through directly to you. If your LLC has a net loss this year (${Math.abs(calc.scheduleC.netBusinessProfit).toFixed(2)}), it passes straight through to your personal 1040 and can offset previous W-2 job wages.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Values Mapping */}
                  <div className="p-4 rounded-xl bg-black/20 border border-white/10 space-y-2 text-xs">
                    <span className="font-bold text-white block">Where to enter GlassExpense values for your LLC:</span>
                    <p className="text-gray-400 text-[11px]">
                      Because your Single-Member LLC files on Schedule C, use the exact same values shown in the <strong>Sole Proprietor Mapping Table</strong> above. In your tax software, enter your LLC Name and EIN (or SSN) in Part I of Schedule C.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: S-CORPORATION GUIDE */}
              {guideEntityTab === 'scorp' && (
                <div className="space-y-6">
                  {/* Entity Overview Banner */}
                  <div className="p-5 rounded-xl bg-gradient-to-r from-amber-500/15 to-purple-500/15 border border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                        Option 3: S-Corporation (Form 1120-S Corporate Election)
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-medium">
                          Separate Corporate Return (Due March 15)
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30 font-medium">
                          FICA Tax Savings on Profit
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">
                      An <strong>S-Corporation</strong> is a specialized tax election (filed via IRS Form 2553) typically chosen by growing businesses once net profits consistently exceed <strong>$60,000–$80,000/year</strong>. Instead of paying the 15.3% Self-Employment tax on ALL profits, you become a W-2 employee of your company. You pay yourself a <em>"Reasonable Officer Salary"</em> (subject to payroll tax), while the remaining profits pass through as <em>Shareholder Distributions</em> (<strong>100% exempt from the 15.3% SE tax</strong>).
                    </p>
                  </div>

                  {/* Documents Checklist for S-Corp */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-400" />
                      Official Documents Filed Under an S-Corp:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-amber-300 block">Form 1120-S</span>
                          <span className="text-[10px] text-amber-400 font-mono font-bold">Due March 15!</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          The S-Corporation's separate annual federal tax return. Reports business revenues, officer compensation (Line 7), and deductions.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-purple-300 block">Schedule K-1 (Form 1120-S)</span>
                          <span className="text-[10px] text-gray-400 font-mono">Issued to Shareholder</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Generated by Form 1120-S and given to you. Reports your share of net corporate profits flowing onto your personal return (exempt from SE tax).
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white block">Form W-2 &amp; W-3 (Officer Payroll)</span>
                          <span className="text-[10px] text-gray-400 font-mono">Due January 31</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Your S-Corp must run formal payroll and issue you a W-2 for your reasonable officer salary, withholding Social Security and Medicare.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white block">Form 1040 (Personal Return)</span>
                          <span className="text-[10px] text-gray-400 font-mono">Due April 15</span>
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Your personal return. Line 1a reports your W-2 officer salary, and Schedule E (Page 2) reports your Schedule K-1 net profit distribution.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* S-Corp Values From GlassExpense */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-emerald-400" />
                      Line-by-Line: Where GlassExpense S-Corp Values Go:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Form 1120-S Line 1a</span>
                        <div className="text-base font-bold text-white font-mono">${calc.scheduleC.grossRevenue.toFixed(2)}</div>
                        <p className="text-[11px] text-gray-400">Total gross receipts from invoices &amp; jobs.</p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Form 1120-S Line 7</span>
                        <div className="text-base font-bold text-purple-300 font-mono">${(profileSettings?.scorp_officer_salary || 0).toFixed(2)}</div>
                        <p className="text-[11px] text-gray-400">Officer Compensation deducted on corporate return.</p>
                      </div>

                      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-1">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Form 1120-S Line 19</span>
                        <div className="text-base font-bold text-rose-300 font-mono">${calc.scheduleC.totalAllowableExpenses.toFixed(2)}</div>
                        <p className="text-[11px] text-gray-400">Itemized business deductions &amp; write-offs.</p>
                      </div>
                    </div>
                  </div>

                  {/* S-Corp Live Tax Savings Insight */}
                  {calc.scorpSummary && (
                    <div className="p-5 rounded-xl bg-gradient-to-r from-emerald-500/10 via-purple-500/10 to-transparent border border-emerald-500/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                          S-Corp Tax Optimization Potential:
                        </span>
                        <span className="text-sm font-bold font-mono text-emerald-400">
                          ${calc.scorpSummary.ficaTaxSavingsVsSoleProp.toFixed(2)} in FICA Tax Savings
                        </span>
                      </div>
                      <p className="text-xs text-gray-300">
                        By paying yourself an officer salary of ${(calc.scorpSummary.officerSalary || 0).toLocaleString()} and passing through ${(calc.scorpSummary.k1OrdinaryIncome || 0).toLocaleString()} in K-1 distributions, you shield ${(calc.scorpSummary.k1OrdinaryIncome || 0).toLocaleString()} from the 15.3% Self-Employment tax.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SCHEDULE C & DEDUCTIONS LEDGER */}
        {activeTab === 'schedule_c' && calc && (
          <div className="space-y-6">
            {/* Unclaimed Deductions Discovery Callout */}
            {unclaimedSuggestions.length > 0 && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                      Deduction Discovery: {unclaimedSuggestions.length} Untagged Potential Write-Offs
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                        +${unclaimedSuggestions.reduce((acc, s) => acc + s.estimatedTaxSavings, 0).toFixed(2)} savings
                      </span>
                    </h4>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Receipts matched IRS write-off categories (gas, building supplies, software). Review and claim them into your Schedule C deductions.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsDeductionDiscoveryModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shrink-0 flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Review & Claim ({unclaimedSuggestions.length})</span>
                </button>
              </div>
            )}

            {/* Schedule C Part I: Gross Income & Sales */}
            <div className="rounded-2xl bg-gradient-to-br from-[#1a1c23] to-[#161820] border border-white/10 p-6 backdrop-blur-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Schedule C Part I: Gross Receipts & Business Income
                    </h3>
                    <p className="text-xs text-gray-400">
                      Report all client payments, invoices, cash, and 1099-NEC receipts received during {taxYear}.
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs text-gray-400">Part I Gross Income (Line 7):</span>
                  <div className="text-xl font-black text-emerald-400 font-mono">
                    ${calc.scheduleC.grossIncome.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                    Tracked Invoiced Revenue
                  </span>
                  <div className="text-2xl font-black text-white font-mono">
                    ${calc.scheduleC.grossRevenue.toFixed(2)}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Auto-tallied from completed invoices and revenue entries in GlassExpense.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-purple-300 block mb-1">
                    Additional 1099 / Cash (Line 1)
                  </label>
                  <div className="relative mt-2">
                    <span className="absolute left-3 top-2 text-gray-400 text-xs font-mono">$</span>
                    <input
                      type="number"
                      value={profileSettings?.additional_gross_income ?? ''}
                      onChange={(e) => updateSettings({ additional_gross_income: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="w-full bg-[#121317] border border-white/10 rounded-xl pl-7 pr-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    External payments, check/cash receipts, or untracked 1099-NEC compensation.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                    Returns & Allowances (Line 2)
                  </label>
                  <div className="relative mt-2">
                    <span className="absolute left-3 top-2 text-gray-400 text-xs font-mono">$</span>
                    <input
                      type="number"
                      value={profileSettings?.returns_and_allowances ?? ''}
                      onChange={(e) => updateSettings({ returns_and_allowances: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="w-full bg-[#121317] border border-white/10 rounded-xl pl-7 pr-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Client refunds, disputed invoice reversals, or cash discounts provided.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                    Cost of Goods Sold (Line 4)
                  </label>
                  <div className="relative mt-2">
                    <span className="absolute left-3 top-2 text-gray-400 text-xs font-mono">$</span>
                    <input
                      type="number"
                      value={profileSettings?.cost_of_goods_sold ?? ''}
                      onChange={(e) => updateSettings({ cost_of_goods_sold: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="w-full bg-[#121317] border border-white/10 rounded-xl pl-7 pr-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Direct inventory purchases or wholesale raw materials sold to clients.
                  </p>
                </div>
              </div>
            </div>

            {/* Vehicle Deduction Optimizer Card */}
            <div className="rounded-2xl bg-gradient-to-br from-[#1a1c23] to-[#161820] border border-white/10 p-6 backdrop-blur-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-[#7c3bed]/20 text-[#7c3bed] border border-[#7c3bed]/30">
                    <Car className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Vehicle & Mileage Deduction Optimizer (Line 9)
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                        IRS Notice {taxYear === 2025 ? '2025-05' : ''} (${(STANDARD_MILEAGE_RATES[taxYear] || 0.70).toFixed(2)}/mi)
                      </span>
                    </h3>
                    <p className="text-xs text-gray-400">
                      Standard Mileage rate covers fuel, oil, depreciation & wear. Actual Expenses covers gas, maintenance & insurance.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">Method:</span>
                  <select
                    value={profileSettings?.vehicle_deduction_method || 'auto_best'}
                    onChange={(e) => updateSettings({ vehicle_deduction_method: e.target.value })}
                    className="bg-[#121317] border border-white/10 text-white rounded-lg px-2.5 py-1.5"
                  >
                    <option value="auto_best">Auto-Select Highest Write-off</option>
                    <option value="standard_mileage">Standard Mileage Only</option>
                    <option value="actual_expenses">Actual Expenses Only</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                {/* Method A: Standard Mileage */}
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    calc.scheduleC.vehicleBreakdown.methodUsed === 'standard_mileage'
                      ? 'bg-[#7c3bed]/10 border-[#7c3bed]/40 shadow-lg shadow-[#7c3bed]/10'
                      : 'bg-white/5 border-white/5 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                      Method A: Standard Mileage
                    </span>
                    {calc.scheduleC.vehicleBreakdown.optimalMethod === 'standard_mileage' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-black text-white mt-2">
                    ${calc.scheduleC.vehicleBreakdown.standardMileageDeduction.toFixed(2)}
                  </div>
                  <div className="mt-3">
                    <label className="text-[11px] text-gray-400 block mb-1">Business Miles Driven in {taxYear}:</label>
                    <input
                      type="number"
                      value={profileSettings?.business_miles || ''}
                      onChange={(e) => updateSettings({ business_miles: parseFloat(e.target.value) || 0 })}
                      placeholder="e.g. 12000"
                      className="w-full bg-[#121317] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white"
                    />
                  </div>
                </div>

                {/* Method B: Actual Expenses */}
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    calc.scheduleC.vehicleBreakdown.methodUsed === 'actual_expenses'
                      ? 'bg-[#7c3bed]/10 border-[#7c3bed]/40 shadow-lg shadow-[#7c3bed]/10'
                      : 'bg-white/5 border-white/5 opacity-70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                      Method B: Actual Expenses
                    </span>
                    {calc.scheduleC.vehicleBreakdown.optimalMethod === 'actual_expenses' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-black text-white mt-2">
                    ${calc.scheduleC.vehicleBreakdown.actualTotal.toFixed(2)}
                  </div>
                  <div className="mt-3 text-[11px] text-gray-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Gasoline & Fuel:</span>
                      <span className="font-mono text-white">${calc.scheduleC.vehicleBreakdown.actualGasAndFuel.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Repairs & Maintenance:</span>
                      <span className="font-mono text-white">${calc.scheduleC.vehicleBreakdown.actualMaintenance.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Auto Insurance:</span>
                      <span className="font-mono text-white">${calc.scheduleC.vehicleBreakdown.actualInsurance.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Parking & Tolls & Total Deduction */}
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Parking & Highway Tolls
                    </span>
                    <div className="text-sm font-semibold text-white mt-1">
                      +${calc.scheduleC.vehicleBreakdown.parkingAndTolls.toFixed(2)}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      100% deductible on top of whichever vehicle method you choose.
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/10">
                    <span className="text-xs text-gray-400">Total Vehicle Deduction (Line 9):</span>
                    <div className="text-xl font-black text-emerald-400">
                      ${calc.scheduleC.vehicleBreakdown.totalVehicleDeduction.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Schedule C Itemized Breakdown Table */}
            <div className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-6 backdrop-blur-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#7c3bed]" />
                    Schedule C Allowable Deductions Ledger
                  </h3>
                  <p className="text-xs text-gray-400">
                    Itemized categories mapped directly to IRS Form 1040 Schedule C lines
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsTagMappingModalOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-[#121317] border border-white/10 text-xs text-gray-300 hover:text-white flex items-center gap-1.5 transition-colors"
                  >
                    <Tag className="w-3.5 h-3.5 text-[#7c3bed]" />
                    <span>Tag Mappings</span>
                  </button>
                  <div className="text-right">
                    <span className="text-xs text-gray-400">Total Allowable:</span>
                    <span className="text-base font-bold text-emerald-400 ml-2">
                      ${calc.scheduleC.totalAllowableExpenses.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-white/5 mt-2">
                {(Object.keys(calc.scheduleC.lines) as ScheduleCLine[]).map((lineKey) => {
                  const item = calc.scheduleC.lines[lineKey];
                  const meta = SCHEDULE_C_LINE_METADATA[lineKey];
                  const isExpanded = expandedLine === lineKey;
                  const lineTransactions = (calcData?.transactions || []).filter(
                    (t: any) => t.assigned_schedule_c_line === lineKey && t.entry_type !== 'income'
                  );

                  return (
                    <div key={lineKey} className="py-3.5">
                      <div
                        className="flex items-center justify-between cursor-pointer hover:bg-white/[0.02] p-2 rounded-xl transition-colors"
                        onClick={() => setExpandedLine(isExpanded ? null : lineKey)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-16 text-xs font-mono font-bold text-[#7c3bed]">{item.lineNumber}</span>
                          <div>
                            <div className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                              {item.title}
                              {item.isFiftyPercentMeal && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                  50% MEAL LIMIT
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {item.transactionCount} transaction(s) | {meta?.deductibilityRule}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs sm:text-sm font-bold text-emerald-400">
                              ${item.deductibleAmount.toFixed(2)}
                            </div>
                            {item.grossAmount !== item.deductibleAmount && (
                              <div className="text-[10px] text-gray-500 line-through">
                                ${item.grossAmount.toFixed(2)} gross
                              </div>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </div>

                      {/* Expandable Guidance & Transaction List Accordion */}
                      {isExpanded && meta && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 ml-2 sm:ml-4 p-4 rounded-xl bg-white/5 border border-white/5 text-xs text-gray-300 space-y-4"
                        >
                          {/* Guidance rules */}
                          <div className="space-y-1.5 bg-black/20 p-3 rounded-lg border border-white/5">
                            <div className="flex items-center gap-1.5 text-[#7c3bed] font-semibold">
                              <Info className="w-3.5 h-3.5" />
                              <span>IRS Qualification Rule:</span>
                            </div>
                            <p className="text-gray-300">{meta.tooltip}</p>
                            <div className="text-[11px] text-gray-400">
                              <span className="font-semibold text-gray-300">Examples: </span>
                              {meta.examples.join(' • ')}
                            </div>
                          </div>

                          {/* Specific Note for Vehicle or Home Office */}
                          {lineKey === 'line_9_vehicle' && (
                            <div className="p-3 rounded-lg bg-[#7c3bed]/10 border border-[#7c3bed]/20 text-[11px] text-purple-200">
                              Vehicle Deduction includes Standard Mileage (${calc.scheduleC.vehicleBreakdown.standardMileageDeduction.toFixed(2)}) + Parking/Tolls (${calc.scheduleC.vehicleBreakdown.parkingAndTolls.toFixed(2)}) using the {calc.scheduleC.vehicleBreakdown.methodUsed === 'standard_mileage' ? 'Standard Mileage' : 'Actual Expenses'} method. Individual receipts categorized to vehicle are listed below:
                            </div>
                          )}
                          {lineKey === 'line_30_home_office' && (
                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-200">
                              Simplified Home Office Deduction: ${calc.scheduleC.homeOfficeDeduction.toFixed(2)} based on {profileSettings?.home_office_sqft || 0} sq. ft. of dedicated space ($5/sq ft).
                            </div>
                          )}

                          {/* Transactions Auto-Categorized to this Line */}
                          <div>
                            <div className="flex items-center justify-between pb-2 border-b border-white/10">
                              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <Receipt className="w-3.5 h-3.5 text-[#7c3bed]" />
                                Transactions in this Category ({lineTransactions.length})
                              </span>
                              <span className="text-[11px] text-gray-400">
                                Reassign category below to override auto-categorization
                              </span>
                            </div>

                            {lineTransactions.length === 0 ? (
                              <div className="py-4 text-center text-gray-400 text-xs italic">
                                No individual expense transactions currently categorized into {meta.lineNumber}.
                              </div>
                            ) : (
                              <div className="overflow-x-auto mt-2 rounded-lg border border-white/10">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-black/30 text-gray-400 text-[10px] uppercase tracking-wider border-b border-white/10">
                                    <tr>
                                      <th className="py-2 px-3">Date</th>
                                      <th className="py-2 px-3">Job / Invoice</th>
                                      <th className="py-2 px-3">Description</th>
                                      <th className="py-2 px-3 text-right">Amount</th>
                                      <th className="py-2 px-3 text-center">Receipt</th>
                                      <th className="py-2 px-3">Type</th>
                                      <th className="py-2 px-3">Reassign Category</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 text-gray-300">
                                    {lineTransactions.map((t: any) => (
                                      <tr key={t.id} className="hover:bg-white/[0.02]">
                                        <td className="py-2 px-3 font-mono text-[11px] whitespace-nowrap">
                                          {t.date || (t.created_at ? t.created_at.split(' ')[0] : '')}
                                        </td>
                                        <td className="py-2 px-3 whitespace-nowrap">
                                          <div className="font-medium text-white">{t.job_title}</div>
                                          {t.job_invoice_tag && (
                                            <span className="text-[10px] text-gray-500 font-mono">
                                              {t.job_invoice_tag}
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 max-w-xs truncate">{t.description || '—'}</td>
                                        <td className="py-2 px-3 text-right font-mono font-bold text-white whitespace-nowrap">
                                          ${t.amount.toFixed(2)}
                                          {item.isFiftyPercentMeal && (
                                            <span className="text-[10px] text-amber-400 block font-normal">
                                              (${(t.amount * 0.5).toFixed(2)} ded.)
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                          {t.receipt_url ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleViewReceipt(t.receipt_url, t.job_id, Boolean(t.is_encrypted));
                                              }}
                                              className="p-1 rounded bg-white/5 hover:bg-[#7c3bed]/20 text-[#7c3bed]"
                                              title="View Receipt"
                                            >
                                              <Eye className="w-3.5 h-3.5" />
                                            </button>
                                          ) : (
                                            <span className="text-gray-600">—</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 whitespace-nowrap">
                                          {t.is_manually_assigned ? (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                              Custom Assigned
                                            </span>
                                          ) : (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                                              Auto-Assigned
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 whitespace-nowrap">
                                          <select
                                            value={t.assigned_schedule_c_line || lineKey}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              handleReassignExpense(t.id, e.target.value);
                                            }}
                                            disabled={reassigningExpenseId === t.id}
                                            onClick={(e) => e.stopPropagation()}
                                            className="bg-[#121317] border border-white/10 text-white rounded-lg px-2 py-1 text-xs focus:border-[#7c3bed] focus:outline-none"
                                          >
                                            <option value="auto">Auto-Categorize (Reset)</option>
                                            {(Object.keys(SCHEDULE_C_LINE_METADATA) as ScheduleCLine[]).map((sk) => (
                                              <option key={sk} value={sk}>
                                                {SCHEDULE_C_LINE_METADATA[sk].lineNumber}: {SCHEDULE_C_LINE_METADATA[sk].title}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB: SOLE PROPRIETOR TAX FORMS (1040 / SE / C / 1040-ES) */}
        {activeTab === 'sole_prop_forms' && calc && (
          <div className="space-y-6">
            {/* Top Sub-Navigation Header */}
            <div className="p-6 rounded-2xl bg-gradient-to-br from-[#1a1c23] to-[#161820] border border-white/10 backdrop-blur-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-[#7c3bed]" />
                    Sole Proprietorship Official IRS Tax Forms Hub
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Interactive digital tax forms for Schedule C, Schedule SE, Form 1040, and Form 1040-ES with editable adjustment fields.
                  </p>
                </div>

                {/* Sub-tab Pills */}
                <div className="flex items-center bg-[#121317] border border-white/10 rounded-xl p-1 shrink-0 overflow-x-auto">
                  {[
                    { id: 'schedule_c', label: 'Schedule C' },
                    { id: 'schedule_se', label: 'Schedule SE' },
                    { id: 'form_1040', label: 'Form 1040 & Sch 1' },
                    { id: 'form_1040_es', label: 'Form 1040-ES' }
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setSolePropSubTab(st.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                        solePropSubTab === st.id
                          ? 'bg-[#7c3bed] text-white shadow-md shadow-[#7c3bed]/30'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-tab 1: Schedule C Digital Form */}
              {solePropSubTab === 'schedule_c' && (
                <div className="mt-6 space-y-6">
                  {/* Form Banner */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-white uppercase tracking-wider">Schedule C (Form 1040)</span>
                      <span className="text-gray-400 ml-2">Profit or Loss From Business (Sole Proprietorship)</span>
                    </div>
                    <div className="font-mono text-gray-400">
                      OMB No. 1545-0074 | Tax Year {taxYear} | Accounting Method: Cash
                    </div>
                  </div>

                  {/* Part I: Income */}
                  <div className="rounded-xl bg-[#121317] border border-white/10 p-5 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 border-b border-white/10 pb-2">
                      Part I: Income
                    </h4>
                    <div className="space-y-3 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-[#7c3bed]">Line 1:</strong> Gross receipts or sales (Tracked Project Invoices):
                        </span>
                        <span className="font-mono font-bold text-white">${calc.scheduleC.grossRevenue.toFixed(2)}</span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-purple-300">Line 1 (Adjustment):</strong> Additional 1099-NEC / Cash / Untracked Gross Receipts:
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 font-mono">$</span>
                          <input
                            type="number"
                            value={profileSettings?.additional_gross_income ?? ''}
                            onChange={(e) => updateSettings({ additional_gross_income: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="w-32 bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 2:</strong> Returns and allowances (Refunds / Client Discounts):
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 font-mono">$</span>
                          <input
                            type="number"
                            value={profileSettings?.returns_and_allowances ?? ''}
                            onChange={(e) => updateSettings({ returns_and_allowances: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="w-32 bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 4:</strong> Cost of goods sold (COGS - Wholesale Materials):
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 font-mono">$</span>
                          <input
                            type="number"
                            value={profileSettings?.cost_of_goods_sold ?? ''}
                            onChange={(e) => updateSettings({ cost_of_goods_sold: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="w-32 bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 font-bold">
                        <span className="text-emerald-300">
                          <strong className="font-mono">Line 7:</strong> Gross income (Line 1 - Line 2 - Line 4):
                        </span>
                        <span className="font-mono text-emerald-400 text-sm">${calc.scheduleC.grossIncome.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Part II: Expenses Summary */}
                  <div className="rounded-xl bg-[#121317] border border-white/10 p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
                        Part II: Expenses (Lines 8 through 30)
                      </h4>
                      <span className="text-xs text-gray-400">
                        Total Expenses: <strong className="font-mono text-white">${calc.scheduleC.totalAllowableExpenses.toFixed(2)}</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {(Object.keys(calc.scheduleC.lines) as ScheduleCLine[]).map((lk) => {
                        const item = calc.scheduleC.lines[lk];
                        return (
                          <div key={lk} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-[#7c3bed] mr-2">{item.lineNumber}:</span>
                              <span className="text-gray-300">{item.title}</span>
                              <span className="text-[10px] text-gray-500 ml-1">({item.transactionCount})</span>
                            </div>
                            <span className="font-mono font-bold text-white">${item.deductibleAmount.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Part III: Net Profit */}
                  <div className="p-5 rounded-xl bg-gradient-to-r from-emerald-500/15 to-[#7c3bed]/15 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-white">Line 31: Net Profit or (Loss)</h4>
                      <p className="text-xs text-gray-300 mt-0.5">
                        Gross Income (${calc.scheduleC.grossIncome.toFixed(2)}) minus Total Expenses (${calc.scheduleC.totalAllowableExpenses.toFixed(2)}).
                        Transfers to Form 1040 Schedule 1 Line 3 and Schedule SE Line 2.
                      </p>
                    </div>
                    <div className="text-2xl font-black text-emerald-400 font-mono shrink-0">
                      ${calc.scheduleC.netBusinessProfit.toFixed(2)}
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 2: Schedule SE Digital Form */}
              {solePropSubTab === 'schedule_se' && (
                <div className="mt-6 space-y-6">
                  {/* Form Banner */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-white uppercase tracking-wider">Schedule SE (Form 1040)</span>
                      <span className="text-gray-400 ml-2">Self-Employment Tax</span>
                    </div>
                    <div className="font-mono text-gray-400">
                      Social Security (12.4%) & Medicare (2.9%) FICA Taxes
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#121317] border border-white/10 p-5 space-y-3 text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-[#7c3bed]">Line 2:</strong> Net profit or (loss) from Schedule C, Line 31:
                      </span>
                      <span className="font-mono font-bold text-white">${calc.selfEmployment.scheduleCNetProfit.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-[#7c3bed]">Line 4a:</strong> Multiply Line 2 by 92.35% (0.9235 statutory deduction):
                      </span>
                      <span className="font-mono font-bold text-purple-300">${calc.selfEmployment.netEarningsSubjectToSE.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-gray-400">Line 5a:</strong> Maximum Social Security tax wage base limit ({taxYear}):
                      </span>
                      <span className="font-mono text-gray-300">${calc.selfEmployment.oasdiCap.toLocaleString()}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-gray-400">Line 5b:</strong> Total Social Security wages from Form(s) W-2 (Box 3/7 offset):
                      </span>
                      <span className="font-mono text-gray-300">-${calc.selfEmployment.w2SsWagesOffset.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-gray-400">Line 5c:</strong> Remaining Social Security cap available for self-employment:
                      </span>
                      <span className="font-mono text-white">${calc.selfEmployment.remainingOasdiCap.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-[#7c3bed]">Line 6:</strong> Social Security tax (12.4% on taxable self-employment earnings):
                      </span>
                      <span className="font-mono font-bold text-white">${calc.selfEmployment.ssTax.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-[#7c3bed]">Line 10:</strong> Medicare tax (2.9% on net self-employment earnings, uncapped):
                      </span>
                      <span className="font-mono font-bold text-white">${calc.selfEmployment.medicareTax.toFixed(2)}</span>
                    </div>

                    {calc.selfEmployment.additionalMedicareTax > 0 && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <span className="text-amber-300">
                          <strong className="font-mono">Line 11:</strong> Additional Medicare Tax (0.9% for high income threshold under Form 8959):
                        </span>
                        <span className="font-mono font-bold text-amber-400">${calc.selfEmployment.additionalMedicareTax.toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-[#7c3bed]/15 border border-[#7c3bed]/30 font-bold">
                      <span className="text-purple-200">
                        <strong className="font-mono">Line 12:</strong> Total Self-Employment Tax (Line 6 + Line 10 + Line 11):
                      </span>
                      <span className="font-mono text-purple-300 text-sm">${calc.selfEmployment.totalSETax.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <div>
                        <span className="text-emerald-300 font-bold block">
                          <strong className="font-mono">Line 13:</strong> Deduction for one-half of self-employment tax (50% above-the-line):
                        </span>
                        <span className="text-[11px] text-gray-400">
                          Transferred to Form 1040 Schedule 1 Line 15 to reduce Adjusted Gross Income (AGI).
                        </span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400 text-sm">${calc.selfEmployment.aboveTheLineDeduction.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 3: Form 1040 & Schedule 1 Summary */}
              {solePropSubTab === 'form_1040' && (
                <div className="mt-6 space-y-6">
                  {/* Form Banner */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-white uppercase tracking-wider">Form 1040 & Schedule 1</span>
                      <span className="text-gray-400 ml-2">U.S. Individual Income Tax Return</span>
                    </div>
                    <div className="font-mono text-gray-400">
                      Filing Status: <span className="text-white uppercase font-bold">{calc.filingStatus}</span> | Year: {taxYear}
                    </div>
                  </div>

                  {/* Income Section */}
                  <div className="rounded-xl bg-[#121317] border border-white/10 p-5 space-y-3 text-xs">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 border-b border-white/10 pb-2">
                      Income & Adjustments (Schedule 1)
                    </h4>

                    <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-[#7c3bed]">Line 1z:</strong> Wages, salaries, tips from Form(s) W-2:
                      </span>
                      <span className="font-mono font-bold text-white">${calc.incomeTax.totalW2Wages.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                      <span className="text-gray-300">
                        <strong className="font-mono text-emerald-400">Line 8:</strong> Other income from Schedule 1 Line 3 (Schedule C Net Profit):
                      </span>
                      <span className="font-mono font-bold text-emerald-400">${calc.incomeTax.businessProfit.toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.04] font-bold">
                      <span className="text-white">
                        <strong className="font-mono">Line 9:</strong> Total Income:
                      </span>
                      <span className="font-mono text-white">${calc.incomeTax.grossTotalIncome.toFixed(2)}</span>
                    </div>

                    {/* Schedule 1 Adjustments */}
                    <div className="pt-3 border-t border-white/10 space-y-2">
                      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                        Schedule 1 Part II: Adjustments to Income (Reduces AGI)
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 15:</strong> Deductible part of self-employment tax (50% SE tax):
                        </span>
                        <span className="font-mono text-emerald-400">-${calc.incomeTax.seTaxDeduction.toFixed(2)}</span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-purple-300">Line 16:</strong> Self-employed SEP, SIMPLE, and qualified plans (Retirement):
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 font-mono">$</span>
                          <input
                            type="number"
                            value={profileSettings?.retirement_contributions ?? ''}
                            onChange={(e) => updateSettings({ retirement_contributions: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="w-32 bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <div>
                          <span className="text-gray-300">
                            <strong className="font-mono text-purple-300">Line 17:</strong> Self-employed health insurance deduction:
                          </span>
                          <p className="text-[10px] text-gray-500">
                            100% deductible for medical, dental, and qualified long-term care insurance premiums.
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 font-mono">$</span>
                          <input
                            type="number"
                            value={profileSettings?.self_employed_health_insurance ?? ''}
                            onChange={(e) => updateSettings({ self_employed_health_insurance: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="w-32 bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="flex justify-between items-center p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 font-bold">
                        <span className="text-emerald-300">
                          <strong className="font-mono">Line 11:</strong> Adjusted Gross Income (AGI):
                        </span>
                        <span className="font-mono text-emerald-400 text-sm">${calc.incomeTax.agi.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Taxable Income & Computation */}
                    <div className="pt-3 border-t border-white/10 space-y-2">
                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 12:</strong> Standard Deduction (Status: {calc.filingStatus}):
                        </span>
                        <span className="font-mono text-gray-300">-${calc.incomeTax.standardDeduction.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <div>
                          <span className="text-gray-300">
                            <strong className="font-mono text-gray-400">Line 13:</strong> Qualified Business Income (QBI) Deduction (§199A - 20%):
                          </span>
                          <span className="text-[10px] text-gray-500 block">20% deduction on qualified pass-through business earnings</span>
                        </div>
                        <span className="font-mono text-purple-300">-${calc.incomeTax.qbiDeduction.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.04] font-bold">
                        <span className="text-white">
                          <strong className="font-mono">Line 15:</strong> Taxable Income:
                        </span>
                        <span className="font-mono text-white">${calc.incomeTax.taxableIncome.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-[#7c3bed]">Line 16:</strong> Regular Federal Income Tax (Progressive Brackets):
                        </span>
                        <span className="font-mono font-bold text-white">${calc.incomeTax.federalIncomeTax.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-purple-400">Line 23:</strong> Other taxes, including Self-Employment Tax (Schedule SE):
                        </span>
                        <span className="font-mono font-bold text-purple-400">+${calc.selfEmployment.totalSETax.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 rounded-lg bg-[#7c3bed]/15 border border-[#7c3bed]/30 font-bold">
                        <span className="text-purple-200">
                          <strong className="font-mono">Line 24:</strong> Total Federal Tax Liability:
                        </span>
                        <span className="font-mono text-purple-300 text-sm">${calc.reconciliation.totalFederalTaxLiability.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 25d:</strong> Federal income tax withheld from Form(s) W-2:
                        </span>
                        <span className="font-mono text-gray-300">-${calc.reconciliation.totalW2FedWithholding.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center p-2 rounded-lg bg-white/[0.02]">
                        <span className="text-gray-300">
                          <strong className="font-mono text-gray-400">Line 26:</strong> {taxYear} Estimated tax payments (Form 1040-ES):
                        </span>
                        <span className="font-mono text-gray-300">-${calc.reconciliation.estimatedPaymentsMade.toFixed(2)}</span>
                      </div>

                      <div className={`p-4 rounded-xl flex items-center justify-between font-bold border ${
                        calc.reconciliation.isRefund ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-rose-500/15 border-rose-500/30'
                      }`}>
                        <div>
                          <div className={`text-sm ${calc.reconciliation.isRefund ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {calc.reconciliation.isRefund ? 'Line 34: Estimated Overpayment (Refund)' : 'Line 37: Estimated Amount You Owe'}
                          </div>
                          <span className="text-[11px] text-gray-400 font-normal">
                            Net position after all withholdings and prepayments
                          </span>
                        </div>
                        <div className={`text-2xl font-black font-mono ${calc.reconciliation.isRefund ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {calc.reconciliation.isRefund ? '+' : '-'}${calc.reconciliation.refundOrBalanceAmount.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 4: Form 1040-ES & Safe Harbor */}
              {solePropSubTab === 'form_1040_es' && (
                <div className="mt-6 space-y-6">
                  {/* Form Banner */}
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-white uppercase tracking-wider">Form 1040-ES</span>
                      <span className="text-gray-400 ml-2">Estimated Tax for Individuals & Safe Harbor Protection</span>
                    </div>
                    <div className="font-mono text-gray-400">
                      Avoid IRS Form 2210 Underpayment Penalties
                    </div>
                  </div>

                  {/* Safe Harbor Rule Engine */}
                  <div className="p-5 rounded-xl bg-gradient-to-br from-[#7c3bed]/10 to-indigo-950/20 border border-[#7c3bed]/30 space-y-4 text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-[#7c3bed]" />
                          IRS Safe Harbor Statutory Rule (IRC §6654)
                        </h4>
                        <p className="text-xs text-gray-300 mt-0.5">
                          To avoid penalties, pay at least 90% of current year tax OR {calc.safeHarbor.isAgiOver150k ? '110%' : '100%'} of your prior year tax liability.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 bg-[#121317] border border-white/10 rounded-xl px-3 py-2 shrink-0">
                        <span className="text-gray-400 text-xs">Prior Year Tax: $</span>
                        <input
                          type="number"
                          value={profileSettings?.prior_year_tax_liability || ''}
                          onChange={(e) => updateSettings({ prior_year_tax_liability: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 12000"
                          className="w-28 bg-transparent text-white font-mono text-xs focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                      <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                        <span className="text-[11px] text-gray-400 block">Rule A: 90% Current Year Tax</span>
                        <div className="text-base font-bold text-white font-mono mt-1">
                          ${calc.safeHarbor.currentYear90Pct.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-gray-500">(${(calc.safeHarbor.currentYear90Pct / 4).toFixed(2)} / quarter)</span>
                      </div>

                      <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                        <span className="text-[11px] text-gray-400 block">
                          Rule B: {calc.safeHarbor.isAgiOver150k ? '110%' : '100%'} Prior Year Tax
                        </span>
                        <div className="text-base font-bold text-white font-mono mt-1">
                          ${calc.safeHarbor.priorYearSafeHarborTarget.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-gray-500">(${(calc.safeHarbor.priorYearSafeHarborTarget / 4).toFixed(2)} / quarter)</span>
                      </div>

                      <div className="p-3 rounded-lg bg-[#7c3bed]/20 border border-[#7c3bed]/40">
                        <span className="text-[11px] text-purple-200 font-semibold block">Recommended Safe Harbor Target</span>
                        <div className="text-base font-black text-purple-300 font-mono mt-1">
                          ${calc.safeHarbor.recommendedQuarterly.toFixed(2)} / quarter
                        </div>
                        <span className="text-[10px] text-emerald-400 font-semibold">100% Penalty Protected</span>
                      </div>
                    </div>
                  </div>

                  {/* 4 Quarterly Vouchers with Payment Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {calc.quarterlyVouchers.map((v, i) => {
                      const paymentKey = `q${i + 1}_payment_made`;
                      const paidValue = profileSettings?.[paymentKey] || 0;

                      return (
                        <div
                          key={v.quarter}
                          className="p-5 rounded-2xl bg-[#121317] border border-white/10 flex flex-col justify-between space-y-4 relative"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-black text-white">{v.quarter} Voucher</span>
                              {v.isPaid ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                                  PAID
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                  DUE
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-[#7c3bed] font-medium block mt-1">{v.dueDate}</span>
                            <span className="text-[11px] text-gray-500 block">{v.period}</span>
                          </div>

                          <div className="space-y-2 pt-2 border-t border-white/10 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Target Voucher:</span>
                              <span className="font-mono font-bold text-white">${v.amount.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Safe Harbor:</span>
                              <span className="font-mono text-purple-300">${v.safeHarborAmount.toFixed(2)}</span>
                            </div>

                            <div className="pt-2">
                              <label className="text-[11px] text-gray-400 block mb-1">Actual Paid:</label>
                              <div className="flex items-center gap-1">
                                <span className="text-gray-400 font-mono text-xs">$</span>
                                <input
                                  type="number"
                                  value={paidValue || ''}
                                  onChange={(e) => updateSettings({ [paymentKey]: parseFloat(e.target.value) || 0 })}
                                  placeholder="0.00"
                                  className="w-full bg-[#1a1c23] border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'w2' && (
          <div className="space-y-6">
            {/* Top Hub Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-[#1a1c23]/80 border border-white/10 backdrop-blur-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-[#7c3bed]" />
                  W-2 Wage & Withholding Ingestion Hub
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Scan W-2 forms via Dual OCR (Cloud Vision / On-device Tesseract) or add employment records manually.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleW2FileUpload}
                  accept="image/*,application/pdf"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanningW2}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7c3bed] to-[#4f46e5] text-white text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg shadow-[#7c3bed]/25"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isScanningW2 ? scanStatus || 'Scanning...' : 'Upload / Scan W-2'}</span>
                </button>

                <button
                  onClick={() => openW2Modal()}
                  className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-[#7c3bed]" />
                  <span>Add Manually</span>
                </button>
              </div>
            </div>

            {/* S-Corp Officer Compensation Setting Card (if S-Corp) */}
            {isSCorp && (
              <div className="p-6 rounded-2xl bg-[#7c3bed]/10 border border-[#7c3bed]/30 backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#7c3bed]" />
                    S-Corporation Officer W-2 Reasonable Compensation
                  </h4>
                  <p className="text-xs text-gray-300 mt-1 max-w-xl">
                    As an S-Corp shareholder-employee, IRS regulations require a &ldquo;reasonable salary&rdquo; before taking K-1 distributions.
                    Enter your annual officer W-2 salary below:
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    value={profileSettings?.scorp_officer_salary || ''}
                    onChange={(e) => updateSettings({ scorp_officer_salary: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g. 50000"
                    className="w-36 bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>
            )}

            {/* W-2 Forms List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {w2Forms.map((w2) => (
                <div
                  key={w2.id}
                  className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-5 backdrop-blur-xl relative group hover:border-[#7c3bed]/40 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{w2.employer_name}</span>
                        {w2.is_scorp_officer_w2 === 1 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#7c3bed]/20 text-[#7c3bed] font-bold border border-[#7c3bed]/30">
                            OFFICER W-2
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 font-mono">
                        EIN: {w2.employer_ein || 'N/A'} | Tax Year: {w2.tax_year}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openW2Modal(w2)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white"
                        title="Edit W-2"
                      >
                        <SettingsIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteW2(w2.id)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400"
                        title="Delete W-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10 text-xs">
                    <div>
                      <span className="text-gray-500">Box 1 (Wages):</span>
                      <div className="font-mono font-bold text-white">${w2.wages_box1.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Box 2 (Fed Withheld):</span>
                      <div className="font-mono font-bold text-emerald-400">${w2.fed_withholding_box2.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Box 3 (SS Wages):</span>
                      <div className="font-mono text-gray-300">${w2.ss_wages_box3.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Box 4 (SS Withheld):</span>
                      <div className="font-mono text-gray-300">${w2.ss_withholding_box4.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              ))}

              {w2Forms.length === 0 && (
                <div className="col-span-full py-12 text-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
                  <Briefcase className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No W-2 forms added for {taxYear}.</p>
                  <p className="text-xs text-gray-500 mt-1">Upload a scanned W-2 image or PDF to extract your numbers automatically.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: FORM 1040-ES QUARTERLY VOUCHER PLANNER */}
        {activeTab === 'vouchers' && calc && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#1a1c23]/80 border border-white/10 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[#7c3bed]" />
                  Form 1040-ES: Quarterly Estimated Tax Schedule
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Avoid IRS underpayment penalties under IRC §6654 by paying safe-harbor quarterly installments.
                </p>
              </div>

              <a
                href="https://www.irs.gov/payments/direct-pay"
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-2 shrink-0 shadow-lg shadow-blue-500/20"
              >
                <span>IRS Direct Pay</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {calc.quarterlyVouchers.map((voucher) => (
                <div
                  key={voucher.quarter}
                  className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-5 backdrop-blur-xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-black text-[#7c3bed]">{voucher.quarter}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 font-medium">
                        {voucher.period}
                      </span>
                    </div>
                    <div className="mt-4">
                      <span className="text-xs text-gray-400">Due Date:</span>
                      <div className="text-sm font-bold text-white">{voucher.dueDate}</div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/10">
                    <span className="text-xs text-gray-400">Voucher Installment:</span>
                    <div className="text-2xl font-black text-white mt-0.5">${voucher.amount.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Estimated Payments Made Field */}
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-white">Estimated Payments Already Submitted to IRS</h4>
                <p className="text-xs text-gray-400">Total of payments made directly to the IRS via 1040-ES vouchers or IRS Direct Pay.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-400">$</span>
                <input
                  type="number"
                  value={profileSettings?.estimated_payments_made || ''}
                  onChange={(e) => updateSettings({ estimated_payments_made: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-36 bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: IRS SUBMISSION PACKAGE & AUDIT DEFENSE */}
        {activeTab === 'export' && calc && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-[#1a1c23]/80 border border-white/10 backdrop-blur-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Download className="w-5 h-5 text-[#7c3bed]" />
                  IRS Submission Package & Audit Defense Ledger
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Print official CPA-ready summary reports or export itemized CSV documentation with receipt audit trails.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleExportCsv}
                  className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-semibold hover:bg-white/10 transition-colors flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-[#7c3bed]" />
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={() => setIsPrintPreviewOpen(true)}
                  className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/15 transition-colors flex items-center gap-2"
                >
                  <Eye className="w-3.5 h-3.5 text-[#7c3bed]" />
                  <span>Preview Tax Package</span>
                </button>

                <button
                  onClick={handlePrint}
                  className="px-4 py-2 rounded-xl bg-[#7c3bed] text-white text-xs font-bold hover:bg-[#6b33cc] transition-colors flex items-center gap-2 shadow-lg shadow-[#7c3bed]/25"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Tax Package</span>
                </button>
              </div>
            </div>

            {/* Printable Area - Hooked with #printable-tax-area in index.css */}
            <div
              id="printable-tax-area"
              ref={printAreaRef}
              className="rounded-2xl bg-[#1a1c23]/80 border border-white/10 p-8 backdrop-blur-xl space-y-8"
            >
              {/* Report Header */}
              <div className="border-b border-white/10 pb-6 flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-white">GlassExpense Tax Filing Summary</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Taxpayer: <strong className="text-white">{user?.username}</strong> ({user?.email || 'No email'}) | Entity: <strong className="text-white capitalize">{profileSettings?.entity_type}</strong> | Tax Year: <strong className="text-white">{taxYear}</strong> | Filing Status: <strong className="text-white capitalize">{calc.filingStatus}</strong>
                  </p>
                </div>
                <div className="text-right text-xs text-gray-400">
                  <div>Generated on {new Date().toLocaleDateString()}</div>
                  <div className="text-emerald-400 font-bold mt-1">IRS Compliant Schedule C & 1040-ES</div>
                </div>
              </div>

              {/* Form 1040 Executive Summary Box */}
              <div className="p-5 rounded-xl bg-white/5 border border-white/10 space-y-3">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Form 1040 Executive Summary</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-gray-400">Total W-2 Wages:</span>
                    <div className="text-base font-bold text-white font-mono">${calc.incomeTax.totalW2Wages.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Schedule C Net Profit:</span>
                    <div className="text-base font-bold text-emerald-400 font-mono">${calc.scheduleC.netBusinessProfit.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Adjusted Gross (AGI):</span>
                    <div className="text-base font-bold text-white font-mono">${calc.incomeTax.agi.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Taxable Income:</span>
                    <div className="text-base font-bold text-white font-mono">${calc.incomeTax.taxableIncome.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Federal Income Tax:</span>
                    <div className="text-base font-bold text-white font-mono">${calc.incomeTax.federalIncomeTax.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Self-Employment Tax:</span>
                    <div className="text-base font-bold text-purple-400 font-mono">${calc.selfEmployment.totalSETax.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Withholdings & Credits:</span>
                    <div className="text-base font-bold text-white font-mono">${calc.reconciliation.totalPaymentsAndCredits.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-gray-400">Net Estimated Position:</span>
                    <div className={`text-base font-black font-mono ${calc.reconciliation.isRefund ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {calc.reconciliation.isRefund ? '+' : '-'}${calc.reconciliation.refundOrBalanceAmount.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Schedule C Itemized Deductions Table */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span>Schedule C Itemized Deductions (Total: ${calc.scheduleC.totalAllowableExpenses.toFixed(2)})</span>
                  <span className="text-xs text-gray-400 font-normal">Gross Revenue: ${calc.scheduleC.totalGrossReceipts.toFixed(2)}</span>
                </h4>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 text-gray-400 text-[10px] uppercase tracking-wider border-b border-white/10">
                      <tr>
                        <th className="py-2 px-3">Line #</th>
                        <th className="py-2 px-3">Category Title</th>
                        <th className="py-2 px-3 text-center">Tx Count</th>
                        <th className="py-2 px-3 text-right">Gross Amount</th>
                        <th className="py-2 px-3 text-right">Deductible Write-Off</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-gray-300">
                      {(Object.keys(calc.scheduleC.lines) as ScheduleCLine[]).map((lk) => {
                        const line = calc.scheduleC.lines[lk];
                        return (
                          <tr key={lk}>
                            <td className="py-2 px-3 font-mono font-bold text-[#7c3bed]">{line.lineNumber}</td>
                            <td className="py-2 px-3 font-medium text-white">{line.title}</td>
                            <td className="py-2 px-3 text-center text-gray-400">{line.transactionCount}</td>
                            <td className="py-2 px-3 text-right font-mono text-gray-400">${line.grossAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">${line.deductibleAmount.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Schedule SE & Form 1040-ES Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Schedule SE Tax Summary</h4>
                  <div className="flex justify-between text-gray-300">
                    <span>Net Self-Employment Earnings:</span>
                    <span className="font-mono text-white">${calc.selfEmployment.netEarningsSubjectToSE.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-300">
                    <span>Social Security Tax (12.4%):</span>
                    <span className="font-mono text-white">${calc.selfEmployment.ssTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-300">
                    <span>Medicare Tax (2.9%):</span>
                    <span className="font-mono text-white">${calc.selfEmployment.medicareTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-300 font-bold border-t border-white/10 pt-1.5">
                    <span>50% Above-the-Line Deduction:</span>
                    <span className="font-mono">-${calc.selfEmployment.aboveTheLineDeduction.toFixed(2)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Form 1040-ES Quarterly Schedule</h4>
                  {calc.quarterlyVouchers.map((v) => (
                    <div key={v.quarter} className="flex justify-between text-gray-300">
                      <span>{v.quarter} ({v.dueDate}):</span>
                      <span className="font-mono text-white">
                        ${v.amount.toFixed(2)} {v.isPaid ? '✓ (Paid)' : ''}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-purple-300 font-bold border-t border-white/10 pt-1.5">
                    <span>Safe Harbor Target / Quarter:</span>
                    <span className="font-mono">${calc.safeHarbor.recommendedQuarterly.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Audit Defense Receipt Ledger */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-[#7c3bed]" />
                    Audit Defense Itemized Ledger ({calcData?.transactions?.length || 0} Transactions, {calcData?.totalReceiptsCount || 0} Receipts)
                  </h4>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/10">
                      <tr>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Job / Invoice</th>
                        <th className="py-2.5 px-3">Schedule C Line</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-right">Amount</th>
                        <th className="py-2.5 px-3 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-gray-300">
                      {calcData?.transactions?.map((t: any) => (
                        <tr key={t.id} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 px-3 font-mono">{t.date || (t.created_at ? t.created_at.split(' ')[0] : '')}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-white">{t.job_title}</div>
                            {t.job_invoice_number && <div className="text-[10px] text-gray-500 font-mono">{t.job_invoice_number}</div>}
                          </td>
                          <td className="py-2.5 px-3 text-[#7c3bed] font-medium">
                            {t.assigned_schedule_c_line || (t.entry_type === 'income' ? 'Gross Revenue' : 'Unassigned')}
                          </td>
                          <td className="py-2.5 px-3 max-w-xs truncate">{t.description || '—'}</td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${t.entry_type === 'income' ? 'text-emerald-400' : 'text-white'}`}>
                            {t.entry_type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {t.receipt_url ? (
                              <button
                                onClick={() => handleViewReceipt(t.receipt_url, t.job_id, Boolean(t.is_encrypted))}
                                className="p-1 rounded bg-white/5 hover:bg-[#7c3bed]/20 text-[#7c3bed]"
                                title="View Receipt"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal: Interactive White Paper Print Preview */}
            {isPrintPreviewOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
                <div className="w-full max-w-4xl bg-white text-gray-900 rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
                  {/* Modal Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
                    <div className="flex items-center gap-2">
                      <FileCheck className="w-5 h-5 text-purple-700" />
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Official CPA Tax Filing Package Preview</h3>
                        <p className="text-xs text-gray-500">Full IRS Schedule C, Schedule SE & Form 1040 Documentation</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handlePrint}
                        className="px-3.5 py-1.5 rounded-lg bg-purple-700 text-white text-xs font-bold hover:bg-purple-800 transition-colors flex items-center gap-1.5 shadow"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Document</span>
                      </button>
                      <button
                        onClick={() => setIsPrintPreviewOpen(false)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-200 text-sm font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Document Body (White Paper View) */}
                  <div className="p-8 overflow-y-auto space-y-6 text-xs text-gray-900 font-sans">
                    {/* Header */}
                    <div className="border-b-2 border-gray-900 pb-4 flex justify-between items-start">
                      <div>
                        <h1 className="text-xl font-bold tracking-tight text-gray-900">GlassExpense Tax Filing Package</h1>
                        <p className="text-xs text-gray-600 mt-1">
                          Taxpayer: <strong>{user?.username}</strong> | Entity: <strong className="capitalize">{profileSettings?.entity_type}</strong> | Tax Year: <strong>{taxYear}</strong> | Status: <strong className="capitalize">{calc.filingStatus}</strong>
                        </p>
                      </div>
                      <div className="text-right text-xs text-gray-600">
                        <div>Generated on {new Date().toLocaleDateString()}</div>
                        <div className="text-purple-700 font-bold mt-0.5">IRS Form 1040 / Schedule C / SE</div>
                      </div>
                    </div>

                    {/* Form 1040 Executive Summary Box */}
                    <div className="p-4 rounded-xl border border-gray-300 bg-gray-50 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">1. Form 1040 Executive Reconciliation</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-gray-500">W-2 Wages:</span>
                          <div className="font-bold font-mono">${calc.incomeTax.totalW2Wages.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Schedule C Profit:</span>
                          <div className="font-bold font-mono text-purple-700">${calc.scheduleC.netBusinessProfit.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Adjusted Gross (AGI):</span>
                          <div className="font-bold font-mono">${calc.incomeTax.agi.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Taxable Income:</span>
                          <div className="font-bold font-mono">${calc.incomeTax.taxableIncome.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Federal Income Tax:</span>
                          <div className="font-bold font-mono">${calc.incomeTax.federalIncomeTax.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Self-Employment Tax:</span>
                          <div className="font-bold font-mono">${calc.selfEmployment.totalSETax.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Total Payments:</span>
                          <div className="font-bold font-mono">${calc.reconciliation.totalPaymentsAndCredits.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Net Estimated Position:</span>
                          <div className={`font-black font-mono ${calc.reconciliation.isRefund ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {calc.reconciliation.isRefund ? '+' : '-'}${calc.reconciliation.refundOrBalanceAmount.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Schedule C Itemized Breakdown Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                        2. Schedule C Deductions Ledger (Total Allowable: ${calc.scheduleC.totalAllowableExpenses.toFixed(2)})
                      </h4>
                      <table className="w-full border border-gray-300 text-left text-xs border-collapse">
                        <thead className="bg-gray-100 text-gray-700 border-b border-gray-300 font-semibold">
                          <tr>
                            <th className="p-2">Line</th>
                            <th className="p-2">Description</th>
                            <th className="p-2 text-center">Tx Count</th>
                            <th className="p-2 text-right">Gross</th>
                            <th className="p-2 text-right">Deductible</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {(Object.keys(calc.scheduleC.lines) as ScheduleCLine[]).map((lk) => {
                            const line = calc.scheduleC.lines[lk];
                            return (
                              <tr key={lk}>
                                <td className="p-2 font-mono font-bold text-purple-700">{line.lineNumber}</td>
                                <td className="p-2">{line.title}</td>
                                <td className="p-2 text-center text-gray-600">{line.transactionCount}</td>
                                <td className="p-2 text-right font-mono text-gray-500">${line.grossAmount.toFixed(2)}</td>
                                <td className="p-2 text-right font-mono font-bold text-gray-900">${line.deductibleAmount.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Audit Defense Transactions Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                        3. Audit Defense Itemized Transactions ({calcData?.transactions?.length || 0} Transactions, {calcData?.totalReceiptsCount || 0} Receipts)
                      </h4>
                      <table className="w-full border border-gray-300 text-left text-xs border-collapse">
                        <thead className="bg-gray-100 text-gray-700 border-b border-gray-300 font-semibold">
                          <tr>
                            <th className="p-2">Date</th>
                            <th className="p-2">Job</th>
                            <th className="p-2">Schedule C Line</th>
                            <th className="p-2">Description</th>
                            <th className="p-2 text-right">Amount</th>
                            <th className="p-2 text-center">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {calcData?.transactions?.map((t: any) => (
                            <tr key={t.id}>
                              <td className="p-2 font-mono">{t.date || (t.created_at ? t.created_at.split(' ')[0] : '')}</td>
                              <td className="p-2 font-medium">{t.job_title}</td>
                              <td className="p-2 text-purple-700 font-medium">{t.assigned_schedule_c_line || 'Gross Revenue'}</td>
                              <td className="p-2 max-w-xs truncate">{t.description || '—'}</td>
                              <td className="p-2 text-right font-mono font-bold">
                                {t.entry_type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                              </td>
                              <td className="p-2 text-center text-gray-600">{t.receipt_url ? 'Attached ✓' : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODAL: W-2 MANUAL ENTRY & EDIT */}
        {isW2ModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-xl bg-[#1a1c23] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-[#7c3bed]" />
                  {editingW2 ? 'Edit W-2 Form Entry' : 'Add New W-2 Form Entry'}
                </h3>
                <button onClick={() => setIsW2ModalOpen(false)} className="text-gray-400 hover:text-white text-lg">
                  ×
                </button>
              </div>

              <form onSubmit={handleSaveW2} className="space-y-4 mt-4 text-xs">
                <div>
                  <label className="text-gray-400 block mb-1">Employer Name *</label>
                  <input
                    type="text"
                    required
                    value={w2FormState.employer_name}
                    onChange={(e) => setW2FormState({ ...w2FormState, employer_name: e.target.value })}
                    className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 block mb-1">Employer EIN</label>
                    <input
                      type="text"
                      placeholder="XX-XXXXXXX"
                      value={w2FormState.employer_ein}
                      onChange={(e) => setW2FormState({ ...w2FormState, employer_ein: e.target.value })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id="is_officer"
                      checked={w2FormState.is_scorp_officer_w2}
                      onChange={(e) => setW2FormState({ ...w2FormState, is_scorp_officer_w2: e.target.checked })}
                      className="rounded border-white/10 bg-[#121317] text-[#7c3bed]"
                    />
                    <label htmlFor="is_officer" className="text-gray-300 font-medium">
                      S-Corp Officer W-2
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                  <div>
                    <label className="text-gray-400 block mb-1">Box 1: Wages, Tips, Other Comp</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.wages_box1 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, wages_box1: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Box 2: Federal Income Tax Withheld</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.fed_withholding_box2 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, fed_withholding_box2: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Box 3: Social Security Wages</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.ss_wages_box3 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, ss_wages_box3: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Box 4: Social Security Tax Withheld</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.ss_withholding_box4 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, ss_withholding_box4: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Box 5: Medicare Wages</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.medicare_wages_box5 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, medicare_wages_box5: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-gray-400 block mb-1">Box 6: Medicare Tax Withheld</label>
                    <input
                      type="number"
                      step="0.01"
                      value={w2FormState.medicare_withholding_box6 || ''}
                      onChange={(e) => setW2FormState({ ...w2FormState, medicare_withholding_box6: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#121317] border border-white/10 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setIsW2ModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#7c3bed] hover:bg-[#6b33cc] text-white font-bold"
                  >
                    Save W-2 Form
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: JOB SCOPE FILTER */}
        {isJobScopeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#1a1c23] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Filter className="w-4 h-4 text-[#7c3bed]" />
                  Select Business Jobs for Tax Year {taxYear}
                </h3>
                <button onClick={() => setIsJobScopeModalOpen(false)} className="text-gray-400 hover:text-white text-lg">
                  ×
                </button>
              </div>

              <p className="text-xs text-gray-400 mt-2">
                By default, all jobs active or completed/archived during {taxYear} are included. You can selectively uncheck any personal or hobby jobs:
              </p>

              <div className="space-y-2 mt-4 max-h-60 overflow-y-auto divide-y divide-white/5">
                {accessibleJobs.map((j) => {
                  const selectedIds = profileSettings?.selected_job_ids;
                  const isChecked = !selectedIds || selectedIds.includes(j.id);

                  return (
                    <label key={j.id} className="flex items-center justify-between py-2.5 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            let next: string[] = [];
                            if (!selectedIds) {
                              next = accessibleJobs.map((x) => x.id);
                            } else {
                              next = [...selectedIds];
                            }
                            if (e.target.checked) {
                              if (!next.includes(j.id)) next.push(j.id);
                            } else {
                              next = next.filter((id) => id !== j.id);
                            }
                            updateSettings({ selected_job_ids: next });
                          }}
                          className="rounded border-white/10 bg-[#121317] text-[#7c3bed]"
                        />
                        <div>
                          <div className="text-xs font-semibold text-white">{j.title}</div>
                          {j.invoice_tag && <div className="text-[10px] text-gray-400">Tag: {j.invoice_tag}</div>}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          j.is_archived
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {j.is_archived ? 'Archived' : 'Active'}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-white/10 mt-4 text-xs">
                <button
                  type="button"
                  onClick={() => updateSettings({ selected_job_ids: null })}
                  className="text-[#7c3bed] hover:underline"
                >
                  Reset (Include All Jobs)
                </button>
                <button
                  type="button"
                  onClick={() => setIsJobScopeModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#7c3bed] text-white font-bold"
                >
                  Apply Filter
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: TAG TAX MAPPINGS */}
        {isTagMappingModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-xl bg-[#1a1c23] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Tag className="w-4 h-4 text-[#7c3bed]" />
                  Map Tags to IRS Schedule C Lines
                </h3>
                <button onClick={() => setIsTagMappingModalOpen(false)} className="text-gray-400 hover:text-white text-lg">
                  ×
                </button>
              </div>

              <p className="text-xs text-gray-400 mt-2">
                Transactions with these tags will automatically feed into the corresponding Schedule C tax line:
              </p>

              <div className="space-y-3 mt-4 divide-y divide-white/5">
                {availableTags.map((tag) => {
                  const existingMapping = tagMappings.find((m) => m.tag_id === tag.id);
                  const currentLine = existingMapping?.schedule_c_line || 'line_27a_other';

                  return (
                    <div key={tag.id} className="pt-2 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color || '#7c3bed' }} />
                        <span className="font-semibold text-white">{tag.name}</span>
                      </div>

                      <select
                        value={currentLine}
                        onChange={async (e) => {
                          const newLine = e.target.value;
                          await fetch('/api/taxes/tag-mappings', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`
                            },
                            body: JSON.stringify({ tag_id: tag.id, schedule_c_line: newLine })
                          });
                          fetchTaxData(taxYear);
                        }}
                        className="bg-[#121317] border border-white/10 rounded-lg px-2.5 py-1 text-white text-[11px]"
                      >
                        {(Object.keys(SCHEDULE_C_LINE_METADATA) as ScheduleCLine[]).map((lk) => (
                          <option key={lk} value={lk}>
                            {SCHEDULE_C_LINE_METADATA[lk].lineNumber}: {SCHEDULE_C_LINE_METADATA[lk].title}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-4 border-t border-white/10 mt-4">
                <button
                  type="button"
                  onClick={() => setIsTagMappingModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#7c3bed] text-white text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: RECEIPT PREVIEW / DECRYPTION */}
        {selectedReceiptUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-[#1a1c23] border border-white/10 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[#7c3bed]" />
                  Audit Defense Receipt Preview
                </h3>
                <button
                  onClick={() => {
                    setSelectedReceiptUrl(null);
                    setDecryptedReceiptSrc(null);
                  }}
                  className="text-gray-400 hover:text-white text-lg"
                >
                  ×
                </button>
              </div>

              <div className="py-6 flex items-center justify-center min-h-[300px]">
                {isDecryptingReceipt ? (
                  <div className="text-center text-xs text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-[#7c3bed] mx-auto mb-2" />
                    <span>Decrypting receipt with job AES-256 key...</span>
                  </div>
                ) : decryptedReceiptSrc ? (
                  <img
                    src={decryptedReceiptSrc}
                    alt="Receipt"
                    className="max-h-[500px] rounded-xl object-contain border border-white/10"
                  />
                ) : (
                  <div className="text-xs text-rose-400">Unable to preview receipt.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODAL: DEDUCTION DISCOVERY & UNCLAIMED WRITE-OFFS */}
        {isDeductionDiscoveryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="w-full max-w-4xl bg-[#1a1c23] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Deduction Discovery: {unclaimedSuggestions.length} Untagged Potential Write-Offs
                    </h3>
                    <p className="text-xs text-gray-400">
                      We scanned your receipts and job expenses for tax deductible items that haven't been tagged or mapped to Schedule C lines yet.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDeductionDiscoveryModalOpen(false)}
                  className="text-gray-400 hover:text-white text-xl p-1"
                >
                  ×
                </button>
              </div>

              {/* Stats Summary Bar */}
              <div className="py-4 border-b border-white/10 bg-white/[0.02] -mx-6 px-6 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Candidate Items</span>
                    <div className="text-xl font-black text-white">{unclaimedSuggestions.length}</div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Total Expenses</span>
                    <div className="text-xl font-black text-white font-mono">
                      ${unclaimedSuggestions.reduce((a, s) => a + s.amount, 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Est. Tax Savings</span>
                    <div className="text-xl font-black text-emerald-400 font-mono">
                      ~${unclaimedSuggestions.reduce((a, s) => a + s.estimatedTaxSavings, 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClaimAllSuggestions}
                    disabled={isClaimingAll || unclaimedSuggestions.length === 0}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isClaimingAll ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>Claim All {unclaimedSuggestions.length} Write-Offs</span>
                  </button>
                </div>
              </div>

              {/* List of Suggestions (Scrollable) */}
              <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
                {unclaimedSuggestions.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-xs">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <span className="text-sm font-semibold text-white block">All write-offs reviewed!</span>
                    <span>All discovered candidate expenses have been successfully claimed into your Schedule C deductions ledger.</span>
                  </div>
                ) : (
                  unclaimedSuggestions.map((s) => {
                    const selectedLine = suggestionLineOverrides[s.expenseId] || s.suggestedLine;
                    const isClaiming = claimingSuggestionId === s.expenseId;

                    return (
                      <div
                        key={s.expenseId}
                        className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30">
                              {s.jobTitle}
                            </span>
                            {s.date && (
                              <span className="text-[10px] text-gray-400 font-mono">
                                {s.date}
                              </span>
                            )}
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">
                              ~${s.estimatedTaxSavings.toFixed(2)} tax savings
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white truncate">
                              {s.description || 'Untagged Expense'}
                            </span>
                            <span className="text-sm font-mono font-black text-white shrink-0">
                              ${s.amount.toFixed(2)}
                            </span>
                          </div>

                          <p className="text-xs text-amber-300/80 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                            <span>{s.reason}</span>
                          </p>
                        </div>

                        {/* Mapping and Action Controls */}
                        <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/5">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 mb-1">Target Category:</span>
                            <select
                              value={selectedLine}
                              onChange={(e) => {
                                setSuggestionLineOverrides(prev => ({
                                  ...prev,
                                  [s.expenseId]: e.target.value
                                }));
                              }}
                              className="bg-[#121317] border border-white/10 text-white rounded-lg px-2.5 py-1.5 text-xs focus:border-[#7c3bed] focus:outline-none"
                            >
                              {(Object.keys(SCHEDULE_C_LINE_METADATA) as ScheduleCLine[]).map((lk) => (
                                <option key={lk} value={lk}>
                                  {SCHEDULE_C_LINE_METADATA[lk].lineNumber}: {SCHEDULE_C_LINE_METADATA[lk].title}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-end gap-1.5">
                            <button
                              onClick={() => handleClaimSuggestion(s, selectedLine)}
                              disabled={isClaiming || isClaimingAll}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                            >
                              {isClaiming ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>Claim</span>
                            </button>

                            <button
                              onClick={() => handleDismissSuggestion(s.expenseId)}
                              disabled={isClaiming || isClaimingAll}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer text-sm"
                              title="Dismiss for now"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer */}
              <div className="pt-4 border-t border-white/10 shrink-0 flex items-center justify-between text-xs text-gray-400">
                <span>
                  Claimed expenses are instantly categorized into your Schedule C deductions ledger and IRS audit trail.
                </span>
                <button
                  type="button"
                  onClick={() => setIsDeductionDiscoveryModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
