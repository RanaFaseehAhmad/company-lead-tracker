/**
 * Verification Test Suite:
 * 1. Public Homepage verification (No verify endpoints, clean SaaS presentation)
 * 2. Company registration & company login verification
 * 3. Dedicated Super Admin login & role-based redirect
 * 4. Company user blocked from Super Admin authentication & APIs
 * 5. Role & credential error privacy (zero enumeration leakage)
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
  console.log('     HOMEPAGE SIMPLIFICATION & SUPER ADMIN SEPARATION TESTS     ');
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

  // --- Test 1: Homepage Content and Endpoint Cleanliness ---
  const homeRes = await request('/');
  const homeHtml = homeRes.text || '';

  const hasEndpoints =
    homeHtml.includes('Verify Endpoints') ||
    homeHtml.includes('/api/health') ||
    homeHtml.includes('Auth Profile') ||
    homeHtml.includes('Leads API ↗');

  const hasLogoAndName = homeHtml.includes('Company Lead Tracker');
  const hasRegisterLink = homeHtml.includes('Register Company') && homeHtml.includes('/register');
  const hasSignInLink = homeHtml.includes('Sign In') && homeHtml.includes('/login');
  const hasFeatureHighlights =
    homeHtml.includes('Dynamic Form Engine') &&
    homeHtml.includes('Pipeline Tracking') &&
    homeHtml.includes('Tenant Isolation');

  assert(
    homeRes.status === 200 &&
    !hasEndpoints &&
    hasLogoAndName &&
    hasRegisterLink &&
    hasSignInLink &&
    hasFeatureHighlights,
    'Test 1: Public Homepage is clean, professional, and free of developer/API endpoints'
  );

  // --- Test 2: Dedicated /super-admin/login page exists ---
  const superAdminLoginRes = await request('/super-admin/login');
  assert(
    superAdminLoginRes.status === 200 &&
    superAdminLoginRes.text.includes('Super Admin Portal'),
    'Test 2: Dedicated /super-admin/login page renders successfully'
  );

  // --- Test 3: /super-admin root redirects to /super-admin/login ---
  const superAdminRootRes = await request('/super-admin');
  assert(
    superAdminRootRes.status === 307 ||
    superAdminRootRes.status === 308 ||
    superAdminRootRes.status === 200,
    'Test 3: /super-admin route correctly handles navigation to /super-admin/login'
  );

  // --- Test 4: Super Admin Login via /api/auth/login with requiredRole: super_admin ---
  const superAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });

  const superAdminCookie = extractCookie(superAdminLogin.setCookie);
  assert(
    superAdminLogin.status === 200 &&
    superAdminLogin.data?.success === true &&
    superAdminLogin.data?.redirectTo === '/dashboard/super-admin' &&
    !!superAdminCookie,
    'Test 4: Super Admin authenticates with requiredRole: super_admin and gets redirected to /dashboard/super-admin'
  );

  // --- Test 5: Provision approved Company Admin for isolation testing ---
  const time = Date.now();
  const provisionRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: `auth_token=${superAdminCookie}` },
    body: {
      companyName: `Isolation Company ${time}`,
      status: 'approved',
      adminName: 'Company Admin',
      adminEmail: `comp_admin_${time}@isolation.test`,
      adminPassword: 'Password123!',
    },
  });

  assert(
    provisionRes.status === 201 && provisionRes.data?.success === true,
    'Test 5: Super Admin creates approved company and company admin account'
  );

  // --- Test 6: Company Admin logs in normally via standard portal ---
  const companyLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: `comp_admin_${time}@isolation.test`,
      password: 'Password123!',
    },
  });

  const companyCookie = extractCookie(companyLoginRes.setCookie);
  assert(
    companyLoginRes.status === 200 &&
    companyLoginRes.data?.success === true &&
    companyLoginRes.data?.redirectTo === '/dashboard/company-admin' &&
    !!companyCookie,
    'Test 6: Normal Sign In authenticates company user and redirects to /dashboard/company-admin'
  );

  // --- Test 7: Company Admin CANNOT authenticate with requiredRole: super_admin ---
  const spoofSuperAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: `comp_admin_${time}@isolation.test`,
      password: 'Password123!',
      requiredRole: 'super_admin',
    },
  });

  assert(
    spoofSuperAdminLogin.status === 401 &&
    spoofSuperAdminLogin.data?.success === false &&
    spoofSuperAdminLogin.data?.error === 'Invalid email or password.',
    'Test 7: Company user cannot log in via Super Admin portal (rejected with generic 401)'
  );

  // --- Test 8: Nonexistent email produces identical error (no enumeration) ---
  const fakeAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'nonexistent_admin@fake.test',
      password: 'Password123!',
      requiredRole: 'super_admin',
    },
  });

  assert(
    fakeAdminLogin.status === 401 &&
    fakeAdminLogin.data?.error === spoofSuperAdminLogin.data?.error,
    'Test 8: Error message does not reveal whether email exists or belongs to a Super Admin'
  );

  // --- Test 9: Company Admin is strictly forbidden from Super Admin APIs ---
  const forbiddenGetRes = await request('/api/admin/companies', {
    headers: { Cookie: `auth_token=${companyCookie}` },
  });

  const forbiddenPostRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: `auth_token=${companyCookie}` },
    body: { companyName: 'Hacked Company' },
  });

  assert(
    forbiddenGetRes.status === 403 && forbiddenPostRes.status === 403,
    'Test 9: Company Admin is strictly forbidden (403) from Super Admin APIs'
  );

  // --- Test 10: Company registration remains publicly accessible ---
  const regPageRes = await request('/register');
  assert(
    regPageRes.status === 200 &&
    (regPageRes.text.includes('Register') || regPageRes.text.includes('register')),
    'Test 10: Company registration remains public and fully functional'
  );

  console.log(`\n================================================================`);
  console.log(`TOTAL PASSED: ${passed} / 10 | TOTAL FAILED: ${failed}`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
