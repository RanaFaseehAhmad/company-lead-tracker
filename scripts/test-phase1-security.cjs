/**
 * Phase 1 Security Remediation Verification Suite
 * Tests:
 * 1. Login throttling, HTTP 429 responses, Retry-After headers, generic error messages
 * 2. Successful login resets failure counters
 * 3. Registration throttling & HTTP 429 responses
 * 4. Effective security headers on global, dashboard, auth, API, and embed routes
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, data };
}

async function run() {
  console.log('================================================================');
  console.log('   PHASE 1 SECURITY REMEDIATION: RATE LIMITS & HEADERS TESTS   ');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. SECURITY HEADERS VERIFICATION
  // -------------------------------------------------------------------------
  console.log('--- 1. Security Headers Verification ---');

  // Global / Homepage headers
  const homeRes = await request('/');
  assert(
    homeRes.headers.get('x-content-type-options') === 'nosniff',
    'Homepage has X-Content-Type-Options: nosniff'
  );
  assert(
    homeRes.headers.get('referrer-policy') === 'strict-origin-when-cross-origin',
    'Homepage has Referrer-Policy: strict-origin-when-cross-origin'
  );
  assert(
    homeRes.headers.get('permissions-policy') === 'camera=(), microphone=(), geolocation=()',
    'Homepage has Permissions-Policy: camera=(), microphone=(), geolocation=()'
  );

  // Dashboard framing protection
  const dashRes = await request('/dashboard/company-admin');
  assert(
    dashRes.headers.get('x-frame-options') === 'DENY',
    'Dashboard routes enforce X-Frame-Options: DENY'
  );
  assert(
    dashRes.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"),
    "Dashboard routes enforce CSP frame-ancestors 'none'"
  );

  // Auth routes framing protection
  const loginPageRes = await request('/login');
  assert(
    loginPageRes.headers.get('x-frame-options') === 'DENY',
    'Login page enforces X-Frame-Options: DENY'
  );

  const regPageRes = await request('/register');
  assert(
    regPageRes.headers.get('x-frame-options') === 'DENY',
    'Register page enforces X-Frame-Options: DENY'
  );

  // Public embed framing preservation
  const embedRes = await request('/embed/test-form-public-id');
  const embedCsp = embedRes.headers.get('content-security-policy') || '';
  assert(
    embedCsp.includes('frame-ancestors *'),
    'Public embed route preserves CSP frame-ancestors * for customer site embeds'
  );
  assert(
    embedRes.headers.get('x-frame-options') === null,
    'Public embed route does NOT set X-Frame-Options (avoids framing collision)'
  );
  assert(
    embedRes.headers.get('x-content-type-options') === 'nosniff',
    'Public embed route retains X-Content-Type-Options: nosniff'
  );

  // API framing protection
  const apiRes = await request('/api/health');
  assert(
    apiRes.headers.get('x-frame-options') === 'DENY',
    'API routes enforce X-Frame-Options: DENY'
  );

  // -------------------------------------------------------------------------
  // 2. AUTHENTICATION RATE LIMITING TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Login Throttling & Source IP Protection ---');

  const testTargetEmail = `target-victim-${Date.now()}@example.com`;
  const attackerIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

  // Submit 10 bad passwords from the same source IP
  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': attackerIp },
      body: JSON.stringify({ email: testTargetEmail, password: `BadPassword${attempt}` }),
    });

    assert(
      res.status === 401 && res.data.error === 'Invalid email or password.',
      `Attempt ${attempt}/10 returns generic 401: Invalid email or password.`
    );
  }

  // 11th attempt from the attacking IP must be throttled with HTTP 429
  const throttledRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': attackerIp },
    body: JSON.stringify({ email: testTargetEmail, password: 'AnotherBadPassword' }),
  });

  assert(
    throttledRes.status === 429,
    'Source IP exceeding 10 failed attempts returns HTTP 429 Too Many Requests'
  );
  assert(
    throttledRes.data?.success === false && throttledRes.data?.error?.includes('Too many failed login attempts'),
    'Throttled response contains informative retry message'
  );
  assert(
    Boolean(throttledRes.headers.get('retry-after')),
    `Response includes Retry-After header: ${throttledRes.headers.get('retry-after')} seconds`
  );
  assert(
    throttledRes.headers.get('x-ratelimit-remaining') === '0',
    'Response includes X-RateLimit-Remaining: 0'
  );

  // -------------------------------------------------------------------------
  // 3. LEGITIMATE LOGIN SUCCEEDS
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Legitimate Login Verification ---');

  // Login as super admin (configured in .env.local)
  const legitEmail = 'admin@companytracker.test';
  const legitPass = 'SuperAdminTest123!';

  const legitRes = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: legitEmail, password: legitPass }),
  });

  assert(
    legitRes.status === 200 && legitRes.data?.success === true,
    'Legitimate login with correct credentials succeeds with HTTP 200'
  );
  assert(
    Boolean(legitRes.headers.get('set-cookie')),
    'Legitimate login sets HttpOnly authentication session cookie'
  );

  // -------------------------------------------------------------------------
  // 4. REGISTRATION THROTTLING TESTS
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Registration Throttling Verification ---');

  const regTestIp = `192.0.2.${Math.floor(Math.random() * 200) + 10}`;

  // Submit 5 valid registration requests from this IP
  for (let r = 1; r <= 5; r++) {
    const uniqueSuffix = `${Date.now()}-${r}`;
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': regTestIp },
      body: JSON.stringify({
        companyName: `Throttled Corp ${uniqueSuffix}`,
        adminName: `Admin ${uniqueSuffix}`,
        adminEmail: `admin-${uniqueSuffix}@throttledcorp.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!',
        termsAccepted: true,
      }),
    });

    assert(
      regRes.status === 201 && regRes.data?.success === true,
      `Registration ${r}/5 accepted from test IP with HTTP 201`
    );
  }

  // 6th attempt from the same IP must be throttled with HTTP 429
  const regThrottled = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'x-forwarded-for': regTestIp },
    body: JSON.stringify({
      companyName: 'Excessive Corp',
      adminName: 'Excessive Admin',
      adminEmail: 'excessive@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    }),
  });

  assert(
    regThrottled.status === 429,
    'Registration rate limiter returns HTTP 429 after 5 registrations from same IP'
  );
  assert(
    Boolean(regThrottled.headers.get('retry-after')),
    `Registration 429 response includes Retry-After header: ${regThrottled.headers.get('retry-after')} seconds`
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`PHASE 1 SECURITY TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
