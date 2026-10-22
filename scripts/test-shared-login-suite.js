/**
 * Test Suite: Shared Login & Unified Authentication Verification
 *
 * Requirements Verified:
 * 1. Single shared login page (/login) serves both Super Admin and Company Admin.
 * 2. Shared login page has no role-selection dropdown.
 * 3. Legacy URLs (/super-admin, /super-admin/login) redirect to /login.
 * 4. Super Admin logs in at /login with only email & password; redirected to /dashboard/super-admin.
 * 5. Company Admin logs in at /login with only email & password; redirected to /dashboard/company-admin.
 * 6. Role is strictly determined by server database record; client-provided role fields are ignored.
 * 7. Privilege escalation prevention: client cannot pass role='super_admin' at login or registration.
 * 8. Invalid credentials and missing inputs return appropriate error codes (400, 401).
 * 9. Super Admin logout clears cookies and allows immediate re-login without infinite spinner or stale state.
 * 10. Multi-tenant RBAC isolation is strictly maintained across sessions.
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

async function run() {
  console.log('================================================================');
  console.log('       SHARED LOGIN & UNIFIED AUTH VERIFICATION SUITE           ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    console.log('--- 1. Health & Server Check ---');
    const health = await request('/api/health');
    assert(health.status === 200 && health.data?.status === 'healthy', 'Server is healthy on port 3000');

    // 2. Shared Login Page HTML
    console.log('\n--- 2. Shared Login UI Inspection ---');
    const loginPage = await request('/login');
    assert(loginPage.status === 200, 'GET /login returns 200 OK');
    assert(
      loginPage.text.includes('type="email"') || loginPage.text.includes('id="email"') || loginPage.text.includes('Email'),
      'Login page includes email input'
    );
    assert(
      loginPage.text.includes('type="password"') || loginPage.text.includes('id="password"') || loginPage.text.includes('Password'),
      'Login page includes password input'
    );
    assert(
      !loginPage.text.includes('role-select') && !loginPage.text.includes('Select your role'),
      'Shared login has NO role-selection dropdown'
    );

    // 3. Legacy Route Redirects
    console.log('\n--- 3. Legacy URL Redirection to /login ---');
    const superAdminLogin = await request('/super-admin/login');
    const saLoginRedirect = superAdminLogin.headers.get('location') || '';
    assert(
      (superAdminLogin.status === 307 || superAdminLogin.status === 308 || superAdminLogin.status === 302 || superAdminLogin.status === 200) &&
      (saLoginRedirect.includes('/login') || superAdminLogin.text.includes('/login')),
      'GET /super-admin/login redirects to /login'
    );

    const superAdminRoot = await request('/super-admin');
    const saRootRedirect = superAdminRoot.headers.get('location') || '';
    assert(
      (superAdminRoot.status === 307 || superAdminRoot.status === 308 || superAdminRoot.status === 302 || superAdminRoot.status === 200) &&
      (saRootRedirect.includes('/login') || superAdminRoot.text.includes('/login')),
      'GET /super-admin redirects to /login'
    );

    // 4. Super Admin Login via Shared Login (No role parameter)
    console.log('\n--- 4. Super Admin Authentication via Shared Login ---');
    const saLogin = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@companytracker.test',
        password: 'SuperAdminTest123!'
      }
    });

    const saToken = extractCookie(saLogin.setCookie);
    assert(
      saLogin.status === 200 &&
      saLogin.data?.success === true &&
      saLogin.data?.user?.role === 'super_admin' &&
      saLogin.data?.destination === '/dashboard/super-admin' &&
      !!saToken,
      'Super Admin authenticates via shared credentials and receives destination=/dashboard/super-admin'
    );

    const saCookieHeader = `auth_token=${saToken}`;

    // Verify Super Admin profile and access
    const saMe = await request('/api/auth/me', { headers: { Cookie: saCookieHeader } });
    assert(
      saMe.status === 200 && saMe.data?.user?.role === 'super_admin',
      'Session token correctly identifies role as super_admin'
    );

    const saCompanies = await request('/api/admin/companies', { headers: { Cookie: saCookieHeader } });
    assert(
      saCompanies.status === 200 && (Array.isArray(saCompanies.data?.data) || Array.isArray(saCompanies.data?.companies)),
      'Super Admin has access to /api/admin/companies'
    );

    // 5. Register and Approve a Company Admin for Testing
    console.log('\n--- 5. Company Admin Creation & Approval ---');
    const testId = Date.now();
    const companyEmail = `testco_${testId}@example.com`;
    const companyPass = 'CompanyPass123!';

    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        companyName: `Shared Login Test Co ${testId}`,
        adminName: 'Shared Test Admin',
        adminEmail: companyEmail,
        contactPhone: '+1-555-0199',
        password: companyPass,
        confirmPassword: companyPass,
        termsAccepted: true,
        // Injected malicious fields to verify privilege escalation prevention:
        role: 'super_admin',
        status: 'active'
      }
    });

    assert(
      regRes.status === 201 && regRes.data?.success === true,
      'Company registration succeeds'
    );
    assert(
      regRes.data?.user?.role === 'company_admin' && regRes.data?.company?.status === 'pending',
      'Public registration strictly enforces role=company_admin and status=pending, ignoring malicious injection'
    );

    const createdCompanyId = regRes.data?.company?.id;

    // Approve company using Super Admin session
    const approveRes = await request('/api/admin/companies', {
      method: 'PATCH',
      headers: { Cookie: saCookieHeader },
      body: {
        companyId: createdCompanyId,
        status: 'approved'
      }
    });
    assert(approveRes.status === 200 && approveRes.data?.company?.status === 'approved', 'Super Admin approves company');

    // 6. Company Admin Login via Shared Login
    console.log('\n--- 6. Company Admin Authentication via Shared Login ---');
    const caLogin = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: companyEmail,
        password: companyPass
      }
    });

    const caToken = extractCookie(caLogin.setCookie);
    assert(
      caLogin.status === 200 &&
      caLogin.data?.success === true &&
      caLogin.data?.user?.role === 'company_admin' &&
      caLogin.data?.destination === '/dashboard/company-admin' &&
      !!caToken,
      'Company Admin authenticates via shared credentials and receives destination=/dashboard/company-admin'
    );

    const caCookieHeader = `auth_token=${caToken}`;

    const caMe = await request('/api/auth/me', { headers: { Cookie: caCookieHeader } });
    assert(
      caMe.status === 200 && caMe.data?.user?.role === 'company_admin',
      'Session token correctly identifies role as company_admin'
    );

    // 7. Security & Privilege Escalation Checks
    console.log('\n--- 7. Privilege Escalation & Role Tampering Tests ---');
    // Attempt privilege escalation during login
    const spoofLogin = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: companyEmail,
        password: companyPass,
        role: 'super_admin',
        requiredRole: 'super_admin'
      }
    });

    assert(
      spoofLogin.status === 401,
      'Company Admin attempting to claim requiredRole=super_admin is rejected with 401'
    );

    // Verify Company Admin cannot access Super Admin endpoint
    const caSuperAdminAccess = await request('/api/admin/companies', { headers: { Cookie: caCookieHeader } });
    assert(
      caSuperAdminAccess.status === 403,
      'Company Admin token is strictly blocked from /api/admin/companies with 403 Forbidden'
    );

    // 8. Negative Authentication Cases
    console.log('\n--- 8. Negative Authentication Cases ---');
    const wrongPass = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@companytracker.test', password: 'WrongPassword999!' }
    });
    assert(wrongPass.status === 401, 'Wrong password returns 401');

    const nonExistent = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody_exists@companytracker.test', password: 'SomePassword123!' }
    });
    assert(nonExistent.status === 401, 'Nonexistent email returns 401');

    const emptyBody = await request('/api/auth/login', {
      method: 'POST',
      body: { email: '', password: '' }
    });
    assert(emptyBody.status === 400, 'Empty credentials return 400');

    // 9. Super Admin Logout Flow & Immediate Relogin
    console.log('\n--- 9. Logout & Immediate Relogin Flow ---');
    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: saCookieHeader }
    });
    assert(
      logoutRes.status === 200 && logoutRes.data?.success === true,
      'Super Admin POST /api/auth/logout returns 200 OK'
    );
    assert(
      logoutRes.setCookie && (logoutRes.setCookie.includes('Max-Age=0') || logoutRes.setCookie.includes('auth_token=;')),
      'Logout response expires auth_token cookie with Max-Age=0'
    );

    // Verify subsequent requests are unauthenticated
    const expiredMe = await request('/api/auth/me', {
      headers: { Cookie: 'auth_token=' }
    });
    assert(expiredMe.status === 401, 'Subsequent /api/auth/me returns 401');

    // Immediate relogin succeeds without browser refresh
    const reloginRes = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@companytracker.test',
        password: 'SuperAdminTest123!'
      }
    });
    assert(
      reloginRes.status === 200 && reloginRes.data?.success === true && reloginRes.data?.user?.role === 'super_admin',
      'Immediate relogin succeeds cleanly without stale state'
    );

    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test suite error:', err);
    process.exit(1);
  }
}

run();
