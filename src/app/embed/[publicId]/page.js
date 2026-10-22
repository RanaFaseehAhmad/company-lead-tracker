'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams } from 'next/navigation';
import FormRenderer from '@/components/FormRenderer';

function PublicFormContent() {
  const params = useParams();
  const publicId = params?.publicId;

  const [formMetadata, setFormMetadata] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Fetch form definition
  useEffect(() => {
    if (!publicId) return;

    let isMounted = true;

    async function loadFormMetadata() {
      try {
        setLoadError(null);
        setIsLoading(true);

        const res = await fetch(`/api/public/forms/${publicId}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        });
        const result = await res.json();

        if (!res.ok || !result.success || !result.data) {
          throw new Error(result.error || 'This form is currently unavailable or has been unpublished.');
        }

        if (!isMounted) return;
        setFormMetadata(result.data);
      } catch (err) {
        if (isMounted) setLoadError(err.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadFormMetadata();

    return () => {
      isMounted = false;
    };
  }, [publicId]);

  // Handle Form Submission
  async function handleSubmit(formData) {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/public/forms/${publicId}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: formData }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Failed to submit form. Please review your inputs.');
      }

      setIsSuccess(true);
    } catch (err) {
      setSubmitError(err.message || 'Submission failed. Please try again.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <p className="text-xs text-slate-500 font-medium mt-3">Loading form...</p>
      </div>
    );
  }

  // Error loading form
  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-12 w-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-slate-900">Form Unavailable</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">{loadError}</p>
      </div>
    );
  }

  // Success view
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 max-w-md w-full shadow-xs">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900">Thank You!</h2>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            Your inquiry has been successfully submitted to{' '}
            <span className="font-semibold text-slate-900">{formMetadata?.companyName || 'the organization'}</span>.
            A representative will review your request shortly.
          </p>

          <button
            type="button"
            onClick={() => setIsSuccess(false)}
            className="mt-6 inline-flex items-center justify-center h-9 px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Submit Another Response
          </button>
        </div>
      </div>
    );
  }

  // Render form
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 px-4 sm:px-6">
      <div className="max-w-xl w-full mx-auto bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs">
        {/* Form attribution header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100 text-[11px] text-slate-400">
          <span>{formMetadata?.companyName ? `Presented by ${formMetadata.companyName}` : 'Lead Capture Form'}</span>
          <span className="font-semibold text-indigo-600">Verified Organization</span>
        </div>

        {submitError && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{submitError}</span>
          </div>
        )}

        <FormRenderer
          fields={formMetadata?.fields || []}
          title={formMetadata?.title || formMetadata?.name || ''}
          description={formMetadata?.description || ''}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitButtonLabel="Submit Inquiry"
        />

        <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
          <span>Protected by Multi-Tenant Form Engine</span>
          <span>Company Lead Tracker</span>
        </div>
      </div>
    </div>
  );
}

export default function PublicFormPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      }
    >
      <PublicFormContent />
    </Suspense>
  );
}
