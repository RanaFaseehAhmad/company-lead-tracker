/**
 * Authentication Test Suite
 * Executes all 14 required authentication and security checks.
 */

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, headers: res.headers, data, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runTests() {
  console.log('========================================================');
  console.log('       RUNNING PHASE 2 AUTHENTICATION TEST SUITE        ');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // 1. Missing credentials are rejected
  const res1 = await request('/api/auth/login', {
    method: 'POST',
    body: {},
  });
  assert(res1.status === 400 && res1.data.success === false, 'Test 1: Missing credentials rejected with 400');

  // 2. Invalid email/password combinations are rejected
  const res2 = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'nonexistent@example.com', password: 'WrongPassword123' },
  });
  assert(res2.status === 401 && res2.data.success === false, 'Test 2: Invalid credentials rejected with 401');

  // 3. Valid login sets an HTTP-only cookie
  const res3 = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@companytracker.test', password: 'SuperAdminTest123!' },
  });
  const superAdminToken = extractCookie(res3.setCookie);
  assert(
    res3.status === 200 &&
    res3.data.success === true &&
    res3.data.user.role === 'super_admin' &&
    !!superAdminToken &&
    res3.setCookie.includes('HttpOnly'),
    'Test 3: Super Admin login sets HTTP-only cookie',
    `Status: ${res3.status}, Set-Cookie: ${res3.setCookie}`
  );

  const superAdminCookieHeader = `auth_token=${superAdminToken}`;

  // 4. /api/auth/me returns the correct safe profile
  const res4 = await request('/api/auth/me', {
    headers: { Cookie: superAdminCookieHeader },
  });
  assert(
    res4.status === 200 &&
    res4.data.success === true &&
    res4.data.user.email === 'admin@companytracker.test' &&
    res4.data.user.role === 'super_admin' &&
    !res4.data.user.passwordHash,
    'Test 4: /api/auth/me returns correct safe profile without password hash'
  );

  // 5. Logout clears the cookie
  const res5 = await request('/api/auth/logout', { method: 'POST' });
  assert(
    res5.status === 200 &&
    res5.setCookie &&
    (res5.setCookie.includes('Max-Age=0') || res5.setCookie.includes('expires=')),
    'Test 5: Logout clears cookie with Max-Age=0'
  );

  // 6. Expired or invalid JWTs are rejected
  const res6 = await request('/api/auth/me', {
    headers: { Cookie: 'auth_token=invalid.jwt.token.here' },
  });
  assert(res6.status === 401, 'Test 6: Invalid JWT is rejected with 401');

  // 7. Unauthenticated /api/leads returns 401
  const res7 = await request('/api/leads');
  assert(res7.status === 401 && res7.data.success === false, 'Test 7: Unauthenticated /api/leads returns 401');

  // 8. Super Admin creates pending company & company admin
  const testPendingEmail = `pending_admin_${Date.now()}@testco.com`;
  const testPendingCompany = `Pending Corp ${Date.now()}`;
  const res8 = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookieHeader },
    body: {
      companyName: testPendingCompany,
      adminName: 'Pending Admin',
      adminEmail: testPendingEmail,
      adminPassword: 'Password123!',
      status: 'pending',
    },
  });
  assert(
    res8.status === 201 &&
    res8.data.success === true &&
    res8.data.company.status === 'pending' &&
    res8.data.admin.role === 'company_admin',
    'Test 8: Super Admin successfully creates company & company admin',
    JSON.stringify(res8.data)
  );

  // 9. Pending company login is rejected with clear message
  const res9 = await request('/api/auth/login', {
    method: 'POST',
    body: { email: testPendingEmail, password: 'Password123!' },
  });
  assert(
    res9.status === 403 &&
    res9.data.companyStatus === 'pending',
    'Test 9: Pending company account is blocked from signing in with 403'
  );

  // 10. Super Admin creates approved company & company admin
  const testApprovedEmail = `approved_admin_${Date.now()}@testco.com`;
  const testApprovedCompany = `Approved Corp ${Date.now()}`;
  const res10 = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookieHeader },
    body: {
      companyName: testApprovedCompany,
      adminName: 'Approved Admin',
      adminEmail: testApprovedEmail,
      adminPassword: 'Password123!',
      status: 'approved',
    },
  });
  assert(
    res10.status === 201 &&
    res10.data.company.status === 'approved',
    'Test 10: Super Admin creates approved company'
  );

  // 11. Approved company admin can log in and receive token
  const res11 = await request('/api/auth/login', {
    method: 'POST',
    body: { email: testApprovedEmail, password: 'Password123!' },
  });
  const companyAdminToken = extractCookie(res11.setCookie);
  assert(
    res11.status === 200 &&
    res11.data.user.role === 'company_admin' &&
    !!companyAdminToken,
    'Test 11: Approved Company Admin signs in successfully'
  );

  const companyAdminCookieHeader = `auth_token=${companyAdminToken}`;

  // 12. Company Admin cannot access Super Admin APIs (RBAC check)
  const res12 = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: companyAdminCookieHeader },
    body: {
      companyName: 'Unauthorized Company',
      adminName: 'Hacker',
      adminEmail: 'hacker@example.com',
      adminPassword: 'Password123!',
    },
  });
  assert(
    res12.status === 403 && res12.data.error.includes('Super Admin'),
    'Test 12: Company Admin is blocked from Super Admin API with 403 Forbidden'
  );

  // 13. Duplicate email or company name is rejected
  const res13 = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookieHeader },
    body: {
      companyName: testApprovedCompany, // Duplicate name
      adminName: 'Another Admin',
      adminEmail: `new_${Date.now()}@test.com`,
      adminPassword: 'Password123!',
    },
  });
  assert(res13.status === 409, 'Test 13: Duplicate company name rejected with 409 Conflict');

  // 14. No API response contains passwordHash or secret
  const allResponses = [res1, res2, res3, res4, res8, res10, res11];
  let leakFound = false;
  for (const r of allResponses) {
    const raw = JSON.stringify(r.data);
    if (raw.includes('passwordHash') || raw.includes('JWT_SECRET') || raw.includes('$2a$') || raw.includes('$2b$')) {
      leakFound = true;
      break;
    }
  }
  assert(!leakFound, 'Test 14: Zero password hashes or secrets in all API responses');

  console.log('\n========================================================');
  console.log(`TOTAL PASSED: ${passed} / 14 | TOTAL FAILED: ${failed}`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
