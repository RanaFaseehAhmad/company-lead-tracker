'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';

function LeadsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters & Pagination State
  const initialFormId = searchParams.get('formId') || '';
  const [formId, setFormId] = useState(initialFormId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const limit = 10;

  // Data State
  const [leads, setLeads] = useState([]);
  const [formsList, setFormsList] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1, limit: 10 });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Selected Lead Modal State
  const [selectedLead, setSelectedLead] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusUpdateMessage, setStatusUpdateMessage] = useState(null);
  const [rejectionModalLead, setRejectionModalLead] = useState(null);
  const [rejectionNoteText, setRejectionNoteText] = useState('');
  const [contactModalLead, setContactModalLead] = useState(null);
  const [contactNoteText, setContactNoteText] = useState('');
  const [downloadingLeadId, setDownloadingLeadId] = useState(null);

  // Download Single Lead CSV Handler
  async function handleDownloadLeadCsv(lead) {
    if (downloadingLeadId) return;
    setDownloadingLeadId(lead._id);
    setStatusUpdateMessage(null);

    try {
      const res = await fetch(`/api/leads/export?leadId=${lead._id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusUpdateMessage({ type: 'error', text: data.error || 'Failed to download lead CSV.' });
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition') || '';
      let filename = `lead-${lead._id}.csv`;
      const match = contentDisposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setStatusUpdateMessage({
        type: 'success',
        text: `Successfully downloaded CSV for ${lead.contactPerson || lead.companyName || 'lead'}.`,
      });
    } catch {
      setStatusUpdateMessage({ type: 'error', text: 'Network error downloading lead CSV.' });
    } finally {
      setDownloadingLeadId(null);
    }
  }

  // Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null); // { type: 'success' | 'error' | 'info', text: string }

  // Fetch available forms for the filter dropdown
  useEffect(() => {
    async function loadForms() {
      try {
        const res = await fetch('/api/forms');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setFormsList(data.data);
        }
      } catch {
        // Silently handled
      }
    }
    loadForms();
  }, []);

  // Fetch leads with server-side pagination, active filtering & visibility-aware auto-polling
  useEffect(() => {
    let ignore = false;

    async function loadLeads(isPolling = false) {
      if (!isPolling) {
        setIsLoading(true);
      }
      try {
        const params = new URLSearchParams();
        params.set('page', page.toString());
        params.set('limit', limit.toString());
        if (formId) params.set('formId', formId);
        if (search.trim()) params.set('search', search.trim());
        if (status) params.set('status', status);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const res = await fetch(`/api/leads?${params.toString()}`);

        if (res.status === 401) {
          if (!ignore) {
            router.replace('/login');
          }
          return;
        }

        const data = await res.json();

        if (ignore) return;

        if (!res.ok || !data.success) {
          if (!isPolling) {
            setErrorMessage(data.error || 'Failed to retrieve leads.');
          }
        } else {
          setLeads(data.data || []);
          if (data.pagination) {
            setPagination(data.pagination);
          }
          setErrorMessage(null);
        }
      } catch {
        if (!ignore && !isPolling) {
          setErrorMessage('Network error while connecting to server.');
        }
      } finally {
        if (!ignore && !isPolling) {
          setIsLoading(false);
        }
      }
    }

    loadLeads(false);

    // Auto-refresh: Poll for new incoming form submissions every 4 seconds while tab is visible
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadLeads(true);
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadLeads(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      ignore = true;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [page, limit, formId, search, status, startDate, endDate, router]);

  // Handle status update for a lead with optional notes
  async function handleStatusChange(leadId, newStatus, options = {}) {
    setIsUpdatingStatus(true);
    setStatusUpdateMessage(null);
    try {
      const payload = { status: newStatus };
      if (typeof options === 'string') {
        payload.rejectionNote = options;
      } else if (options && typeof options === 'object') {
        if (options.contactNote !== undefined) payload.contactNote = options.contactNote;
        if (options.rejectionNote !== undefined) payload.rejectionNote = options.rejectionNote;
      }

      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusUpdateMessage({ type: 'error', text: data.error || 'Failed to update status.' });
      } else {
        const displayStatus = newStatus === 'New' ? 'New / Pending' : newStatus;
        setStatusUpdateMessage({ type: 'success', text: `Lead status updated to ${displayStatus}.` });
        setLeads((prev) =>
          prev.map((l) =>
            l._id === leadId
              ? {
                  ...l,
                  status: newStatus,
                  contactNote: payload.contactNote !== undefined ? payload.contactNote : (l.contactNote || l.notes),
                  rejectionNote: payload.rejectionNote !== undefined ? payload.rejectionNote : l.rejectionNote,
                }
              : l
          )
        );
        if (selectedLead && selectedLead._id === leadId) {
          setSelectedLead((prev) => ({
            ...prev,
            status: newStatus,
            contactNote: payload.contactNote !== undefined ? payload.contactNote : (prev.contactNote || prev.notes),
            rejectionNote: payload.rejectionNote !== undefined ? payload.rejectionNote : prev.rejectionNote,
          }));
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lead-status-updated'));
        }
      }
    } catch {
      setStatusUpdateMessage({ type: 'error', text: 'Network error updating status.' });
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  // Handle CSV Export across all matching server-side records
  async function handleExportCsv() {
    setExportNotice(null);

    // If no leads match the active filters, display a clear message instead of downloading an empty file
    if (pagination.total === 0) {
      setExportNotice({
        type: 'info',
        text: 'No leads match the current filter criteria. There are no records to export.',
      });
      return;
    }

    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (formId) params.set('formId', formId);
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/leads/export?${params.toString()}`);

      if (!res.ok) {
        let errMessage = 'Failed to generate CSV export.';
        try {
          const errData = await res.json();
          if (errData.error) errMessage = errData.error;
        } catch {}
        setExportNotice({ type: 'error', text: errMessage });
        return;
      }

      const totalCount = res.headers.get('X-Total-Count');
      if (totalCount === '0') {
        setExportNotice({
          type: 'info',
          text: 'No leads match the current filter criteria. There are no records to export.',
        });
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition') || '';
      let filename = `company-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      window.URL.revokeObjectURL(blobUrl);

      const countLabel = totalCount ? ` (${totalCount} records)` : '';
      setExportNotice({
        type: 'success',
        text: `Export ready! Downloaded ${filename}${countLabel}.`,
      });
      setTimeout(() => setExportNotice(null), 5000);
    } catch {
      setExportNotice({
        type: 'error',
        text: 'Network error while generating CSV export. Please try again.',
      });
    } finally {
      setIsExporting(false);
    }
  }

  // Download individual lead JSON
  function handleDownloadLeadJson(lead) {
    const blob = new Blob([JSON.stringify(lead, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-${lead._id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Reset all filters
  function handleResetFilters() {
    setFormId('');
    setSearch('');
    setStatus('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    router.replace('/dashboard/company-admin/leads');
  }

  function getStatusBadge(st) {
    const norm = String(st || '').toLowerCase();
    if (norm === 'new' || norm === 'pending' || norm === 'new / pending') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> New / Pending
        </span>
      );
    }
    if (norm === 'approved') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Approved
        </span>
      );
    }
    if (norm === 'contacted') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Contacted
        </span>
      );
    }
    if (norm === 'qualified') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Qualified
        </span>
      );
    }
    if (norm === 'converted') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Converted
        </span>
      );
    }
    if (norm === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        {st || 'New / Pending'}
      </span>
    );
  }

  // Prettify camelCase / snake_case field keys
  function formatFieldLabel(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim();
  }

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Leads' }]}
      title="Company Leads"
      description="Track, filter, inspect, and export all inbound submissions captured across your forms"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Export matching leads across all pages to an Excel-ready CSV file"
          >
            {isExporting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export CSV</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Filter Controls Card */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search Input */}
            <div className="relative lg:col-span-2">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search leads by name, email, phone..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-colors"
              />
            </div>

            {/* Form Filter Dropdown */}
            <div>
              <select
                value={formId}
                onChange={(e) => {
                  setFormId(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
              >
                <option value="">All Lead Forms</option>
                {formsList.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter Dropdown */}
            <div>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
              >
                <option value="">All Statuses</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="converted">Converted</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Date Filters / Clear */}
            <div className="flex items-center gap-2">
              <input
                type="date"
                title="Start Date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="w-1/2 px-2 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
              />
              <input
                type="date"
                title="End Date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="w-1/2 px-2 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
              />
            </div>
          </div>

          {/* Filter Toolbar with Count, Reset & Export Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>
                Matching leads: <strong className="text-slate-800">{pagination.total}</strong>
              </span>
              {(formId || search || status || startDate || endDate) && (
                <>
                  <span>•</span>
                  <button
                    onClick={handleResetFilters}
                    className="text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </div>

            <button
              onClick={handleExportCsv}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              title="Export all matching records to CSV"
            >
              {isExporting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Export CSV {pagination.total > 0 ? `(${pagination.total})` : ''}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Export Notification Banner */}
        {exportNotice && (
          <div
            className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between shadow-2xs animate-in fade-in ${
              exportNotice.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : exportNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-bold">
                {exportNotice.type === 'error' ? 'Export Error:' : exportNotice.type === 'success' ? '✓' : 'Notice:'}
              </span>
              <span>{exportNotice.text}</span>
            </div>
            <button
              onClick={() => setExportNotice(null)}
              className="text-slate-400 hover:text-slate-700 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
                <div className="space-y-2">
                  <div className="h-4 w-40 bg-slate-200 rounded" />
                  <div className="h-3 w-56 bg-slate-100 rounded" />
                </div>
                <div className="h-6 w-20 bg-slate-100 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!isLoading && errorMessage && (
          <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center space-y-3 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900">Failed to Retrieve Leads</h3>
            <p className="text-xs text-slate-500">{errorMessage}</p>
            <button
              onClick={fetchLeads}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !errorMessage && leads.length === 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-4 shadow-xs">
            <div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">No Leads Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {formId || search || status || startDate || endDate
                  ? 'No leads match your current search and filter criteria.'
                  : 'No inbound leads have been captured yet. Publish your lead capture forms and embed them on external websites.'}
              </p>
            </div>
            {formId || search || status || startDate || endDate ? (
              <button
                onClick={handleResetFilters}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Reset Filters
              </button>
            ) : (
              <Link
                href="/dashboard/company-admin/forms"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-sm"
              >
                View Your Forms
              </Link>
            )}
          </div>
        )}

        {/* Leads Table */}
        {!isLoading && !errorMessage && leads.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden space-y-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-6">Lead Contact</th>
                    <th className="py-3.5 px-4">Form Name</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Source / Origin</th>
                    <th className="py-3.5 px-4">Captured Date</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leads.map((lead) => {
                    const formName =
                      lead.formName ||
                      (lead.form && typeof lead.form === 'object' ? lead.form.title || lead.form.name : null) ||
                      (lead.formId && typeof lead.formId === 'object' ? lead.formId.title || lead.formId.name : null) ||
                      'Unknown Form';

                    return (
                      <tr key={lead._id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-semibold text-slate-900 text-xs">
                            {lead.name || lead.contactPerson || lead.companyName || 'Anonymous Visitor'}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {lead.email || '—'}
                          </div>
                          {lead.phone && (
                            <div className="text-[10px] text-slate-400 font-sans">{lead.phone}</div>
                          )}
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200/90 shadow-2xs" title={`Originating Form: ${formName}`}>
                            <svg className="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {formName}
                          </span>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1 items-start">
                            {getStatusBadge(lead.status)}
                            <select
                              value={
                                (() => {
                                  const s = String(lead.status || '').toLowerCase();
                                  if (s === 'new' || s === 'pending' || s === 'new / pending') return 'New / Pending';
                                  if (s === 'approved') return 'Approved';
                                  if (s === 'contacted') return 'Contacted';
                                  if (s === 'rejected') return 'Rejected';
                                  return 'New / Pending';
                                })()
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'Contacted') {
                                  setContactModalLead(lead);
                                  setContactNoteText(lead.contactNote || lead.notes || '');
                                } else if (val === 'Rejected') {
                                  setRejectionModalLead(lead);
                                  setRejectionNoteText(lead.rejectionNote || '');
                                } else if (val === 'Approved') {
                                  handleStatusChange(lead._id, 'Approved');
                                } else if (val === 'New / Pending') {
                                  handleStatusChange(lead._id, 'New');
                                }
                              }}
                              disabled={isUpdatingStatus}
                              className="text-[10px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-400 cursor-pointer disabled:opacity-50"
                              title="Update lead status at any time"
                            >
                              <option value="New / Pending">New / Pending</option>
                              <option value="Approved">Approved</option>
                              <option value="Contacted">Contacted</option>
                              <option value="Rejected">Rejected</option>
                            </select>
                          </div>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[10px]">
                            {lead.source || 'direct'}
                          </span>
                          {lead.referrer && lead.referrer !== 'direct' && (
                            <div className="text-[10px] text-slate-400 truncate max-w-[120px]" title={lead.referrer}>
                              {lead.referrer}
                            </div>
                          )}
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                          {new Date(lead.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>

                        <td className="py-4 px-6 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Individual Lead CSV Download Button */}
                            <button
                              onClick={() => handleDownloadLeadCsv(lead)}
                              disabled={downloadingLeadId === lead._id}
                              className="px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1 shadow-2xs"
                              title="Download Single Lead CSV"
                            >
                              {downloadingLeadId === lead._id ? (
                                <span className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              )}
                              <span>CSV</span>
                            </button>

                            <button
                              onClick={() => setSelectedLead(lead)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                            >
                              Inspect
                            </button>
                            <button
                              onClick={() => handleDownloadLeadJson(lead)}
                              className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs shadow-2xs transition-colors cursor-pointer"
                              title="Download Lead as JSON"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <div>
                Showing <span className="font-semibold text-slate-900">{leads.length}</span> of{' '}
                <span className="font-semibold text-slate-900">{pagination.total}</span> leads
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-slate-500 font-medium">
                  Page {pagination.page} of {pagination.pages || 1}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.pages || 1, p + 1))}
                  disabled={page >= pagination.pages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Lead Detail Inspection Modal */}
        {selectedLead && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Modal Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-slate-900">Lead Submission Details</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {selectedLead._id}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedLead(null);
                    setStatusUpdateMessage(null);
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
                {statusUpdateMessage && (
                  <div
                    className={`p-3 rounded-xl border text-xs font-medium ${
                      statusUpdateMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {statusUpdateMessage.text}
                  </div>
                )}

                {/* Status & Quick Change */}
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                      Current Pipeline Status
                    </span>
                    <div className="mt-1">{getStatusBadge(selectedLead.status)}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => handleStatusChange(selectedLead._id, 'Approved')}
                      disabled={isUpdatingStatus}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedLead._id, 'Contacted')}
                      disabled={isUpdatingStatus}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Contact
                    </button>
                    <button
                      onClick={() => {
                        setRejectionModalLead(selectedLead);
                        setRejectionNoteText('');
                      }}
                      disabled={isUpdatingStatus}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>

                {selectedLead.rejectionNote && (
                  <div className="bg-rose-50/90 border border-rose-200 rounded-2xl p-4 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-rose-700 tracking-wider flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      Internal Private Rejection Note
                    </span>
                    <p className="text-xs text-rose-900 font-medium whitespace-pre-wrap">{selectedLead.rejectionNote}</p>
                    <p className="text-[10px] text-rose-500 italic">This note is strictly private to your workspace and is never exported in CSV.</p>
                  </div>
                )}

                {/* Key Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-slate-50/50 border border-slate-200/60 p-3 rounded-xl">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Originating Form</span>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {selectedLead.formName ||
                        (selectedLead.form && typeof selectedLead.form === 'object' ? selectedLead.form.title || selectedLead.form.name : null) ||
                        (selectedLead.formId && typeof selectedLead.formId === 'object' ? selectedLead.formId.title || selectedLead.formId.name : null) ||
                        'Unknown Form'}
                    </p>
                  </div>

                  <div className="bg-slate-50/50 border border-slate-200/60 p-3 rounded-xl">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Submission Timestamp</span>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {new Date(selectedLead.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="bg-slate-50/50 border border-slate-200/60 p-3 rounded-xl">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Source Identifier</span>
                    <p className="font-semibold text-slate-900 mt-0.5 font-mono">
                      {selectedLead.source || 'direct'}
                    </p>
                  </div>

                  <div className="bg-slate-50/50 border border-slate-200/60 p-3 rounded-xl">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Referrer</span>
                    <p className="font-semibold text-slate-900 mt-0.5 font-mono truncate">
                      {selectedLead.referrer || 'direct'}
                    </p>
                  </div>
                </div>

                {/* Dynamic Submitted Form Answers */}
                <div className="space-y-3">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                    Form Answers (`submissionData`)
                  </h4>

                  {selectedLead.submissionData && Object.keys(selectedLead.submissionData).length > 0 ? (
                    <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden divide-y divide-slate-100">
                      {Object.entries(selectedLead.submissionData)
                        .filter(([k]) => k !== 'submit')
                        .map(([fieldKey, val]) => (
                          <div key={fieldKey} className="px-4 py-3 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                            <span className="font-semibold text-slate-600 sm:w-1/3">
                              {formatFieldLabel(fieldKey)}
                            </span>
                            <span className="text-slate-900 font-medium sm:w-2/3 break-words">
                              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-slate-500">
                      No custom answers recorded for this lead submission.
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => handleDownloadLeadJson(selectedLead)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download Record (JSON)</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedLead(null);
                    setStatusUpdateMessage(null);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    {/* Optional Private Rejection Note Modal */}
        {contactModalLead && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-6 space-y-4">
              <div>
                <h3 className="font-bold text-base text-slate-900">Mark Lead as Contacted</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Updating status to <span className="font-semibold text-amber-600">Contacted</span>. You can optionally record an internal contact note.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Internal Contact Note</span>
                  <span className="text-[10px] text-slate-400 font-normal">Optional &bull; Private</span>
                </label>
                <textarea
                  value={contactNoteText}
                  onChange={(e) => setContactNoteText(e.target.value)}
                  placeholder="e.g., Called customer, scheduled follow-up for Tuesday..."
                  rows={3}
                  maxLength={1000}
                  className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition-all resize-none"
                />
                <div className="text-[10px] text-slate-400 text-right">
                  {contactNoteText.length} / 1000 characters
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setContactModalLead(null);
                    setContactNoteText('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleStatusChange(contactModalLead._id, 'Contacted', { contactNote: contactNoteText });
                    setContactModalLead(null);
                    setContactNoteText('');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-colors cursor-pointer"
                >
                  Save & Mark Contacted
                </button>
              </div>
            </div>
          </div>
        )}

        {rejectionModalLead && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 p-6 space-y-4">
              <div>
                <h3 className="font-bold text-base text-slate-900">Reject Lead</h3>
                <p className="text-xs text-slate-500 mt-1">
                  You are marking this lead as <span className="font-semibold text-rose-600">Rejected</span>.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                  <span>Internal Rejection Note</span>
                  <span className="text-[10px] text-slate-400 font-normal">Optional &bull; Private</span>
                </label>
                <textarea
                  value={rejectionNoteText}
                  onChange={(e) => setRejectionNoteText(e.target.value)}
                  placeholder="Enter reason or context for rejecting this lead..."
                  rows={3}
                  maxLength={1000}
                  className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10"
                />
                <p className="text-[10px] text-slate-400">
                  This note is internal and will never be shared with visitors or included in standard CSV exports.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectionModalLead(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const leadId = rejectionModalLead._id;
                    const note = rejectionNoteText.trim();
                    setRejectionModalLead(null);
                    await handleStatusChange(leadId, 'Rejected', note);
                  }}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
  );
}

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-slate-500">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            <p className="text-xs font-medium">Loading leads workspace...</p>
          </div>
        </div>
      }
    >
      <LeadsContent />
    </Suspense>
  );
}
