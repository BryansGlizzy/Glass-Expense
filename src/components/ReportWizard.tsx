import React, { useState } from 'react';
import {
  Calendar,
  Tag as TagIcon,
  Briefcase,
  Filter,
  Receipt,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  Search,
  DollarSign
} from 'lucide-react';

export interface ReportFilters {
  jobIds: string[];
  tagIds: string[];
  jobTags: string[];
  datePreset: 'all' | 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_30' | 'last_90' | 'custom';
  startDate: string;
  endDate: string;
  entryType: 'all' | 'expense' | 'income';
  includeArchived: boolean;
  minAmount: string;
  maxAmount: string;
  hasReceiptOnly: boolean;
}

interface ReportWizardProps {
  jobs: any[];
  tags: Array<{ id: string; name: string; color: string }>;
  filters: ReportFilters;
  onChangeFilters: (updater: (prev: ReportFilters) => ReportFilters) => void;
  onGenerate: () => void;
  isLoading: boolean;
}

export default function ReportWizard({
  jobs,
  tags,
  filters,
  onChangeFilters,
  onGenerate,
  isLoading
}: ReportWizardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [jobSearch, setJobSearch] = useState('');

  // Extract unique job tags (e.g., from invoice_tag or tag)
  const availableJobTags = Array.from(
    new Set(
      jobs
        .map((j) => j.invoice_tag || j.tag)
        .filter((t): t is string => Boolean(t && t.trim()))
    )
  );

  const filteredJobSelection = jobs.filter((j) => {
    if (!filters.includeArchived && j.is_archived) return false;
    if (jobSearch) {
      const q = jobSearch.toLowerCase();
      return (
        j.title?.toLowerCase().includes(q) ||
        j.invoice_number?.toLowerCase().includes(q) ||
        j.client_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleApplyPreset = (preset: ReportFilters['datePreset']) => {
    const now = new Date();
    let start = '';
    let end = now.toISOString().split('T')[0];

    if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      start = firstDay.toISOString().split('T')[0];
    } else if (preset === 'last_month') {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      start = firstDayLastMonth.toISOString().split('T')[0];
      end = lastDayLastMonth.toISOString().split('T')[0];
    } else if (preset === 'this_quarter') {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const firstDayQuarter = new Date(now.getFullYear(), quarterMonth, 1);
      start = firstDayQuarter.toISOString().split('T')[0];
    } else if (preset === 'ytd') {
      const firstDayYear = new Date(now.getFullYear(), 0, 1);
      start = firstDayYear.toISOString().split('T')[0];
    } else if (preset === 'last_30') {
      const past30 = new Date(now);
      past30.setDate(now.getDate() - 30);
      start = past30.toISOString().split('T')[0];
    } else if (preset === 'last_90') {
      const past90 = new Date(now);
      past90.setDate(now.getDate() - 90);
      start = past90.toISOString().split('T')[0];
    } else if (preset === 'all') {
      start = '';
      end = '';
    }

    onChangeFilters((prev) => ({
      ...prev,
      datePreset: preset,
      startDate: start,
      endDate: end
    }));
  };

  const handleToggleJob = (jobId: string) => {
    onChangeFilters((prev) => {
      const exists = prev.jobIds.includes(jobId);
      return {
        ...prev,
        jobIds: exists ? prev.jobIds.filter((id) => id !== jobId) : [...prev.jobIds, jobId]
      };
    });
  };

  const handleSelectAllJobs = () => {
    onChangeFilters((prev) => ({
      ...prev,
      jobIds: filteredJobSelection.map((j) => j.id)
    }));
  };

  const handleDeselectAllJobs = () => {
    onChangeFilters((prev) => ({
      ...prev,
      jobIds: []
    }));
  };

  const handleToggleTag = (tagId: string) => {
    onChangeFilters((prev) => {
      const exists = prev.tagIds.includes(tagId);
      return {
        ...prev,
        tagIds: exists ? prev.tagIds.filter((id) => id !== tagId) : [...prev.tagIds, tagId]
      };
    });
  };

  const handleToggleJobTag = (jobTag: string) => {
    onChangeFilters((prev) => {
      const exists = prev.jobTags.includes(jobTag);
      return {
        ...prev,
        jobTags: exists ? prev.jobTags.filter((t) => t !== jobTag) : [...prev.jobTags, jobTag]
      };
    });
  };

  const handleResetFilters = () => {
    onChangeFilters(() => ({
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
    }));
  };

  return (
    <div className="bg-[#1c172d]/70 border border-white/5 rounded-3xl backdrop-blur-md overflow-hidden transition-all shadow-xl">
      {/* Wizard Header Bar */}
      <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#7c3bed] to-purple-800 flex items-center justify-center text-white shadow-lg shadow-[#7c3bed]/20">
            <Filter className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Custom Report Wizard</h2>
            <p className="text-xs text-gray-400">
              Filter by specific jobs, rolling invoice tags, date windows, and receipt documentation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleResetFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                <span>Collapse Filters</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                <span>Modify Filters</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onGenerate}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-[#7c3bed] hover:bg-[#6b33cc] text-white shadow-lg shadow-[#7c3bed]/25 transition-all disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isLoading ? 'Generating...' : 'Generate Report'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Wizard Body */}
      {isExpanded && (
        <div className="p-6 space-y-6">
          {/* Quick Presets Banner */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 text-xs">
            <span className="text-gray-400 font-medium shrink-0">Quick Presets:</span>
            <button
              type="button"
              onClick={() => {
                handleApplyPreset('ytd');
                onChangeFilters((prev) => ({ ...prev, entryType: 'all', hasReceiptOnly: false }));
              }}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 shrink-0"
            >
              Tax Year (YTD)
            </button>
            <button
              type="button"
              onClick={() => {
                handleApplyPreset('this_month');
                onChangeFilters((prev) => ({ ...prev, entryType: 'expense', hasReceiptOnly: false }));
              }}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 shrink-0"
            >
              This Month Expenses
            </button>
            <button
              type="button"
              onClick={() => {
                handleApplyPreset('last_month');
                onChangeFilters((prev) => ({ ...prev, entryType: 'all', hasReceiptOnly: false }));
              }}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 shrink-0"
            >
              Last Month P&amp;L
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeFilters((prev) => ({ ...prev, hasReceiptOnly: true, entryType: 'expense' }));
              }}
              className="px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 shrink-0"
            >
              Receipts Only Audit
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
            {/* 1. Date Range Section */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                Date Range
              </label>

              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {(
                  [
                    { id: 'all', label: 'All Time' },
                    { id: 'this_month', label: 'This Month' },
                    { id: 'last_month', label: 'Last Month' },
                    { id: 'this_quarter', label: 'Quarter' },
                    { id: 'ytd', label: 'YTD' },
                    { id: 'last_30', label: 'Last 30D' },
                    { id: 'last_90', label: 'Last 90D' },
                    { id: 'custom', label: 'Custom' }
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleApplyPreset(p.id)}
                    className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                      filters.datePreset === p.id
                        ? 'bg-[#7c3bed] text-white shadow-sm'
                        : 'bg-black/20 hover:bg-black/40 text-gray-400 hover:text-gray-200 border border-white/5'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {filters.datePreset === 'custom' && (
                <div className="space-y-2 pt-1">
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-1">Start Date</span>
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) =>
                        onChangeFilters((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                          datePreset: 'custom'
                        }))
                      }
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-1">End Date</span>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) =>
                        onChangeFilters((prev) => ({
                          ...prev,
                          endDate: e.target.value,
                          datePreset: 'custom'
                        }))
                      }
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Transaction Types & Thresholds */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                Type &amp; Amount
              </label>

              <div className="grid grid-cols-3 gap-1 bg-black/20 p-1 rounded-xl border border-white/5 text-xs">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'expense', label: 'Expenses' },
                    { id: 'income', label: 'Income' }
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChangeFilters((prev) => ({ ...prev, entryType: t.id }))}
                    className={`py-1.5 rounded-lg font-medium transition-colors ${
                      filters.entryType === t.id
                        ? 'bg-[#7c3bed] text-white shadow-sm'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-1">Min ($)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={filters.minAmount}
                      onChange={(e) => onChangeFilters((prev) => ({ ...prev, minAmount: e.target.value }))}
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 block mb-1">Max ($)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="No max"
                      value={filters.maxAmount}
                      onChange={(e) => onChangeFilters((prev) => ({ ...prev, maxAmount: e.target.value }))}
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                </div>

                {/* Receipts Only Toggle */}
                <label className="flex items-center gap-2 p-2 bg-black/20 border border-white/5 rounded-xl cursor-pointer hover:bg-black/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={filters.hasReceiptOnly}
                    onChange={(e) => onChangeFilters((prev) => ({ ...prev, hasReceiptOnly: e.target.checked }))}
                    className="rounded bg-black/40 border-white/10 text-purple-600 focus:ring-purple-500 h-4 w-4"
                  />
                  <div className="flex items-center gap-1.5 text-xs text-gray-300">
                    <Receipt className="w-3.5 h-3.5 text-purple-400" />
                    <span>Only entries with receipts</span>
                  </div>
                </label>

                {/* Include Archived Toggle */}
                <label className="flex items-center gap-2 p-2 bg-black/20 border border-white/5 rounded-xl cursor-pointer hover:bg-black/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={filters.includeArchived}
                    onChange={(e) => onChangeFilters((prev) => ({ ...prev, includeArchived: e.target.checked }))}
                    className="rounded bg-black/40 border-white/10 text-purple-600 focus:ring-purple-500 h-4 w-4"
                  />
                  <span className="text-xs text-gray-300">Include archived jobs</span>
                </label>
              </div>
            </div>

            {/* 3. Job Tags & Transaction Tags */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5 text-blue-400" />
                Tags &amp; Categories
              </label>

              {/* Job-Level Tags */}
              {availableJobTags.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-400 block mb-1">Filter by Job Tag:</span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto no-scrollbar">
                    {availableJobTags.map((jt) => {
                      const isSelected = filters.jobTags.includes(jt);
                      return (
                        <button
                          key={jt}
                          type="button"
                          onClick={() => handleToggleJobTag(jt)}
                          className={`px-2 py-0.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                            isSelected
                              ? 'bg-[#7c3bed] text-white'
                              : 'bg-black/20 hover:bg-black/40 text-gray-400 border border-white/5'
                          }`}
                        >
                          {jt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Expense Tags */}
              <div>
                <span className="text-[10px] text-gray-400 block mb-1">Filter by Expense Category:</span>
                {tags.length === 0 ? (
                  <p className="text-xs text-gray-500">No categories created yet</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto no-scrollbar">
                    {tags.map((t) => {
                      const isSelected = filters.tagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleToggleTag(t.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                            isSelected
                              ? 'bg-white/20 text-white font-medium border border-white/20'
                              : 'bg-black/20 hover:bg-black/40 text-gray-400 border border-white/5'
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                          <span>{t.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 4. Jobs Selection Multi-Picker */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                  Select Jobs ({filters.jobIds.length ? filters.jobIds.length : 'All'})
                </label>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={handleSelectAllJobs}
                    className="text-purple-400 hover:underline"
                  >
                    All
                  </button>
                  <span className="text-gray-600">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAllJobs}
                    className="text-gray-400 hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter jobs list..."
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1 pr-1 border border-white/5 bg-black/20 rounded-xl p-1.5">
                {filteredJobSelection.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">No matching jobs found</p>
                ) : (
                  filteredJobSelection.map((job) => {
                    const isChecked = filters.jobIds.includes(job.id);
                    return (
                      <div
                        key={job.id}
                        onClick={() => handleToggleJob(job.id)}
                        className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-[#7c3bed]/20 text-white border border-[#7c3bed]/30'
                            : 'hover:bg-white/5 text-gray-400'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                              isChecked
                                ? 'bg-[#7c3bed] border-[#7c3bed]'
                                : 'border-gray-500 bg-black/20'
                            }`}
                          >
                            {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className="truncate font-medium">{job.title}</span>
                        </div>
                        {job.invoice_number && (
                          <span className="text-[10px] text-gray-500 font-mono shrink-0 ml-1">
                            {job.invoice_number}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
