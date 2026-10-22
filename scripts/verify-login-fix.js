/**
 * Test Suite: Verify Login Fix & Session Redirection
 */
const BASE_URL = 'http://localhost:3000';
const fs = require('fs');

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
  console.log('       VERIFY INITIAL LOGIN FIX & SESSION BEHAVIOR              ');
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
    // 1. Verify LoginForm.js contains NO calls to /api/auth/me
    console.log('--- 1. Client LoginForm Source Code Inspection ---');
    const loginFormSrc = fs.readFileSync('src/app/login/LoginForm.js', 'utf8');
    assert(
      !loginFormSrc.includes('/api/auth/me'),
      'src/app/login/LoginForm.js has zero calls to /api/auth/me'
    );
    assert(
      !loginFormSrc.includes('checkExistingSession'),
      'checkExistingSession useEffect probe has been completely removed from client'
    );

    // 2. Unauthenticated visitor loads /login
    console.log('\n--- 2. Unauthenticated Visitor Access to /login ---');
    const unauthLogin = await request('/login');
    assert(unauthLogin.status === 200, 'GET /login returns 200 OK without redirect');
    assert(
      unauthLogin.text.includes('Sign in to your account') &&
      unauthLogin.text.includes('Email Address') &&
      unauthLogin.text.includes('Password'),
      'Login page serves complete interactive login form markup'
    );

    // 3. Direct unauthenticated access to /api/auth/me still returns 401
    console.log('\n--- 3. Direct /api/auth/me Protection Integrity ---');
    const directMe = await request('/api/auth/me');
    assert(directMe.status === 401, 'Direct GET /api/auth/me strictly returns 401 Unauthorized');
    assert(
      directMe.data?.success === false && directMe.data?.error === 'Authentication required. Please sign in.',
      '/api/auth/me security policy preserved with exact authentication error message'
    );

    // 4. Invalid or expired cookie does not cause redirect loop
    console.log('\n--- 4. Invalid / Malformed Cookie Handling ---');
    const malformedCookieRes = await request('/login', {
      headers: { Cookie: 'auth_token=invalid.tampered.token999' }
    });
    assert(
      malformedCookieRes.status === 200,
      'Visiting /login with invalid cookie returns 200 and renders form (no redirect loop)'
    );

    const expiredCookieRes = await request('/login', {
      headers: { Cookie: 'auth_token=' }
    });
    assert(
      expiredCookieRes.status === 200,
      'Visiting /login with empty cookie returns 200 and renders form'
    );

    // 5. Authenticated Super Admin session redirection on visiting /login
    console.log('\n--- 5. Super Admin Active Session Redirection ---');
    const saLogin = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@companytracker.test',
        password: 'SuperAdminTest123!'
      }
    });
    const saToken = extractCookie(saLogin.setCookie);
    const saCookieHeader = `auth_token=${saToken}`;

    const saVisitLogin = await request('/login', {
      headers: { Cookie: saCookieHeader }
    });
    const saRedirect = saVisitLogin.headers.get('location') || '';
    assert(
      (saVisitLogin.status === 307 || saVisitLogin.status === 308 || saVisitLogin.status === 302 || saVisitLogin.status === 303) &&
      saRedirect.includes('/dashboard/super-admin'),
      'Super Admin visiting /login is redirected directly to /dashboard/super-admin'
    );

    // 6. Authenticated Approved Company Admin session redirection on visiting /login
    console.log('\n--- 6. Company Admin Active Session Redirection ---');
    const testId = Date.now();
    const testEmail = `co_redirect_${testId}@test.com`;
    const testPass = 'CoPass123!';

    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        companyName: `Redirect Test Co ${testId}`,
        adminName: 'Redirect Admin',
        adminEmail: testEmail,
        contactPhone: '+1-555-0188',
        password: testPass,
        confirmPassword: testPass,
        termsAccepted: true
      }
    });
    const companyId = regRes.data?.company?.id;

    // Approve company via Super Admin
    await request('/api/admin/companies', {
      method: 'PATCH',
      headers: { Cookie: saCookieHeader },
      body: { companyId, status: 'approved' }
    });

    // Login as company admin
    const caLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: testPass }
    });
    const caToken = extractCookie(caLogin.setCookie);
    const caCookieHeader = `auth_token=${caToken}`;

    const caVisitLogin = await request('/login', {
      headers: { Cookie: caCookieHeader }
    });
    const caRedirect = caVisitLogin.headers.get('location') || '';
    assert(
      (caVisitLogin.status === 307 || caVisitLogin.status === 308 || caVisitLogin.status === 302 || caVisitLogin.status === 303) &&
      caRedirect.includes('/dashboard/company-admin'),
      'Company Admin visiting /login is redirected directly to /dashboard/company-admin'
    );

    // 7. Blocked or Pending Company cannot bypass to dashboard
    console.log('\n--- 7. Blocked / Pending Company Security Policy ---');
    // Block company
    await request('/api/admin/companies', {
      method: 'PATCH',
      headers: { Cookie: saCookieHeader },
      body: { companyId, status: 'blocked' }
    });

    const blockedVisitLogin = await request('/login', {
      headers: { Cookie: caCookieHeader }
    });
    const blockedRedirect = blockedVisitLogin.headers.get('location') || '';
    assert(
      blockedVisitLogin.status === 200 || !blockedRedirect.includes('/dashboard/company-admin'),
      'Blocked company session visiting /login is strictly blocked from dashboard redirection'
    );

    // 8. Super Admin Logout and Immediate Re-login
    console.log('\n--- 8. Logout & Immediate Re-Login Functionality ---');
    const logoutRes = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: saCookieHeader }
    });
    assert(
      logoutRes.status === 200 && logoutRes.setCookie && logoutRes.setCookie.includes('Max-Age=0'),
      'Logout successfully expires auth_token cookie'
    );

    const postLogoutVisitLogin = await request('/login', {
      headers: { Cookie: 'auth_token=' }
    });
    assert(
      postLogoutVisitLogin.status === 200,
      'Post-logout visit to /login returns 200 with clean login form'
    );

    const reloginRes = await request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@companytracker.test',
        password: 'SuperAdminTest123!'
      }
    });
    assert(
      reloginRes.status === 200 && reloginRes.data?.success === true,
      'Immediate re-login after logout succeeds without issue'
    );

    console.log('\n================================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('================================================================\n');

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

run();
