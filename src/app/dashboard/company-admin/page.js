'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';

export default function CompanyAdminDashboard() {
  const [stats, setStats] = useState({
    formsTotal: 0,
    formsPublished: 0,
    leadsTotal: 0,
  });
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isSubscribed = true;

    async function loadData(isPolling = false) {
      if (!isPolling) setIsLoading(true);
      try {
        const [authRes, formsRes, leadsRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/forms'),
          fetch('/api/leads?limit=1'),
        ]);

        if (authRes.status === 401) {
          return;
        }

        const authData = await authRes.json();
        const formsData = await formsRes.json();
        const leadsData = await leadsRes.json();

        if (!isSubscribed) return;

        if (authData.success) {
          setSession(authData);
        }

        const forms = formsData.success && Array.isArray(formsData.data) ? formsData.data : [];
        const leadsCount = leadsData.success && leadsData.pagination ? leadsData.pagination.total : 0;

        setStats({
          formsTotal: forms.length,
          formsPublished: forms.filter((f) => f.status === 'published').length,
          leadsTotal: leadsCount,
        });
      } catch {
        // Handled silently
      } finally {
        if (!isPolling && isSubscribed) {
          setIsLoading(false);
        }
      }
    }

    loadData(false);

    // Visibility-aware background polling for real-time overview metrics
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, 4000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const { user, company } = session || {};

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Overview' }]}
      title="Company Overview"
      description={`Workspace for ${company?.name || 'your company'}`}
    >
      <div className="space-y-6">
        {/* Verification Alert Banner */}
        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span>
              <strong>Tenant Authorized:</strong> Active session authenticated and scoped strictly to{' '}
              <strong>{company?.name}</strong>.
            </span>
          </div>
          <span className="hidden sm:inline font-mono text-[11px] text-emerald-700">
            Status: {company?.status || 'approved'}
          </span>
        </div>

        {/* Feature Spotlight: Dynamic Form Builder */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-7 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                Lead Capture Engine
              </span>
              <h2 className="text-lg font-bold text-slate-900">Dynamic Form Builder &amp; Embeds</h2>
              <p className="text-xs text-slate-500 max-w-2xl">
                Build custom lead-capture forms with 5 field types, live preview, unique public URLs, and one-click iframe embedding for your external website.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/dashboard/company-admin/forms"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-xs transition-colors"
              >
                Manage Forms
              </Link>
              <Link
                href="/dashboard/company-admin/forms/new"
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-2xs transition-colors"
              >
                + New Form
              </Link>
            </div>
          </div>
        </div>

        {/* Metrics Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Total Forms
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : stats.formsTotal}
            </div>
            <p className="text-[11px] text-slate-400">Created in workspace</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Published Forms
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : stats.formsPublished}
            </div>
            <p className="text-[11px] text-slate-400">Accepting public responses</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">
              Total Inbound Leads
            </span>
            <div className="text-2xl font-bold text-slate-900">
              {isLoading ? <div className="h-7 w-12 bg-slate-100 rounded animate-pulse" /> : stats.leadsTotal}
            </div>
            <p className="text-[11px] text-slate-400">Captured in pipeline</p>
          </div>
        </div>

        {/* Tenant Details Card */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-7 space-y-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Company Account Details</h3>
              <p className="text-xs text-slate-500 mt-0.5">Verified tenant information</p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              Verified Tenant
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50/70 border border-slate-200/60 p-4 rounded-xl space-y-1">
              <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Administrator</span>
              <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>

            <div className="bg-slate-50/70 border border-slate-200/60 p-4 rounded-xl space-y-1">
              <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Company</span>
              <p className="text-sm font-semibold text-slate-900">{company?.name}</p>
              <p className="text-xs font-slate-500 text-slate-500 font-mono truncate">ID: {company?.id}</p>
            </div>

            <div className="bg-slate-50/70 border border-slate-200/60 p-4 rounded-xl space-y-1">
              <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Status</span>
              <p className="text-sm font-semibold text-emerald-700 capitalize flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {company?.status || 'approved'}
              </p>
              <p className="text-xs text-slate-400">Full tenant permissions</p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
