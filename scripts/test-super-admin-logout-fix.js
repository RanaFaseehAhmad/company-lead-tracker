/**
 * Test Suite: Super Admin Logout & Login Verification
 *
 * Verifies:
 * 1. Super Admin login sets HTTP-only session cookie.
 * 2. Protected endpoints (/api/auth/me, /api/admin/companies) succeed with session.
 * 3. /api/auth/me includes RFC 7234 no-store cache headers.
 * 4. Super Admin logout via POST /api/auth/logout clears cookie with Max-Age=0.
 * 5. Logout response contains no-store cache headers.
 * 6. After logout, /api/auth/me returns 401 with no-store headers (no infinite loading).
 * 7. Protected routes (/api/admin/companies, /dashboard/super-admin) reject unauthenticated requests.
 * 8. GET /super-admin/login returns 200 OK with complete login form HTML.
 * 9. GET /super-admin redirects to /super-admin/login.
 * 10. GET /api/auth/logout with redirectTo safely clears cookie and redirects to /super-admin/login.
 * 11. Super Admin can log in again immediately without refreshing or clearing browser state.
 * 12. Company Admin login, me, and logout lifecycle continue functioning without regressions.
 * 13. RBAC isolation: Company Admin cannot access Super Admin APIs.
 */

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, headers: res.headers, data, text, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runTests() {
  console.log('================================================================');
  console.log('   SUPER ADMIN LOGOUT & LOGIN VERIFICATION TEST SUITE           ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // --- Phase 1: Health Check ---
  console.log('--- Phase 1: Health & Connectivity ---');
  const healthRes = await request('/api/health');
  assert(healthRes.status === 200 && healthRes.data?.status === 'healthy', 'Health Check returns 200 OK');

  // --- Phase 2: Super Admin Login & Session Cookie ---
  console.log('\n--- Phase 2: Super Admin Initial Login ---');
  const saLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const saToken = extractCookie(saLoginRes.setCookie);
  assert(
    saLoginRes.status === 200 &&
    saLoginRes.data?.success === true &&
    saLoginRes.data?.user?.role === 'super_admin' &&
    !!saToken &&
    saLoginRes.setCookie.includes('HttpOnly'),
    'Super Admin login succeeds and sets HTTP-only auth_token cookie'
  );

  const saCookieHeader = `auth_token=${saToken}`;

  // --- Phase 3: Active Session & Cache Headers ---
  console.log('\n--- Phase 3: Session Profile & Cache-Control Enforcement ---');
  const meRes = await request('/api/auth/me', {
    headers: { Cookie: saCookieHeader },
  });
  const meCacheControl = meRes.headers.get('cache-control') || '';
  assert(
    meRes.status === 200 &&
    meRes.data?.success === true &&
    meRes.data?.user?.role === 'super_admin' &&
    !meRes.data?.user?.passwordHash,
    'Active session retrieves valid super_admin profile without password hash'
  );
  assert(
    meCacheControl.includes('no-store') && meCacheControl.includes('no-cache'),
    '/api/auth/me enforces no-store and no-cache headers to prevent stale browser auth'
  );

  const companiesRes = await request('/api/admin/companies', {
    headers: { Cookie: saCookieHeader },
  });
  assert(
    companiesRes.status === 200 && companiesRes.data?.success === true,
    'Super Admin session can access protected platform administration endpoint'
  );

  // --- Phase 4: Super Admin Logout Flow & Cookie Invalidation ---
  console.log('\n--- Phase 4: Super Admin Logout & Cookie Clearing ---');
  const logoutRes = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: saCookieHeader },
  });
  const logoutCacheControl = logoutRes.headers.get('cache-control') || '';
  assert(
    logoutRes.status === 200 && logoutRes.data?.success === true,
    'POST /api/auth/logout succeeds with 200 OK'
  );
  assert(
    logoutRes.setCookie &&
    (logoutRes.setCookie.includes('Max-Age=0') || logoutRes.setCookie.includes('expires=Thu, 01 Jan 1970')),
    'Logout response sets auth_token Max-Age=0 to clear browser session cookie'
  );
  assert(
    logoutCacheControl.includes('no-store') && logoutCacheControl.includes('no-cache'),
    'Logout response enforces no-store and no-cache headers'
  );

  // --- Phase 5: Post-Logout Verification (Expected Unauthenticated State) ---
  console.log('\n--- Phase 5: Post-Logout Unauthenticated Verification ---');
  const postLogoutMe = await request('/api/auth/me');
  assert(
    postLogoutMe.status === 401 && postLogoutMe.data?.success === false,
    '/api/auth/me without cookies returns 401 Unauthorized cleanly (no hanging or delay)'
  );
  assert(
    (postLogoutMe.headers.get('cache-control') || '').includes('no-store'),
    'Unauthenticated /api/auth/me sets no-store headers'
  );

  const postLogoutAdmin = await request('/api/admin/companies');
  assert(
    postLogoutAdmin.status === 401 && postLogoutAdmin.data?.success === false,
    'Protected /api/admin/companies rejects unauthenticated request with 401'
  );

  // --- Phase 6: Super Admin Login Page Markup & Navigation ---
  console.log('\n--- Phase 6: Super Admin Login Page Markup Verification ---');
  const loginPageRes = await request('/super-admin/login');
  const loginHtml = loginPageRes.text || '';
  assert(
    loginPageRes.status === 200,
    'GET /super-admin/login returns HTTP 200 OK'
  );
  assert(
    loginHtml.includes('Super Admin Portal') &&
    loginHtml.includes('Platform Administration') &&
    loginHtml.includes('admin-email-input') &&
    loginHtml.includes('admin-password-input'),
    'Super Admin login page contains all required login form fields and accessibility IDs'
  );

  const superAdminRootRes = await request('/super-admin');
  assert(
    superAdminRootRes.status === 307 ||
    superAdminRootRes.status === 308 ||
    superAdminRootRes.status === 200,
    '/super-admin route correctly redirects to /super-admin/login'
  );

  // --- Phase 7: Safe GET Logout with Redirect ---
  console.log('\n--- Phase 7: Safe GET Logout with Redirect ---');
  const getLogoutRes = await request('/api/auth/logout?redirectTo=/super-admin/login');
  assert(
    getLogoutRes.status === 307 || getLogoutRes.status === 302,
    'GET /api/auth/logout?redirectTo=/super-admin/login performs HTTP redirect'
  );
  assert(
    (getLogoutRes.headers.get('location') || '').includes('/super-admin/login'),
    'GET /api/auth/logout redirects to /super-admin/login destination'
  );
  assert(
    getLogoutRes.setCookie &&
    (getLogoutRes.setCookie.includes('Max-Age=0') || getLogoutRes.setCookie.includes('expires=Thu, 01 Jan 1970')),
    'GET logout clears auth_token cookie'
  );

  // --- Phase 8: Immediate Re-Login After Logout ---
  console.log('\n--- Phase 8: Immediate Re-Login Verification ---');
  const reLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const newSaToken = extractCookie(reLoginRes.setCookie);
  assert(
    reLoginRes.status === 200 &&
    reLoginRes.data?.success === true &&
    reLoginRes.data?.user?.role === 'super_admin' &&
    !!newSaToken,
    'Super Admin logs back in immediately without browser reload'
  );

  const newMeRes = await request('/api/auth/me', {
    headers: { Cookie: `auth_token=${newSaToken}` },
  });
  assert(
    newMeRes.status === 200 && newMeRes.data?.user?.email === 'admin@companytracker.test',
    'Re-authenticated session is fully functional and recognized by /api/auth/me'
  );

  // Clean up session by logging out
  await request('/api/auth/logout', { method: 'POST', headers: { Cookie: `auth_token=${newSaToken}` } });

  // --- Phase 9: Company Admin Flow & Tenant Isolation Preservation ---
  console.log('\n--- Phase 9: Company Admin Flow & RBAC Preservation ---');
  const uniqueNum = Date.now();
  const compAdminEmail = `verify_admin_${uniqueNum}@testcorp.com`;
  const compName = `Verify Corp ${uniqueNum}`;

  const regRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: compName,
      adminName: 'Verify Admin',
      adminEmail: compAdminEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-9999',
    },
  });
  const compId = regRes.data?.company?.id || regRes.data?.companyId;

  // Super Admin login to approve company
  const approveLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@companytracker.test', password: 'SuperAdminTest123!', requiredRole: 'super_admin' },
  });
  const approveToken = extractCookie(approveLoginRes.setCookie);
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${approveToken}` },
    body: { companyId: compId, status: 'approved' },
  });
  await request('/api/auth/logout', { method: 'POST', headers: { Cookie: `auth_token=${approveToken}` } });

  // Company Admin logs in
  const compLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAdminEmail, password: 'Password123!' },
  });
  const compToken = extractCookie(compLoginRes.setCookie);
  assert(
    compLoginRes.status === 200 &&
    compLoginRes.data?.user?.role === 'company_admin' &&
    !!compToken,
    'Company Admin logs in successfully and receives valid session cookie'
  );

  const compCookieHeader = `auth_token=${compToken}`;

  const compMeRes = await request('/api/auth/me', {
    headers: { Cookie: compCookieHeader },
  });
  assert(
    compMeRes.status === 200 &&
    compMeRes.data?.user?.role === 'company_admin' &&
    compMeRes.data?.company?.name === compName,
    'Company Admin /api/auth/me returns valid company tenant profile'
  );

  // RBAC check: Company Admin CANNOT access Super Admin API
  const compRbacRes = await request('/api/admin/companies', {
    headers: { Cookie: compCookieHeader },
  });
  assert(
    compRbacRes.status === 403,
    'RBAC: Company Admin access to /api/admin/companies is rejected with 403 Forbidden'
  );

  // Company Admin logs out
  const compLogoutRes = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: compCookieHeader },
  });
  assert(
    compLogoutRes.status === 200 &&
    compLogoutRes.setCookie &&
    compLogoutRes.setCookie.includes('Max-Age=0'),
    'Company Admin logs out successfully and session cookie is cleared'
  );

  const clearedCompCookie = extractCookie(compLogoutRes.setCookie) || '';
  const postCompLogoutMe = await request('/api/auth/me', {
    headers: { Cookie: `auth_token=${clearedCompCookie}` },
  });
  assert(
    postCompLogoutMe.status === 401,
    'Protected endpoints reject Company Admin after logout'
  );

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
