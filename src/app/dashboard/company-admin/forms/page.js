'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';

export default function CompanyAdminFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState([]);
  const [leadsTotal, setLeadsTotal] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'published' | 'draft' | 'archived'
  const [sortBy, setSortBy] = useState('updatedAt'); // 'updatedAt' | 'createdAt' | 'name'

  // Embed modal state
  const [embedModalForm, setEmbedModalForm] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Analytics modal state
  const [analyticsModalForm, setAnalyticsModalForm] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // Status updating form ID
  const [updatingFormId, setUpdatingFormId] = useState(null);
  const [downloadingFormId, setDownloadingFormId] = useState(null);

  // Per-Form CSV Export Download Handler
  async function handleDownloadFormCsv(form) {
    if (downloadingFormId) return;
    setDownloadingFormId(form._id);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/leads/export?formId=${form._id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Failed to export CSV for this form.');
        return;
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition') || '';
      let filename = `${(form.title || form.name || 'form').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-leads.csv`;
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

      setActionSuccess(`Successfully exported CSV for "${form.title || form.name}".`);
    } catch {
      setActionError('Network error while exporting form CSV.');
    } finally {
      setDownloadingFormId(null);
    }
  }

  async function openAnalytics(form) {
    setAnalyticsModalForm(form);
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    setAnalyticsData(null);
    try {
      const res = await fetch(`/api/forms/${form._id}/analytics`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAnalyticsError(data.error || 'Failed to load form analytics.');
      } else {
        setAnalyticsData(data.data);
      }
    } catch {
      setAnalyticsError('Network error loading analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  }

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isSubscribed = true;

    async function fetchForms(isPolling = false) {
      try {
        const [formsRes, leadsRes] = await Promise.all([
          fetch('/api/forms', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          }),
          fetch('/api/leads?limit=1', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          }),
        ]);

        if (formsRes.status === 401 || leadsRes.status === 401) {
          if (isSubscribed) {
            router.replace('/login');
          }
          return;
        }

        const formsData = await formsRes.json();
        const leadsData = await leadsRes.json();

        if (!isSubscribed) return;

        if (!formsRes.ok || !formsData.success) {
          if (!isPolling) {
            setErrorMessage(formsData.error || 'Failed to retrieve company forms.');
          }
        } else {
          setForms(formsData.data || []);
        }

        if (leadsRes.ok && leadsData.success && leadsData.pagination) {
          setLeadsTotal(leadsData.pagination.total);
        }
      } catch {
        if (!isPolling && isSubscribed) {
          setErrorMessage('Network error while connecting to lead tracker server.');
        }
      } finally {
        if (!isPolling && isSubscribed) {
          setIsLoading(false);
        }
      }
    }

    fetchForms(false);

    // Auto-refresh: Poll every 4 seconds while tab is active to update form submission counts
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchForms(true);
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchForms(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router, refreshKey]);

  async function handleTogglePublish(form) {
    const isCurrentlyPublished = form.status === 'published';
    const nextStatus = isCurrentlyPublished ? 'draft' : 'published';

    setActionSuccess(null);
    setActionError(null);
    setUpdatingFormId(form._id);

    try {
      const res = await fetch(`/api/forms/${form._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || `Could not ${isCurrentlyPublished ? 'unpublish' : 'publish'} form.`);
      } else {
        setActionSuccess(`Form "${form.name}" has been ${nextStatus === 'published' ? 'published' : 'unpublished'}.`);
        setForms((prev) =>
          prev.map((f) => (f._id === form._id ? { ...f, status: nextStatus, updatedAt: new Date().toISOString() } : f))
        );
        // Refresh server-side counts and status metrics
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError('Network failure occurred. Please try again.');
    } finally {
      setUpdatingFormId(null);
    }
  }

  async function handleToggleArchive(form) {
    const isCurrentlyArchived = form.status === 'archived';
    const nextStatus = isCurrentlyArchived ? 'draft' : 'archived';

    if (!isCurrentlyArchived) {
      const confirmed = window.confirm(
        `Are you sure you want to archive "${form.title || form.name}"?\n\nAll historical leads, submissions, and analytics will be preserved.`
      );
      if (!confirmed) return;
    }

    setActionSuccess(null);
    setActionError(null);
    setUpdatingFormId(form._id);

    try {
      const res = await fetch(`/api/forms/${form._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || `Could not ${isCurrentlyArchived ? 'restore' : 'archive'} form.`);
      } else {
        setActionSuccess(`Form "${form.name}" has been ${isCurrentlyArchived ? 'restored to draft' : 'archived'}. Historical submissions remain intact.`);
        setForms((prev) =>
          prev.map((f) => (f._id === form._id ? { ...f, status: nextStatus, updatedAt: new Date().toISOString() } : f))
        );
        // Refresh server-side counts and status metrics
        setRefreshKey((k) => k + 1);
      }
    } catch {
      setActionError('Network failure occurred. Please try again.');
    } finally {
      setUpdatingFormId(null);
    }
  }

  function getBaseUrl() {
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_URL) {
      return process.env.NEXT_PUBLIC_APP_URL;
    }
    if (typeof window !== 'undefined' && window.location.origin) {
      return window.location.origin;
    }
    return '';
  }

  function getPublicUrl(publicId) {
    return `${getBaseUrl()}/embed/${publicId}`;
  }

  function getIframeSnippet(form) {
    const url = getPublicUrl(form.publicId);
    const formTitle = form.title || form.name || 'Contact form';
    return `<iframe src="${url}" width="100%" height="700" frameborder="0" loading="lazy" style="border:none;max-width:100%;border-radius:12px;" title="${formTitle}"></iframe>`;
  }

  async function handleCopyText(text, isLink = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (isLink) {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2500);
      }
    } catch {
      // Fallback handled by selectable text
    }
  }

  // Filtered and sorted forms
  const filteredForms = useMemo(() => {
    return forms
      .filter((form) => {
        const matchesStatus = statusFilter === 'all' || form.status === statusFilter;
        const matchesQuery =
          !searchQuery.trim() ||
          form.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
          (form.description && form.description.toLowerCase().includes(searchQuery.toLowerCase().trim()));
        return matchesStatus && matchesQuery;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'createdAt') {
          return new Date(b.createdAt) - new Date(a.createdAt);
        }
        return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      });
  }, [forms, statusFilter, searchQuery, sortBy]);

  // Metric counts
  const totalCount = forms.length;
  const publishedCount = forms.filter((f) => f.status === 'published').length;
  const draftCount = forms.filter((f) => f.status === 'draft').length;

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Lead Forms' }]}
      title="Lead Forms"
      description="Create and manage forms to capture leads from your website."
      actions={
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setIsLoading(true);
              setRefreshKey((k) => k + 1);
            }}
            disabled={isLoading}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh forms"
          >
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link
            href="/dashboard/company-admin/forms/new"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
            </svg>
            <span>Create Form</span>
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Toast / Notification Banners */}
        {actionSuccess && (
          <div
            role="status"
            className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-xs animate-in fade-in"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-emerald-600 hover:text-emerald-900 text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-medium flex items-center justify-between shadow-xs animate-in fade-in"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              onClick={() => setActionError(null)}
              className="text-rose-600 hover:text-rose-900 text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Summary Metrics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Forms
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : totalCount}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Configured in workspace</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Published
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : publishedCount}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Live &amp; accepting leads</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Drafts
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : draftCount}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">In progress (not public)</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
              Leads Captured
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {isLoading || leadsTotal === null ? (
                <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" />
              ) : (
                leadsTotal
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Total inbound leads in pipeline</p>
          </div>
        </div>

        {/* Toolbar: Search, Status Filter & Sorting */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl overflow-x-auto text-xs font-semibold">
            {[
              { id: 'all', label: 'All Forms' },
              { id: 'published', label: 'Published' },
              { id: 'draft', label: 'Drafts' },
              { id: 'archived', label: 'Archived' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input & Sort Dropdown */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search forms by name..."
                className="w-full h-9 pl-9 pr-8 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer font-medium shrink-0"
            >
              <option value="updatedAt">Recently Updated</option>
              <option value="createdAt">Recently Created</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
                <div className="space-y-2">
                  <div className="h-4 w-48 bg-slate-200 rounded" />
                  <div className="h-3 w-64 bg-slate-100 rounded" />
                </div>
                <div className="flex gap-2">
                  <div className="h-8 w-16 bg-slate-100 rounded-lg" />
                  <div className="h-8 w-20 bg-slate-200 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State with Retry */}
        {!isLoading && errorMessage && (
          <div className="bg-white border border-rose-200 rounded-2xl p-10 text-center space-y-4 shadow-xs">
            <div className="h-12 w-12 rounded-2xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Failed to Load Forms</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{errorMessage}</p>
            </div>
            <button
              onClick={() => {
                setIsLoading(true);
                setRefreshKey((k) => k + 1);
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State (No Forms Ever Created) */}
        {!isLoading && !errorMessage && forms.length === 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-4 shadow-xs">
            <div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center shadow-xs">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">No Forms Created Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Build your first dynamic lead capture form to embed on your website and capture leads instantly.
              </p>
            </div>
            <Link
              href="/dashboard/company-admin/forms/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
              <span>Create Your First Form</span>
            </Link>
          </div>
        )}

        {/* Filter Empty State (Forms exist, but search / status filter matched none) */}
        {!isLoading && !errorMessage && forms.length > 0 && filteredForms.length === 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-10 text-center space-y-3 shadow-xs">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-slate-800">No matching forms found</h3>
            <p className="text-xs text-slate-500">
              No forms matched your search query &ldquo;{searchQuery}&rdquo; and selected status filter.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Forms Table (Desktop) / Cards (Mobile) */}
        {!isLoading && !errorMessage && filteredForms.length > 0 && (
          <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden">
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-6">Form Name</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Submissions</th>
                    <th className="py-3.5 px-4">Last Updated</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredForms.map((form) => {
                    const isPublished = form.status === 'published';
                    const isArchived = form.status === 'archived';
                    const isUpdating = updatingFormId === form._id;

                    return (
                      <tr key={form._id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm block">
                              {form.title || form.name}
                            </span>
                            
                          </div>
                          {form.description ? (
                            <p className="text-slate-500 text-[11px] truncate max-w-sm mt-0.5">{form.description}</p>
                          ) : (
                            <p className="text-slate-400 text-[11px] italic mt-0.5">No description</p>
                          )}
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          {isPublished ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Published
                            </span>
                          ) : isArchived ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Archived
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200/80">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Draft
                            </span>
                          )}
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap text-slate-600">
                          <Link
                            href={`/dashboard/company-admin/leads?formId=${form._id}`}
                            className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-indigo-600 text-xs"
                            title="View all leads captured by this form"
                          >
                            <span>{form.submissionsCount || 0}</span>
                            <span className="text-slate-500 font-normal">leads</span>
                            <span className="text-slate-400 text-[10px]">↗</span>
                          </Link>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                          {new Date(form.updatedAt || form.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>

                        <td className="py-4 px-6 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Analytics Action */}
                            <button
                              onClick={() => openAnalytics(form)}
                              className="px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                              title="View Form Ingestion Analytics"
                            >
                              Analytics
                            </button>

                            {/* Edit Action (Temporarily Disabled) */}
                            <button
                              type="button"
                              disabled
                              title="Form editing is temporarily disabled while we upgrade the update engine"
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold shadow-2xs cursor-not-allowed opacity-60"
                            >
                              Edit
                            </button>

                            {/* Public Preview Button */}
                            {isPublished ? (
                              <a
                                href={getPublicUrl(form.publicId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1"
                                title="Open Live Public Form"
                              >
                                <span>Preview</span>
                                <span className="text-slate-400">↗</span>
                              </a>
                            ) : null}

                            {/* Publish / Unpublish Toggle */}
                            {!isArchived && (
                              <button
                                onClick={() => handleTogglePublish(form)}
                                disabled={isUpdating}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50 ${
                                  isPublished
                                    ? 'border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
                                    : 'border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {isUpdating ? '...' : isPublished ? 'Unpublish' : 'Publish'}
                              </button>
                            )}

                            {/* Download CSV Action */}
                            <button
                              onClick={() => handleDownloadFormCsv(form)}
                              disabled={downloadingFormId === form._id}
                              className="px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title={`Download leads captured by ${form.name} as CSV`}
                            >
                              <svg className={`w-3.5 h-3.5 ${downloadingFormId === form._id ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              <span>{downloadingFormId === form._id ? 'Exporting...' : 'Download CSV'}</span>
                            </button>

                            {/* Archive / Restore Action (Hidden when published) */}
                            {!isPublished && (
                              <button
                                onClick={() => handleToggleArchive(form)}
                                disabled={isUpdating}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                                title={isArchived ? 'Restore to Draft' : 'Archive form (retains historical submissions)'}
                              >
                                {isArchived ? 'Restore' : 'Archive Form'}
                              </button>
                            )}

                            {/* Embed Code Modal Trigger */}
                            <button
                              onClick={() => {
                                setEmbedModalForm(form);
                                setCopiedCode(false);
                                setCopiedLink(false);
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                            >
                              Embed Code
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredForms.map((form) => {
                const isPublished = form.status === 'published';
                const isUpdating = updatingFormId === form._id;

                return (
                  <div key={form._id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-bold text-slate-900 text-sm">
                          {form.name}
                        </span>
                        {form.description && (
                          <p className="text-slate-500 text-xs mt-0.5 line-clamp-2">{form.description}</p>
                        )}
                      </div>
                      {isPublished ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Draft
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                      <Link href={`/dashboard/company-admin/leads?formId=${form._id}`} className="font-semibold text-slate-900 hover:text-indigo-600">
                        {form.submissionsCount || 0} leads ↗
                      </Link>
                      <span>{new Date(form.updatedAt || form.createdAt).toLocaleDateString()}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => openAnalytics(form)}
                        className="text-center py-2 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 text-xs font-semibold shadow-2xs cursor-pointer"
                      >
                        Analytics
                      </button>

                      <button
                        type="button"
                        disabled
                        title="Form editing is temporarily disabled"
                        className="text-center py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold shadow-2xs cursor-not-allowed opacity-60"
                      >
                        Edit
                      </button>

                      <button
                        onClick={() => handleTogglePublish(form)}
                        disabled={isUpdating}
                        className={`text-center py-2 rounded-xl text-xs font-semibold shadow-2xs cursor-pointer ${
                          isPublished
                            ? 'border border-amber-200 bg-amber-50 text-amber-800'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {isUpdating ? '...' : isPublished ? 'Unpublish' : 'Publish'}
                      </button>

                      {/* Per-Form Download CSV Action */}
                      <button
                        onClick={() => handleDownloadFormCsv(form)}
                        disabled={downloadingFormId === form._id}
                        className="col-span-3 text-center py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {downloadingFormId === form._id ? (
                          <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        )}
                        <span>{downloadingFormId === form._id ? 'Exporting CSV...' : 'Download Form CSV'}</span>
                      </button>

                      <button
                        onClick={() => {
                          setEmbedModalForm(form);
                          setCopiedCode(false);
                          setCopiedLink(false);
                        }}
                        className="col-span-3 text-center py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold shadow-2xs cursor-pointer"
                      >
                        Embed Code &amp; Link
                      </button>

                      {/* Archive Action (Only shown when unpublished) */}
                      {!isPublished && (
                        <button
                          onClick={() => handleToggleArchive(form)}
                          disabled={isUpdating}
                          className="col-span-3 text-center py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          {form.status === 'archived' ? 'Restore to Draft' : 'Archive Form'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Embed Code Modal Dialog */}
      {embedModalForm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Embed Lead Form</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      embedModalForm.status === 'published'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {embedModalForm.status}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Embed this form into your website or landing page.
                </p>
              </div>
              <button
                onClick={() => setEmbedModalForm(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {embedModalForm.status !== 'published' && (
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Form is currently in Draft status
                </div>
                <p className="text-[11px] text-amber-700">
                  This form must be published before external visitors can view or submit responses.
                </p>
              </div>
            )}

            {/* Direct URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Direct Public Form URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={getPublicUrl(embedModalForm.publicId)}
                  className="flex-1 h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-700 focus:outline-none select-all"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={() => handleCopyText(getPublicUrl(embedModalForm.publicId), true)}
                  className="px-3.5 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors shrink-0 cursor-pointer"
                >
                  {copiedLink ? 'Copied!' : 'Copy URL'}
                </button>
                <a
                  href={getPublicUrl(embedModalForm.publicId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-xs transition-colors shrink-0 flex items-center justify-center gap-1"
                >
                  <span>Preview</span>
                  <span>↗</span>
                </a>
              </div>
            </div>

            {/* iframe Embed Code */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                HTML iframe Embed Code
              </label>
              <textarea
                readOnly
                rows={3}
                value={getIframeSnippet(embedModalForm)}
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800 focus:bg-white focus:outline-none select-all resize-none"
                onFocus={(e) => e.target.select()}
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>Paste this snippet directly into any page HTML or CMS.</span>
                <button
                  onClick={() => handleCopyText(getIframeSnippet(embedModalForm), false)}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  {copiedCode ? '✓ Copied' : 'Copy Embed Code'}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setEmbedModalForm(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Modal Dialog */}
      {analyticsModalForm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Form Ingestion Analytics</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                    {analyticsModalForm.name}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Submissions and traffic metrics derived from MongoDB records
                </p>
              </div>
              <button
                onClick={() => setAnalyticsModalForm(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {analyticsLoading && (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
                  <p className="text-xs font-medium">Aggregating submission metrics...</p>
                </div>
              )}

              {analyticsError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  {analyticsError}
                </div>
              )}

              {!analyticsLoading && analyticsData && (
                <>
                  {/* Metric Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                        Total Form Submissions
                      </span>
                      <div className="text-2xl font-bold text-slate-900">
                        {analyticsData.summary?.totalSubmissions ?? 0}
                      </div>
                      <p className="text-[11px] text-slate-400">All-time captured leads</p>
                    </div>

                    <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-indigo-600 tracking-wider">
                        Today&apos;s Submissions (UTC)
                      </span>
                      <div className="text-2xl font-bold text-indigo-700">
                        {analyticsData.summary?.todaySubmissions ?? 0}
                      </div>
                      <p className="text-[11px] text-slate-400">Captured since UTC 00:00:00</p>
                    </div>
                  </div>

                  {/* Pipeline Status Breakdown */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                      Lead Pipeline Status Breakdown
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {['new', 'contacted', 'qualified', 'converted', 'rejected'].map((st) => (
                        <div key={st} className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">{st}</span>
                          <div className="text-sm font-bold text-slate-900 mt-0.5">
                            {analyticsData.statusBreakdown?.[st] ?? 0}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ingestion Sources */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                      Ingestion Sources &amp; Domains
                    </h4>
                    {analyticsData.sources && analyticsData.sources.length > 0 ? (
                      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden divide-y divide-slate-100">
                        {analyticsData.sources.map((item) => (
                          <div key={item.source} className="px-4 py-2.5 flex items-center justify-between">
                            <span className="font-mono text-slate-700">{item.source}</span>
                            <span className="font-bold text-slate-900 px-2 py-0.5 bg-slate-100 rounded-md">
                              {item.count} leads
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-400 italic">No source data recorded yet.</p>
                    )}
                  </div>

                  {/* Submission Timeline */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">
                      Daily Submissions Timeline
                    </h4>
                    {analyticsData.timeline && analyticsData.timeline.length > 0 ? (
                      <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto">
                        {analyticsData.timeline.map((point) => (
                          <div key={point.date} className="px-4 py-2 flex items-center justify-between">
                            <span className="font-mono text-slate-600">{point.date}</span>
                            <span className="font-semibold text-indigo-600">
                              {point.count} {point.count === 1 ? 'submission' : 'submissions'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-400 italic">No timeline submissions recorded yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
              <Link
                href={`/dashboard/company-admin/leads?formId=${analyticsModalForm._id}`}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
              >
                <span>View Form Leads</span>
                <span>↗</span>
              </Link>

              <button
                onClick={() => setAnalyticsModalForm(null)}
                className="px-4 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
