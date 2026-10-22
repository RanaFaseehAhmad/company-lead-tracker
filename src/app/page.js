import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur-xs px-6 sm:px-10 py-4 flex items-center justify-between shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-600/20 text-sm">
            LT
          </div>
          <div>
            <span className="font-bold text-base sm:text-lg text-slate-900 block leading-tight">
              Company Lead Tracker
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Multi-Tenant Lead Pipeline &amp; Form Engine
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/register"
            className="px-3.5 sm:px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm shadow-2xs transition-colors"
          >
            Register Company
          </Link>
          <Link
            href="/login"
            className="px-4 sm:px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm shadow-xs transition-colors"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Main Hero & Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-12 sm:py-16 flex flex-col justify-center">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 sm:p-12 shadow-xs space-y-10">
          {/* Hero Section */}
          <div className="space-y-4 max-w-3xl">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
              Enterprise Lead Management
            </span>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Capture, qualify, and convert leads with complete tenant isolation.
            </h1>

            <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-2xl">
              A modern multi-tenant platform designed for growing companies. Build dynamic lead-capture forms, track submissions in real time, and streamline your sales pipeline with verified organizational governance.
            </p>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm transition-all"
              >
                <span>Sign In to Workspace</span>
                <span>→</span>
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center justify-center px-4.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm shadow-2xs transition-colors"
              >
                Register Company
              </Link>
            </div>
          </div>

          {/* Feature Highlights Grid */}
          <div className="pt-8 border-t border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Feature 1 */}
              <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-6 space-y-2.5">
                <div className="h-9 w-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-slate-900">Dynamic Form Engine</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Design lead-capture forms using Form.io components, generate responsive iframe embed codes, and share public links effortlessly.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-6 space-y-2.5">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-slate-900">Pipeline Tracking</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Automatically synchronize form submissions into company leads with status stages from initial inquiry to qualified conversion.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-6 space-y-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-slate-900">Tenant Isolation</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Strict multi-tenant boundaries ensure each organization manages only its verified forms, submissions, and qualified pipeline records.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 bg-white py-5 text-center text-xs text-slate-500">
        Company Lead Tracker • Enterprise Edition &copy; 2026. All rights reserved.
      </footer>
    </div>
  );
}
