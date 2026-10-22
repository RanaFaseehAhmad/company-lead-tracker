'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Validation & status states
  const [fieldErrors, setFieldErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [companyStatus, setCompanyStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validateForm() {
    const errors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      errors.email = 'Email address is required.';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.email = 'Please enter a valid email address.';
      }
    }

    if (!password) {
      errors.password = 'Password is required.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setAuthError('');
    setCompanyStatus(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setAuthError(data.error || 'Authentication failed. Please check your credentials.');
        if (data.companyStatus) {
          setCompanyStatus(data.companyStatus);
        }
        setIsSubmitting(false);
        return;
      }

      // Successful login redirect based on role
      const destination =
        data.destination ||
        data.redirectTo ||
        (data.user?.role === 'super_admin' ? '/dashboard/super-admin' : '/dashboard/company-admin');
      router.push(destination);
    } catch {
      setAuthError('Unable to connect to server. Please check your connection and try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center">
      <div className="w-full min-h-screen grid grid-cols-1 lg:grid-cols-12">
        {/* Left Informational & Branding Panel (Desktop Only) */}
        <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 bg-white p-12 xl:p-16 flex-col justify-between border-r border-slate-200">
          <div>
            {/* Brand Header */}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/20">
                LT
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight text-slate-900 block">
                  Company Lead Tracker
                </span>
                <span className="text-xs text-indigo-600 font-semibold block">
                  Multi-Tenant CRM &amp; Lead Management
                </span>
              </div>
            </div>

            {/* Main Value Proposition */}
            <div className="mt-16 xl:mt-24 max-w-xl space-y-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                Enterprise Platform
              </span>
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Streamline company lead capture and multi-tenant pipeline governance.
              </h1>
              <p className="text-slate-600 text-sm leading-relaxed">
                A unified architecture for managing verified companies, dynamic lead generation forms, and real-time sales pipeline tracking.
              </p>
            </div>

            {/* Feature Highlights */}
            <div className="mt-12 space-y-3.5 max-w-lg">
              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Company Governance</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Super Admin approval workflows with strict tenant boundary isolation.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Lead Qualification Pipeline</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Categorize incoming leads from New to Won with verified stage histories.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Secure Token Sessions</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Signed JWT cookies with HTTP-only protection and strict role authorization.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-100 pt-6 flex items-center justify-between">
            <span>© 2026 Company Lead Tracker</span>
            <span>Enterprise Edition</span>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="col-span-1 lg:col-span-6 xl:col-span-5 flex flex-col justify-center px-6 sm:px-12 md:px-16 lg:px-12 xl:px-16 py-12 bg-slate-50">
          <div className="max-w-md w-full mx-auto">
            {/* Mobile Brand Header */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8">
              <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/20">
                LT
              </div>
              <div>
                <span className="font-bold text-base text-slate-900 block">Company Lead Tracker</span>
                <span className="text-[11px] text-indigo-600 font-semibold block">Multi-Tenant CRM</span>
              </div>
            </div>

            {/* Title & Subtitle */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to your account</h2>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Enter your credentials to access your organization dashboard.
              </p>
            </div>

            {/* Error & Status Alert */}
            {authError && (
              <div
                role="alert"
                className={`mb-6 p-4 rounded-2xl border text-xs flex items-start gap-3 transition-all ${
                  companyStatus === 'pending'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-800'
                    : companyStatus === 'blocked'
                    ? 'bg-rose-50/80 border-rose-200 text-rose-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {companyStatus === 'pending' ? (
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                </div>
                <div>
                  <span className="font-semibold block mb-0.5">
                    {companyStatus === 'pending'
                      ? 'Company Pending Approval'
                      : companyStatus === 'blocked'
                      ? 'Account Suspended'
                      : 'Authentication Error'}
                  </span>
                  <span>{authError}</span>
                </div>
              </div>
            )}

            {/* Form Card */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-7 shadow-xs">
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {/* Email Field */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="email-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <input
                      id="email-input"
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) {
                          setFieldErrors((prev) => ({ ...prev, email: null }));
                        }
                      }}
                      placeholder="name@company.com"
                      disabled={isSubmitting}
                      className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-800 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                        fieldErrors.email
                          ? 'border-rose-400 focus:ring-rose-500/20'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                      }`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                      <span>•</span> {fieldErrors.email}
                    </p>
                  )}
                </div>

                {/* Password Field */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="password-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password-input"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) {
                          setFieldErrors((prev) => ({ ...prev, password: null }));
                        }
                      }}
                      placeholder="Enter your password"
                      disabled={isSubmitting}
                      className={`w-full h-11 pl-3.5 pr-11 rounded-xl bg-white border text-xs text-slate-800 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                        fieldErrors.password
                          ? 'border-rose-400 focus:ring-rose-500/20'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    >
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                      <span>•</span> {fieldErrors.password}
                    </p>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 mt-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold text-xs transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {isSubmitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Verifying credentials...</span>
                    </>
                  ) : (
                    <span>Sign in</span>
                  )}
                </button>
              </form>

              {/* Registration Link */}
              <div className="mt-5 pt-5 border-t border-slate-100 text-center">
                <p className="text-xs text-slate-600">
                  New company?{' '}
                  <Link
                    href="/register"
                    className="font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    Register your company
                  </Link>
                </p>
              </div>
            </div>

            {/* Note on provisioning */}
            <div className="mt-8 text-center">
              <p className="text-xs text-slate-500 leading-relaxed">
                Company Admin accounts are provisioned by your system Super Admin.
                <br />
                Contact your platform administrator if you require credentials.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
