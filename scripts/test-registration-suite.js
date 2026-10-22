/**
 * Company Registration Test Suite
 * Tests all requirements for public company registration, pending status,
 * role lockdown, duplicate rejection, and Super Admin approval.
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
  console.log('================================================================');
  console.log('       COMPANY LEAD TRACKER — REGISTRATION TEST SUITE           ');
  console.log('================================================================\n');

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

  // 1. Missing required fields rejected with 400
  const res1 = await request('/api/auth/register', {
    method: 'POST',
    body: {},
  });
  assert(res1.status === 400 && res1.data.success === false, 'Test 1: Empty registration body rejected with 400');

  // 2. Missing terms acceptance rejected with 400
  const res2 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: 'Test Corp',
      adminName: 'Test Admin',
      adminEmail: 'admin@testcorp.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: false,
    },
  });
  assert(res2.status === 400 && res2.data.error.includes('Terms'), 'Test 2: Missing terms acceptance rejected with 400');

  // 3. Password mismatch rejected with 400
  const res3 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: 'Test Corp',
      adminName: 'Test Admin',
      adminEmail: 'admin@testcorp.com',
      password: 'Password123!',
      confirmPassword: 'DifferentPassword123!',
      termsAccepted: true,
    },
  });
  assert(res3.status === 400 && res3.data.error.includes('Passwords do not match'), 'Test 3: Password mismatch rejected with 400');

  // 4. Invalid email format rejected with 400
  const res4 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: 'Test Corp',
      adminName: 'Test Admin',
      adminEmail: 'invalid-email-address',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  assert(res4.status === 400 && res4.data.error.includes('valid'), 'Test 4: Malformed email rejected with 400');

  // 5. Short password (< 8 chars) rejected with 400
  const res5 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: 'Test Corp',
      adminName: 'Test Admin',
      adminEmail: 'admin@testcorp.com',
      password: 'short',
      confirmPassword: 'short',
      termsAccepted: true,
    },
  });
  assert(res5.status === 400 && res5.data.error.includes('8 characters'), 'Test 5: Short password rejected with 400');

  // 6. Valid registration creates company in 'pending' status and user with 'company_admin'
  const uniqueId = Date.now();
  const testCompanyName = `Nova Dynamics ${uniqueId}`;
  const testAdminEmail = `admin_${uniqueId}@novadynamics.test`;
  const res6 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: testCompanyName,
      adminName: 'Alex Mercer',
      adminEmail: testAdminEmail,
      contactPhone: '+1 555-0199',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
      termsAccepted: true,
    },
  });
  assert(
    res6.status === 201 &&
    res6.data.success === true &&
    res6.data.company.status === 'pending' &&
    res6.data.user.role === 'company_admin',
    'Test 6: Valid registration succeeds with status "pending" and role "company_admin"'
  );

  const registeredCompanyId = res6.data?.company?.id;

  // 7. Security: client cannot spoof status='approved' or role='super_admin'
  const spoofCompanyName = `Spoof Corp ${uniqueId}`;
  const spoofAdminEmail = `spoof_${uniqueId}@spoof.test`;
  const res7 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: spoofCompanyName,
      adminName: 'Hacker One',
      adminEmail: spoofAdminEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      status: 'approved', // Malicious status override
      role: 'super_admin', // Malicious role override
      companyId: '65f123456789012345678901', // Malicious tenant spoof
    },
  });
  assert(
    res7.status === 201 &&
    res7.data.company.status === 'pending' &&
    res7.data.user.role === 'company_admin' &&
    res7.data.company.id !== '65f123456789012345678901',
    'Test 7: Client-provided role and status overrides are strictly ignored'
  );

  // 8. Duplicate company name rejected with 409
  const res8 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: testCompanyName, // Existing company name
      adminName: 'Another Admin',
      adminEmail: `another_${uniqueId}@different.test`,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  assert(res8.status === 409 && res8.data.error.includes('already exists'), 'Test 8: Duplicate company name rejected with 409 Conflict');

  // 9. Duplicate user email rejected with 409
  const res9 = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Another Brand ${uniqueId}`,
      adminName: 'Another Admin',
      adminEmail: testAdminEmail, // Existing user email
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  assert(res9.status === 409 && res9.data.error.includes('already exists'), 'Test 9: Duplicate user email rejected with 409 Conflict');

  // 10. Pending registered company cannot sign in (blocked with 403)
  const res10 = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: testAdminEmail,
      password: 'SecurePassword123!',
    },
  });
  assert(
    res10.status === 403 &&
    res10.data.companyStatus === 'pending',
    'Test 10: Pending registered company is blocked from signing in with 403'
  );

  // 11. Super Admin lists companies and sees the pending registered company
  const superAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@companytracker.test', password: 'SuperAdminTest123!' },
  });
  const superAdminCookie = extractCookie(superAdminLogin.setCookie);
  const superAdminHeaders = { Cookie: `auth_token=${superAdminCookie}` };

  const res11 = await request('/api/admin/companies', {
    method: 'GET',
    headers: superAdminHeaders,
  });
  const foundCompany = (res11.data.data || []).find((c) => c.id === registeredCompanyId);
  assert(
    res11.status === 200 &&
    !!foundCompany &&
    foundCompany.status === 'pending',
    'Test 11: Super Admin retrieves registered company in pending status'
  );

  // 12. Super Admin approves registered company
  const res12 = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: superAdminHeaders,
    body: {
      companyId: registeredCompanyId,
      status: 'approved',
    },
  });
  assert(
    res12.status === 200 &&
    res12.data.success === true &&
    res12.data.company.status === 'approved',
    'Test 12: Super Admin approves registered company successfully'
  );

  // 13. Approved registered company can now sign in successfully
  const res13 = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: testAdminEmail,
      password: 'SecurePassword123!',
    },
  });
  const newAdminToken = extractCookie(res13.setCookie);
  assert(
    res13.status === 200 &&
    res13.data.success === true &&
    res13.data.user.role === 'company_admin' &&
    !!newAdminToken,
    'Test 13: Approved registered company admin signs in successfully'
  );

  // 14. Zero password hashes or secrets leaked in registration or approval
  const allResponses = [res6, res7, res8, res9, res10, res11, res12, res13];
  let leakFound = false;
  for (const r of allResponses) {
    const raw = JSON.stringify(r.data);
    if (raw.includes('passwordHash') || raw.includes('$2a$') || raw.includes('$2b$')) {
      leakFound = true;
      break;
    }
  }
  assert(!leakFound, 'Test 14: Zero password hashes or secrets in all API responses');

  console.log('\n================================================================');
  console.log(`TOTAL PASSED: ${passed} / 14 | TOTAL FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
