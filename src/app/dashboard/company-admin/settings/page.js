'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';

export default function CompanySettingsPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    website: '',
    address: '',
    status: '',
    id: '',
  });

  const [initialData, setInitialData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await fetch('/api/company/settings');
        if (res.status === 401) {
          router.replace('/login');
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          setErrorMessage(data.error || 'Failed to load company profile.');
        } else if (data.company) {
          const profile = {
            name: data.company.name || '',
            contactName: data.company.contactName || '',
            contactEmail: data.company.contactEmail || '',
            contactPhone: data.company.contactPhone || '',
            website: data.company.website || '',
            address: data.company.address || '',
            status: data.company.status || 'pending',
            id: data.company.id || '',
          };
          setFormData(profile);
          setInitialData(profile);
        }
      } catch {
        setErrorMessage('Network error while connecting to server.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchSettings();
  }, [router]);

  function handleInputChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: null }));
    }
  }

  function validate() {
    const errors = {};
    if (!formData.name.trim()) {
      errors.name = 'Company name is required.';
    } else if (formData.name.trim().length > 120) {
      errors.name = 'Company name cannot exceed 120 characters.';
    }

    if (formData.contactEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.contactEmail.trim())) {
        errors.contactEmail = 'Please provide a valid email address.';
      }
    }

    if (formData.contactPhone && formData.contactPhone.length > 30) {
      errors.contactPhone = 'Phone number cannot exceed 30 characters.';
    }

    if (formData.website && formData.website.length > 200) {
      errors.website = 'Website URL cannot exceed 200 characters.';
    }

    if (formData.address && formData.address.length > 300) {
      errors.address = 'Business address cannot exceed 300 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setIsSaving(true);
    setSaveSuccess(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/company/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          contactName: formData.contactName.trim(),
          contactEmail: formData.contactEmail.trim(),
          contactPhone: formData.contactPhone.trim(),
          website: formData.website.trim(),
          address: formData.address.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.error || 'Failed to save company settings.');
      } else {
        setSaveSuccess('Company profile details saved successfully.');
        if (data.company) {
          const updated = {
            ...formData,
            name: data.company.name,
            contactName: data.company.contactName || '',
            contactEmail: data.company.contactEmail || '',
            contactPhone: data.company.contactPhone || '',
            website: data.company.website || '',
            address: data.company.address || '',
          };
          setFormData(updated);
          setInitialData(updated);
        }
        setTimeout(() => setSaveSuccess(null), 5000);
      }
    } catch {
      setErrorMessage('Network error while saving settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset() {
    if (initialData) {
      setFormData(initialData);
      setFieldErrors({});
      setSaveSuccess(null);
      setErrorMessage(null);
    }
  }

  const hasChanges =
    initialData &&
    (formData.name !== initialData.name ||
      formData.contactName !== initialData.contactName ||
      formData.contactEmail !== initialData.contactEmail ||
      formData.contactPhone !== initialData.contactPhone ||
      formData.website !== initialData.website ||
      formData.address !== initialData.address);

  if (isLoading) {
    return (
      <DashboardLayout
        breadcrumbs={[{ label: 'Settings' }]}
        title="Company Settings"
        description="Manage your organization profile and contact information"
      >
        <div className="bg-white border border-slate-200/80 rounded-2xl p-12 flex flex-col items-center justify-center gap-3 shadow-xs">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-xs text-slate-500 font-medium">Loading company settings...</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      breadcrumbs={[{ label: 'Settings' }]}
      title="Company Settings"
      description="Manage your organization profile, contact information, and business details"
    >
      <div className="max-w-4xl space-y-6">
        {/* Status / Alert Messages */}
        {saveSuccess && (
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span>{saveSuccess}</span>
            </div>
            <button
              onClick={() => setSaveSuccess(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-medium flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-700 hover:text-rose-900 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Company Overview & Status Card */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900">Organization Profile</h2>
              <p className="text-xs text-slate-500">
                Your company identity is verified and isolated under tenant governance.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-slate-500 font-medium">Account Status:</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {formData.status ? formData.status.toUpperCase() : 'APPROVED'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-0.5">
              <span className="text-slate-400 font-medium">Tenant ID</span>
              <p className="font-mono text-slate-700 select-all truncate">{formData.id}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-0.5">
              <span className="text-slate-400 font-medium">Security Governance</span>
              <p className="text-slate-700 font-medium">Strict Multi-Tenant Isolation Enforced</p>
            </div>
          </div>
        </div>

        {/* Edit Company Details Form */}
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-900">General Information</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Update your primary business details and public contact credentials.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Company Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Company Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="e.g. Acme Corporation"
                className={`w-full px-3.5 py-2.5 rounded-xl border bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors ${
                  fieldErrors.name ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'
                }`}
              />
              {fieldErrors.name && (
                <p className="text-[11px] text-rose-600 font-medium">{fieldErrors.name}</p>
              )}
            </div>

            {/* Contact Person Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Contact Person
              </label>
              <input
                type="text"
                name="contactName"
                value={formData.contactName}
                onChange={handleInputChange}
                placeholder="e.g. Jane Doe"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors"
              />
            </div>

            {/* Business Email */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Business / Contact Email
              </label>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleInputChange}
                placeholder="contact@company.com"
                className={`w-full px-3.5 py-2.5 rounded-xl border bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors ${
                  fieldErrors.contactEmail ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'
                }`}
              />
              {fieldErrors.contactEmail && (
                <p className="text-[11px] text-rose-600 font-medium">{fieldErrors.contactEmail}</p>
              )}
            </div>

            {/* Phone Number */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Phone Number
              </label>
              <input
                type="tel"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleInputChange}
                placeholder="+1-555-0100"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors"
              />
            </div>

            {/* Company Website */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                Company Website
              </label>
              <input
                type="url"
                name="website"
                value={formData.website}
                onChange={handleInputChange}
                placeholder="https://www.company.com"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors"
              />
            </div>

            {/* Business Address */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                Business Address
              </label>
              <textarea
                name="address"
                rows={3}
                value={formData.address}
                onChange={handleInputChange}
                placeholder="123 Corporate Blvd, Suite 400, San Francisco, CA 94105"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-colors resize-none"
              />
            </div>
          </div>

          {/* Form Actions Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {hasChanges ? 'You have unsaved changes.' : 'All changes saved.'}
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasChanges || isSaving}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={!hasChanges || isSaving}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Security & Multi-Tenant Governance Notice */}
        <div className="p-4 rounded-2xl bg-slate-100/70 border border-slate-200/60 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-700">Security &amp; Administrative Governance</p>
          <p>
            Privileged fields including your tenant approval status, role permissions, and platform entitlements are managed by the Super Admin governance layer. All changes made here persist across your organization forms, lead pipelines, and CSV exports.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
