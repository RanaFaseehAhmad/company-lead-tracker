'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

export default function DashboardLayout({
  children,
  breadcrumbs = [],
  title = '',
  description = '',
  actions = null,
  fullWidth = false,
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newLeadsCount, setNewLeadsCount] = useState(0);

  // Dynamic sidebar count for 'New' leads
  useEffect(() => {
    let isMounted = true;

    async function fetchNewLeadsCount() {
      try {
        const res = await fetch('/api/leads?status=new&limit=1', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success && data.pagination) {
            setNewLeadsCount(data.pagination.total || 0);
          }
        }
      } catch {
        // Silently handle count failure
      }
    }

    fetchNewLeadsCount();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchNewLeadsCount();
      }
    }, 4000);

    const handleLeadStatusUpdated = () => {
      fetchNewLeadsCount();
    };

    window.addEventListener('lead-status-updated', handleLeadStatusUpdated);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('lead-status-updated', handleLeadStatusUpdated);
    };
  }, []);

  // Authenticate Company Admin
  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) {
          if (isMounted) {
            router.replace('/login');
          }
          return;
        }

        const data = await res.json();
        if (!data.success || !data.user || data.user.role !== 'company_admin') {
          if (isMounted) {
            router.replace('/login');
          }
          return;
        }

        if (isMounted) {
          setSession(data);
        }
      } catch {
        if (isMounted) {
          router.replace('/login');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // Close mobile drawer on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on signout
    } finally {
      // Hard navigation ensures client-side cache and router state are completely purged across tenant logout
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login';
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-xs font-medium">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const { user, company } = session || {};

  const navItems = [
    {
      name: 'Overview',
      href: '/dashboard/company-admin',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1.5" strokeWidth="2" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" strokeWidth="2" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" strokeWidth="2" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" strokeWidth="2" />
        </svg>
      ),
      isActive: pathname === '/dashboard/company-admin',
    },
    {
      name: 'Leads',
      href: '/dashboard/company-admin/leads',
      badge: newLeadsCount > 0 ? newLeadsCount : null,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      isActive: pathname.startsWith('/dashboard/company-admin/leads'),
    },
    {
      name: 'Lead Forms',
      href: '/dashboard/company-admin/forms',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      isActive: pathname.startsWith('/dashboard/company-admin/forms'),
    },
    {
      name: 'Settings',
      href: '/dashboard/company-admin/settings',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      isActive: pathname.startsWith('/dashboard/company-admin/settings'),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row text-slate-800">
      {/* Mobile Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Sidebar (Desktop fixed, Mobile off-canvas drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Brand & Organization Block */}
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <Link href="/dashboard/company-admin" className="flex items-center gap-3 group">
              <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shadow-indigo-600/20 group-hover:bg-indigo-700 transition-colors">
                LT
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm text-slate-900 truncate">Lead Tracker</div>
                <div className="text-[11px] text-slate-500 font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{company?.name || 'Workspace'}</span>
                </div>
              </div>
            </Link>

            {/* Close button on mobile */}
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tenant Status Pill */}
          <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Tenant Status</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {company?.status || 'Active'}
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-colors ${
                  item.isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium'
                }`}
              >
                <span className={item.isActive ? 'text-indigo-600' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.name}</span>
                {item.badge !== null && item.badge !== undefined && (
                  <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-2xs">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          {/* User Account & Logout Footer */}
          <div className="p-3 border-t border-slate-100 bg-white">
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200/60">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
                  {user?.name ? user.name.slice(0, 2).toUpperCase() : 'CA'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{user?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                title="Sign out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-xs">
          <div className="flex items-center gap-3">
            {/* Hamburger Button on Mobile */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Open sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Breadcrumb Trail */}
            <nav className="flex items-center gap-2 text-xs" aria-label="Breadcrumb">
              <Link
                href="/dashboard/company-admin"
                className="text-slate-500 hover:text-slate-900 transition-colors font-medium"
              >
                Dashboard
              </Link>
              {breadcrumbs.map((crumb, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-slate-300">/</span>
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="text-slate-500 hover:text-slate-900 transition-colors font-medium"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-slate-900 font-semibold">{crumb.label}</span>
                  )}
                </div>
              ))}
            </nav>
          </div>

          {/* Header Right Actions */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {company?.name}
            </span>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="hidden sm:flex px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs transition-colors cursor-pointer"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </header>

        {/* Page Content Body */}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 ${fullWidth ? 'w-full' : 'max-w-7xl w-full mx-auto'}`}>
          {(title || actions) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-2">
              <div>
                {title && <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>}
                {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
              </div>
              {actions && <div className="flex items-center gap-3">{actions}</div>}
            </div>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
