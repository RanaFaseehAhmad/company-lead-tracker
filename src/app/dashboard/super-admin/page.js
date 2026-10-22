'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [totals, setTotals] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState('pending');
  const [statusCounts, setStatusCounts] = useState({
    pending: 0,
    approved: 0,
    blocked: 0,
    all: 0,
  });
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalRecords: 0,
    totalPages: 1,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingCompanies, setIsFetchingCompanies] = useState(false);
  const [tableError, setTableError] = useState(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [updatingCompanyId, setUpdatingCompanyId] = useState(null);
  const initialLoadedRef = useRef(false);

  // Debounce search input (approx. 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchTerm) {
        setSearchTerm(searchInput);
        setPage(1); // Reset to page 1 on search change
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, searchTerm]);

  const fetchCompanies = useCallback(
    async (statusToFetch = 'pending', searchToFetch = '', pageToFetch = 1, limitToFetch = 10) => {
      setIsFetchingCompanies(true);
      setTableError(null);
      try {
        const params = new URLSearchParams();
        if (statusToFetch) params.set('status', statusToFetch);
        if (searchToFetch && searchToFetch.trim()) {
          params.set('search', searchToFetch.trim());
        }
        params.set('page', String(pageToFetch || 1));
        params.set('limit', String(limitToFetch || 10));

        const res = await fetch(`/api/admin/companies?${params.toString()}`);
        const data = await res.json();
        if (res.ok && data.success) {
          setCompanies(Array.isArray(data.data) ? data.data : []);
          if (data.totals) {
            setTotals(data.totals);
          }
          if (data.statusCounts) {
            setStatusCounts(data.statusCounts);
          } else if (data.totals) {
            setStatusCounts({
              pending: data.totals.pendingCompanies || 0,
              approved: data.totals.approvedCompanies || 0,
              blocked: data.totals.blockedCompanies || 0,
              all: data.totals.totalCompanies || 0,
            });
          }
          if (data.pagination) {
            setPagination(data.pagination);
          }
        } else {
          setTableError(data.error || 'Failed to load companies.');
        }
      } catch {
        setTableError('Network error while retrieving companies.');
      } finally {
        setIsFetchingCompanies(false);
      }
    },
    []
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      try {
        const res = await fetch('/api/auth/me', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });

        if (!res.ok) {
          if (isMounted) {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/login';
          }
          return;
        }

        const data = await res.json();
        if (!data.success || !data.user) {
          if (isMounted) {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/login';
          }
          return;
        }

        if (data.user.role !== 'super_admin') {
          if (isMounted) {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = '/dashboard/company-admin';
          }
          return;
        }

        if (isMounted) {
          setUser(data.user);
          // Super Admin default view: Pending companies first
          await fetchCompanies('pending');
        }
      } catch {
        if (isMounted) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login';
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      isMounted = false;
    };
  }, [fetchCompanies]);

  // Fetch when user is authenticated or whenever query parameters change
  useEffect(() => {
    if (user) {
      if (!initialLoadedRef.current) {
        initialLoadedRef.current = true;
        return;
      }
      fetchCompanies(selectedStatus, searchTerm, page, limit);
    }
  }, [user, selectedStatus, searchTerm, page, limit, fetchCompanies]);

  const handleFilterChange = (newStatus) => {
    setSelectedStatus(newStatus);
    setPage(1); // Reset page to 1
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchInput !== searchTerm) {
        setSearchTerm(searchInput);
        setPage(1);
      }
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
    setPage(1);
  };

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setPage(1);
  };

  async function handleStatusChange(companyId, nextStatus) {
    setUpdatingCompanyId(companyId);
    setTableError(null);
    try {
      const res = await fetch('/api/admin/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, status: nextStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // If company leaves current view and was the sole row on page > 1, step back
        if (selectedStatus !== 'all' && companies.length === 1 && page > 1) {
          setPage((prev) => prev - 1);
        } else {
          await fetchCompanies(selectedStatus, searchTerm, page, limit);
        }
      } else {
        setTableError(data.error || 'Failed to update company status.');
      }
    } catch {
      setTableError('Network error while updating company status.');
    } finally {
      setUpdatingCompanyId(null);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on signout
    } finally {
      setUser(null);
      // Hard navigation ensures client-side cache and router state are completely purged across logout
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-xs font-medium">Loading Super Admin portal...</p>
        </div>
      </div>
    );
  }

  const startRecord =
    pagination.totalRecords === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, pagination.totalRecords);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Header Bar */}
      <header className="h-16 bg-white border-b border-slate-200/80 px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shadow-indigo-600/20">
            LT
          </div>
          <div>
            <h1 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <span>Platform Administration</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                Super Admin
              </span>
            </h1>
            <p className="text-[11px] text-slate-500">System Governance &amp; Multi-Tenant Control</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end text-xs">
            <span className="font-semibold text-slate-800">{user?.name}</span>
            <span className="text-slate-500 text-[11px]">{user?.email}</span>
          </div>
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-10 space-y-7">
        {/* Verification Alert Banner */}
        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span>
              <strong>Authentication Verified:</strong> Super Admin session established with HTTP-only JWT security.
            </span>
          </div>
          <span className="hidden sm:inline font-mono text-[11px] text-emerald-700">Role: super_admin</span>
        </div>

        {/* Profile Details Card */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Super Admin Portal</h2>
              <p className="text-xs text-slate-500 mt-1">
                Authorized platform account with system-wide administration rights.
              </p>
            </div>
            <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              Platform Master
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Account Name</span>
              <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
            </div>

            <div className="bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Account Email</span>
              <p className="text-sm font-semibold text-slate-900 truncate">{user?.email}</p>
            </div>

            <div className="bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl space-y-1">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Platform Status</span>
              <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
              </p>
            </div>
          </div>

          {/* Quick Links / Roadmap Note */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-5 text-xs text-slate-700 space-y-2">
            <div className="font-semibold text-indigo-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Platform Overview &amp; Tenant Operations
            </div>
            <p className="text-slate-600 leading-relaxed">
              Super Admin can provision new companies via API, view cross-tenant forms, inspect company approvals (`pending`, `approved`, `blocked`), search tenants by name or email, and monitor the lead ingestion engine.
            </p>
          </div>
        </div>

        {/* Platform Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Total Tenants
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {totals ? totals.totalCompanies : statusCounts.all}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
              <span className="text-emerald-700 font-semibold">{totals ? totals.approvedCompanies : statusCounts.approved} Active</span>
              <span>•</span>
              <span className="text-amber-700 font-semibold">{totals ? totals.pendingCompanies : statusCounts.pending} Pending</span>
              {(totals?.blockedCompanies > 0 || statusCounts.blocked > 0) && (
                <>
                  <span>•</span>
                  <span className="text-rose-700 font-semibold">{totals ? totals.blockedCompanies : statusCounts.blocked} Blocked</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">
              Total Forms Created
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {totals ? totals.totalForms : '—'}
            </div>
            <p className="text-[11px] text-slate-400">Across all tenant workspaces</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
              Total Leads Captured
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {totals ? totals.totalLeads : '—'}
            </div>
            <p className="text-[11px] text-slate-400">Cross-tenant lead pipeline</p>
          </div>
        </div>

        {/* Company Tenant Approvals & Management Card */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Company Tenant Approvals &amp; Statistics
                </h2>
                {statusCounts.pending > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                    {statusCounts.pending} Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Review and approve newly registered companies, monitor usage, or manage tenant access.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600">Total Tenants:</span>
              <span className="font-bold text-slate-900">{totals?.totalCompanies ?? statusCounts.all}</span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                id="super-admin-search-input"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by company name or email..."
                className="w-full pl-9 pr-9 py-2 rounded-xl text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all text-slate-900 placeholder:text-slate-400"
              />
              {searchInput && (
                <button
                  type="button"
                  id="super-admin-clear-search-btn"
                  onClick={handleClearSearch}
                  title="Clear search"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <span className="text-sm font-bold">✕</span>
                </button>
              )}
            </div>

            {searchTerm && (
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 self-start sm:self-center">
                <span>Active search:</span>
                <span className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                  &ldquo;{searchTerm}&rdquo;
                </span>
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="text-slate-400 hover:text-slate-600 underline text-[10px] cursor-pointer ml-1"
                >
                  Reset
                </button>
              </div>
            )}
          </div>

          {/* Status Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Company Status Filters">
              {/* Pending Filter */}
              <button
                type="button"
                id="filter-pending-btn"
                role="tab"
                aria-selected={selectedStatus === 'pending'}
                onClick={() => handleFilterChange('pending')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  selectedStatus === 'pending'
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${selectedStatus === 'pending' ? 'bg-white' : 'bg-amber-500'}`} />
                <span>Pending</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedStatus === 'pending'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {statusCounts.pending}
                </span>
              </button>

              {/* Approved Filter */}
              <button
                type="button"
                id="filter-approved-btn"
                role="tab"
                aria-selected={selectedStatus === 'approved'}
                onClick={() => handleFilterChange('approved')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  selectedStatus === 'approved'
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${selectedStatus === 'approved' ? 'bg-white' : 'bg-emerald-500'}`} />
                <span>Approved</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedStatus === 'approved'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {statusCounts.approved}
                </span>
              </button>

              {/* Blocked Filter */}
              <button
                type="button"
                id="filter-blocked-btn"
                role="tab"
                aria-selected={selectedStatus === 'blocked'}
                onClick={() => handleFilterChange('blocked')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  selectedStatus === 'blocked'
                    ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${selectedStatus === 'blocked' ? 'bg-white' : 'bg-rose-500'}`} />
                <span>Blocked</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedStatus === 'blocked'
                      ? 'bg-rose-700 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {statusCounts.blocked}
                </span>
              </button>

              {/* All Companies Filter */}
              <button
                type="button"
                id="filter-all-btn"
                role="tab"
                aria-selected={selectedStatus === 'all'}
                onClick={() => handleFilterChange('all')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  selectedStatus === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-800'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${selectedStatus === 'all' ? 'bg-white' : 'bg-indigo-500'}`} />
                <span>All Companies</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedStatus === 'all'
                      ? 'bg-indigo-700 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {statusCounts.all}
                </span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500 self-end sm:self-center flex items-center gap-1.5">
              <span>Sorting:</span>
              <span className="font-semibold text-slate-700">Newest first</span>
            </div>
          </div>

          {/* Table Error Banner */}
          {tableError && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between">
              <span>{tableError}</span>
              <button
                type="button"
                onClick={() => setTableError(null)}
                className="text-rose-500 hover:text-rose-700 font-bold px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Loading Indicator */}
          {isFetchingCompanies && (
            <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <span>Loading companies...</span>
            </div>
          )}

          {/* Empty State */}
          {!isFetchingCompanies && companies.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="font-semibold text-slate-700">
                {searchTerm
                  ? 'No companies match your search.'
                  : selectedStatus === 'pending'
                  ? 'No pending companies found.'
                  : selectedStatus === 'approved'
                  ? 'No approved companies found.'
                  : selectedStatus === 'blocked'
                  ? 'No blocked companies found.'
                  : 'No registered companies found.'}
              </span>
              <p className="text-[11px] text-slate-400">
                {searchTerm
                  ? `No companies matching "${searchTerm}" were found under ${selectedStatus === 'all' ? 'any status' : selectedStatus + ' status'}.`
                  : selectedStatus === 'pending'
                  ? 'All submitted company registrations have been processed.'
                  : 'Companies matching this filter will appear here.'}
              </p>
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="mt-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            !isFetchingCompanies && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                      <th className="py-3.5 px-4">Company Name</th>
                      <th className="py-3.5 px-4">Administrator</th>
                      <th className="py-3.5 px-4">Contact Details</th>
                      <th className="py-3.5 px-3 text-center">Forms</th>
                      <th className="py-3.5 px-3 text-center">Leads</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">Approval Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {companies.map((comp) => {
                      const isPending = comp.status === 'pending';
                      const isApproved = comp.status === 'approved';
                      const isUpdating = updatingCompanyId === comp.id;

                      return (
                        <tr key={comp.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-4 px-4 font-semibold text-slate-900">
                            <div>{comp.name}</div>
                            {comp.createdAt && (
                              <div className="text-[10px] font-normal text-slate-400">
                                Registered {new Date(comp.createdAt).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-slate-700">
                            {comp.contactName || '—'}
                          </td>
                          <td className="py-4 px-4 text-slate-500 font-mono text-[11px]">
                            <div>{comp.contactEmail}</div>
                            {comp.contactPhone && <div className="text-slate-400 font-sans text-[10px]">{comp.contactPhone}</div>}
                          </td>
                          <td className="py-4 px-3 text-center font-semibold text-slate-700">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-mono text-[11px]">
                              {comp.formsCount ?? 0}
                            </span>
                          </td>
                          <td className="py-4 px-3 text-center font-semibold text-indigo-600">
                            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[11px]">
                              {comp.leadsCount ?? 0}
                            </span>
                          </td>
                          <td className="py-4 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                isApproved
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : isPending
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isApproved ? 'bg-emerald-500' : isPending ? 'bg-amber-500' : 'bg-rose-500'
                                }`}
                              />
                              {comp.status}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              {isPending && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(comp.id, 'approved')}
                                  disabled={isUpdating}
                                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {isUpdating ? 'Updating...' : 'Approve'}
                                </button>
                              )}
                              {isApproved && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(comp.id, 'blocked')}
                                  disabled={isUpdating}
                                  className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {isUpdating ? 'Updating...' : 'Block'}
                                </button>
                              )}
                              {comp.status === 'blocked' && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(comp.id, 'approved')}
                                  disabled={isUpdating}
                                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {isUpdating ? 'Updating...' : 'Unblock'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Server-Side Pagination Bar */}
          {!isFetchingCompanies && pagination.totalRecords > 0 && (
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Showing <strong className="text-slate-900">{startRecord}–{endRecord}</strong> of{' '}
                  <strong className="text-slate-900">{pagination.totalRecords}</strong> companies
                </span>
                <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200">
                  <label htmlFor="page-size-select" className="text-slate-500 text-[11px]">
                    Per page:
                  </label>
                  <select
                    id="page-size-select"
                    value={limit}
                    onChange={(e) => handleLimitChange(Number(e.target.value))}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                {/* Previous Button */}
                <button
                  type="button"
                  id="pagination-prev-btn"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  disabled={page <= 1 || isFetchingCompanies}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  ‹ Previous
                </button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                    .filter((p) => {
                      return (
                        p === 1 ||
                        p === pagination.totalPages ||
                        (p >= page - 1 && p <= page + 1)
                      );
                    })
                    .map((p, idx, arr) => {
                      const prevPageNum = arr[idx - 1];
                      const hasGap = prevPageNum && p - prevPageNum > 1;

                      return (
                        <span key={p} className="flex items-center gap-1">
                          {hasGap && <span className="px-1 text-slate-400">…</span>}
                          <button
                            type="button"
                            onClick={() => setPage(p)}
                            disabled={isFetchingCompanies}
                            className={`min-w-8 h-8 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                              p === page
                                ? 'bg-indigo-600 text-white shadow-xs'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {p}
                          </button>
                        </span>
                      );
                    })}
                </div>

                {/* Next Button */}
                <button
                  type="button"
                  id="pagination-next-btn"
                  onClick={() => setPage((prev) => Math.min(prev + 1, pagination.totalPages))}
                  disabled={page >= pagination.totalPages || isFetchingCompanies}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs transition-colors cursor-pointer flex items-center gap-1"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200/80 bg-white py-4 text-center text-xs text-slate-500">
        Company Lead Tracker • Enterprise Edition
      </footer>
    </div>
  );
}
