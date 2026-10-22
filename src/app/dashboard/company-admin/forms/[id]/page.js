import { Suspense } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';

export const instant = false;

export default async function EditFormPage(props) {
  const params = await props.params;
  const formId = params?.id;

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: 'Lead Forms', href: '/dashboard/company-admin/forms' },
        { label: 'Edit Form' },
      ]}
      fullWidth={true}
    >
      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Loading...</div>}>
        <div className="max-w-2xl mx-auto py-12 px-4 text-center">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xs space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200/60">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-slate-900">Form Editing Temporarily Disabled</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              Existing form editing is currently paused while we upgrade form stabilization. All existing published forms, public URLs, embeds, and incoming lead captures continue working without interruption.
            </p>
            <div className="pt-2">
              <Link
                href="/dashboard/company-admin/forms"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-2xs"
              >
                Back to Lead Forms
              </Link>
            </div>
          </div>
        </div>
      </Suspense>
    </DashboardLayout>
  );
}
