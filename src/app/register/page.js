'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [registeredData, setRegisteredData] = useState(null);

  function validateForm() {
    const errors = {};

    if (!companyName.trim()) {
      errors.companyName = 'Company name is required.';
    } else if (companyName.trim().length > 120) {
      errors.companyName = 'Company name cannot exceed 120 characters.';
    }

    if (!adminName.trim()) {
      errors.adminName = 'Administrator name is required.';
    } else if (adminName.trim().length > 100) {
      errors.adminName = 'Administrator name cannot exceed 100 characters.';
    }

    const trimmedEmail = adminEmail.trim();
    if (!trimmedEmail) {
      errors.adminEmail = 'Work email address is required.';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.adminEmail = 'Please provide a valid work email address.';
      }
    }

    if (contactPhone.trim() && contactPhone.trim().length > 30) {
      errors.contactPhone = 'Contact phone number cannot exceed 30 characters.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters long.';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (confirmPassword !== password) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (!termsAccepted) {
      errors.termsAccepted = 'You must agree to the Terms of Service to register.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          contactPhone: contactPhone.trim(),
          password,
          confirmPassword,
          termsAccepted,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setServerError(data.error || 'Failed to submit registration. Please verify your details.');
        setIsSubmitting(false);
        return;
      }

      setRegisteredData({
        companyName: data.company?.name || companyName.trim(),
        adminEmail: data.user?.email || adminEmail.trim(),
      });
      setIsSuccess(true);
    } catch {
      setServerError('A network error occurred. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center">
      <div className="w-full min-h-screen grid grid-cols-1 lg:grid-cols-12">
        {/* Left Informational & Branding Panel (Desktop Only) */}
        <div className="hidden lg:flex lg:col-span-5 xl:col-span-6 bg-white p-12 xl:p-16 flex-col justify-between border-r border-slate-200">
          <div>
            {/* Brand Header */}
            <Link href="/" className="inline-flex items-center gap-3 group">
              <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/20 group-hover:bg-indigo-700 transition-colors">
                LT
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight text-slate-900 block">
                  Company Lead Tracker
                </span>
                <span className="text-xs text-indigo-600 font-semibold block">
                  Multi-Tenant Platform
                </span>
              </div>
            </Link>

            {/* Main Value Proposition */}
            <div className="mt-14 xl:mt-20 max-w-lg space-y-4">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                Company Onboarding
              </span>
              <h1 className="text-3xl xl:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Empower your business with high-conversion lead capture.
              </h1>
              <p className="text-slate-600 text-sm leading-relaxed">
                Register your organization to access custom dynamic forms, live visitor previews, seamless iframe embeds, and qualified pipeline management.
              </p>
            </div>

            {/* Registration Benefits List */}
            <div className="mt-10 space-y-3.5 max-w-md">
              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Dedicated Tenant Workspace</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Completely isolated MongoDB data model and strict role-based access control.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Drag &amp; Drop Form Builder</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Build multi-field forms with live preview and instant embed codes.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900">Admin Approval Governance</h2>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    New companies are verified and approved by the Super Admin before going live.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-100 pt-6 flex items-center justify-between">
            <span>© 2026 Company Lead Tracker</span>
            <Link href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
              Sign In
            </Link>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="col-span-1 lg:col-span-7 xl:col-span-6 flex flex-col justify-center px-6 sm:px-12 md:px-16 lg:px-10 xl:px-14 py-12 bg-slate-50">
          <div className="max-w-lg w-full mx-auto">
            {/* Mobile Brand Header */}
            <div className="lg:hidden flex items-center justify-between mb-8">
              <Link href="/" className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/20">
                  LT
                </div>
                <div>
                  <span className="font-bold text-base text-slate-900 block">Company Lead Tracker</span>
                  <span className="text-[11px] text-indigo-600 font-semibold block">Multi-Tenant CRM</span>
                </div>
              </Link>

              <Link
                href="/login"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Sign In
              </Link>
            </div>

            {/* Success State Screen */}
            {isSuccess ? (
              <div className="bg-white border border-slate-200/90 rounded-3xl p-7 sm:p-9 shadow-xs space-y-6 animate-in fade-in duration-200">
                <div className="h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <div className="space-y-2 border-b border-slate-100 pb-5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Registration Submitted
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Welcome to Company Lead Tracker!
                  </h2>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Your company account for <strong className="text-slate-900">{registeredData?.companyName}</strong> has been created and registered in the system.
                  </p>
                </div>

                {/* Pending Approval Notice Card */}
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs space-y-2">
                  <div className="font-bold flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Super Admin Approval Required</span>
                  </div>
                  <p className="text-amber-800 leading-relaxed text-[11px]">
                    In accordance with our platform security policy, new company workspaces start in <strong>Pending</strong> status. A system Super Admin will review and approve your registration shortly.
                  </p>
                  <p className="text-amber-700 text-[11px]">
                    Once approved, administrator credentials for <strong className="text-amber-950 font-mono">{registeredData?.adminEmail}</strong> will be authorized to access the dashboard.
                  </p>
                </div>

                {/* Action Button */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                  <Link
                    href="/login"
                    className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center transition-colors"
                  >
                    Return to Sign In
                  </Link>
                  <Link
                    href="/"
                    className="w-full sm:w-auto h-11 px-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs flex items-center justify-center transition-colors"
                  >
                    Home
                  </Link>
                </div>
              </div>
            ) : (
              /* Registration Form Screen */
              <>
                <div className="space-y-1.5 mb-7">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                    Register your company
                  </h2>
                  <p className="text-xs text-slate-500">
                    Create a new organization workspace to manage inbound leads and custom forms.
                  </p>
                </div>

                {/* Server Error Alert */}
                {serverError && (
                  <div
                    role="alert"
                    className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3 shadow-xs animate-in fade-in"
                  >
                    <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <span className="font-semibold block mb-0.5">Registration Error</span>
                      <span>{serverError}</span>
                    </div>
                  </div>
                )}

                {/* Registration Form Card */}
                <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs">
                  <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    {/* Company Name */}
                    <div className="space-y-1.5">
                      <label htmlFor="company-name-input" className="block text-xs font-semibold text-slate-700">
                        Company Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="company-name-input"
                        type="text"
                        name="companyName"
                        value={companyName}
                        onChange={(e) => {
                          setCompanyName(e.target.value);
                          if (fieldErrors.companyName) setFieldErrors((p) => ({ ...p, companyName: null }));
                        }}
                        placeholder="e.g. Acme Corporation"
                        disabled={isSubmitting}
                        maxLength={120}
                        className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                          fieldErrors.companyName
                            ? 'border-rose-400 focus:ring-rose-500/20'
                            : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                        }`}
                      />
                      {fieldErrors.companyName && (
                        <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                          <span>•</span> {fieldErrors.companyName}
                        </p>
                      )}
                    </div>

                    {/* Owner / Administrator Name */}
                    <div className="space-y-1.5">
                      <label htmlFor="admin-name-input" className="block text-xs font-semibold text-slate-700">
                        Administrator Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="admin-name-input"
                        type="text"
                        name="adminName"
                        value={adminName}
                        onChange={(e) => {
                          setAdminName(e.target.value);
                          if (fieldErrors.adminName) setFieldErrors((p) => ({ ...p, adminName: null }));
                        }}
                        placeholder="e.g. Jane Doe"
                        disabled={isSubmitting}
                        maxLength={100}
                        className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                          fieldErrors.adminName
                            ? 'border-rose-400 focus:ring-rose-500/20'
                            : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                        }`}
                      />
                      {fieldErrors.adminName && (
                        <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                          <span>•</span> {fieldErrors.adminName}
                        </p>
                      )}
                    </div>

                    {/* Work Email & Phone (Grid on sm+) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Work Email */}
                      <div className="space-y-1.5">
                        <label htmlFor="admin-email-input" className="block text-xs font-semibold text-slate-700">
                          Work Email <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="admin-email-input"
                          type="email"
                          name="adminEmail"
                          value={adminEmail}
                          onChange={(e) => {
                            setAdminEmail(e.target.value);
                            if (fieldErrors.adminEmail) setFieldErrors((p) => ({ ...p, adminEmail: null }));
                          }}
                          placeholder="jane@company.com"
                          disabled={isSubmitting}
                          className={`w-full h-11 px-3.5 rounded-xl bg-white border text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                            fieldErrors.adminEmail
                              ? 'border-rose-400 focus:ring-rose-500/20'
                              : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                          }`}
                        />
                        {fieldErrors.adminEmail && (
                          <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                            <span>•</span> {fieldErrors.adminEmail}
                          </p>
                        )}
                      </div>

                      {/* Contact Phone */}
                      <div className="space-y-1.5">
                        <label htmlFor="contact-phone-input" className="block text-xs font-semibold text-slate-700">
                          Contact Phone <span className="text-slate-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          id="contact-phone-input"
                          type="tel"
                          name="contactPhone"
                          value={contactPhone}
                          onChange={(e) => {
                            setContactPhone(e.target.value);
                            if (fieldErrors.contactPhone) setFieldErrors((p) => ({ ...p, contactPhone: null }));
                          }}
                          placeholder="+1 (555) 234-5678"
                          disabled={isSubmitting}
                          maxLength={30}
                          className="w-full h-11 px-3.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                        />
                        {fieldErrors.contactPhone && (
                          <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                            <span>•</span> {fieldErrors.contactPhone}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Password & Confirm Password (Grid on sm+) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Password */}
                      <div className="space-y-1.5">
                        <label htmlFor="password-input" className="block text-xs font-semibold text-slate-700">
                          Password <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <input
                            id="password-input"
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: null }));
                            }}
                            placeholder="At least 8 characters"
                            disabled={isSubmitting}
                            className={`w-full h-11 pl-3.5 pr-10 rounded-xl bg-white border text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
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
                            className="absolute right-0 top-0 h-11 w-10 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
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

                      {/* Confirm Password */}
                      <div className="space-y-1.5">
                        <label htmlFor="confirm-password-input" className="block text-xs font-semibold text-slate-700">
                          Confirm Password <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <input
                            id="confirm-password-input"
                            type={showConfirmPassword ? 'text' : 'password'}
                            name="confirmPassword"
                            value={confirmPassword}
                            onChange={(e) => {
                              setConfirmPassword(e.target.value);
                              if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: null }));
                            }}
                            placeholder="Re-type password"
                            disabled={isSubmitting}
                            className={`w-full h-11 pl-3.5 pr-10 rounded-xl bg-white border text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 ${
                              fieldErrors.confirmPassword
                                ? 'border-rose-400 focus:ring-rose-500/20'
                                : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/10'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            tabIndex={-1}
                            aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                            className="absolute right-0 top-0 h-11 w-10 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {showConfirmPassword ? (
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
                        {fieldErrors.confirmPassword && (
                          <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                            <span>•</span> {fieldErrors.confirmPassword}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Terms Checkbox */}
                    <div className="pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => {
                            setTermsAccepted(e.target.checked);
                            if (fieldErrors.termsAccepted) setFieldErrors((p) => ({ ...p, termsAccepted: null }));
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5 cursor-pointer shrink-0"
                        />
                        <span>
                          I agree to the <span className="font-semibold text-slate-800">Terms of Service</span> and acknowledge that company accounts require administrator approval.
                        </span>
                      </label>
                      {fieldErrors.termsAccepted && (
                        <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1">
                          <span>•</span> {fieldErrors.termsAccepted}
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
                          <span>Creating company account...</span>
                        </>
                      ) : (
                        <span>Register Company</span>
                      )}
                    </button>
                  </form>

                  {/* Sign In Link */}
                  <div className="mt-5 pt-5 border-t border-slate-100 text-center">
                    <p className="text-xs text-slate-600">
                      Already registered?{' '}
                      <Link
                        href="/login"
                        className="font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                      >
                        Sign in to your account
                      </Link>
                    </p>
                  </div>
                </div>

                <div className="mt-8 text-center">
                  <p className="text-xs text-slate-400">
                    All new registrations undergo verification to ensure tenant privacy and security.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
