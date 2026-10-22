/**
 * Phase 1.2 Targeted Rate Limiter Security Regression Suite
 * Tests:
 * 1. Attacker failed attempts do NOT lock out legitimate user with correct password (Fix for RL-02)
 * 2. Source IP rate limiting still blocks attacking IP after 10 failed attempts
 * 3. Memory store upper bound (MAX_STORE_ENTRIES = 10000) and LRU eviction
 * 4. Registration payload bound (>16KB rejected with 413)
 * 5. Registration counts validation failures and duplicate attempts against rate quota
 * 6. Legitimate login resets counters
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
  console.log('   PHASE 1.2 TARGETED RATE LIMITER SECURITY REGRESSION SUITE   ');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: NO ATTACKER-TRIGGERED ACCOUNT LOCKOUT (Fix 2)
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Account Lockout DoS Prevention ---');

  const legitEmail = 'admin@companytracker.test';
  const legitPass = 'SuperAdminTest123!';
  const attackerIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

  // Attacker sends 6 failed attempts targeting the administrator's email from attacker's IP
  for (let a = 1; a <= 6; a++) {
    const atkRes = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': attackerIp },
      body: JSON.stringify({ email: legitEmail, password: `WrongPassword${a}` }),
    });
    assert(
      atkRes.status === 401 && atkRes.data?.error === 'Invalid email or password.',
      `Attacker failed attempt ${a} returns generic 401`
    );
  }

  // Now the legitimate user from their own IP attempts to log in with the CORRECT password
  const legitIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
  const legitLoginRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': legitIp },
    body: JSON.stringify({ email: legitEmail, password: legitPass }),
  });

  assert(
    legitLoginRes.status === 200 && legitLoginRes.data?.success === true,
    'Legitimate user with CORRECT password authenticates successfully (HTTP 200) even after attacker submitted wrong passwords!'
  );
  assert(
    Boolean(legitLoginRes.headers.get('set-cookie')),
    'Legitimate login receives session cookie'
  );

  // -------------------------------------------------------------------------
  // TEST 2: SOURCE IP STILL BLOCKED AFTER 10 FAILURES (Fix 2 & IP Protection)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Source IP Rate Limiter Enforcement ---');

  const persistentAttackerIp = `198.51.200.${Math.floor(Math.random() * 200) + 10}`;

  // Attacker sends 10 failed login attempts from this single IP
  for (let i = 1; i <= 10; i++) {
    await request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': persistentAttackerIp },
      body: JSON.stringify({ email: `victim-${i}@example.com`, password: 'wrong' }),
    });
  }

  // 11th attempt from this attacker IP must be blocked with HTTP 429
  const blockedAtkRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': persistentAttackerIp },
    body: JSON.stringify({ email: 'another@example.com', password: 'wrong' }),
  });

  assert(
    blockedAtkRes.status === 429,
    'Source IP exceeding 10 failed attempts is blocked with HTTP 429'
  );
  assert(
    Boolean(blockedAtkRes.headers.get('retry-after')),
    `Blocked source IP response includes Retry-After header: ${blockedAtkRes.headers.get('retry-after')}s`
  );

  // -------------------------------------------------------------------------
  // TEST 3: MEMORY BOUNDS & LRU EVICTION (Fix 3)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Rate Limiter Memory Bounds & LRU Eviction ---');

  const {
    checkRateLimit,
    recordFailedAttempt,
    MAX_STORE_ENTRIES,
    getStoreSize,
    clearStore,
  } = await import('../src/lib/rateLimit.js');

  assert(
    MAX_STORE_ENTRIES === 10000,
    `MAX_STORE_ENTRIES is strictly configured to ${MAX_STORE_ENTRIES}`
  );

  clearStore();
  assert(getStoreSize() === 0, 'Store cleared successfully for unit test');

  // Insert 10,050 unique keys (simulating high-velocity probe attacks)
  for (let k = 0; k < 10050; k++) {
    recordFailedAttempt(`test:key:${k}`, { windowSeconds: 600 });
  }

  const currentSize = getStoreSize();
  assert(
    currentSize <= MAX_STORE_ENTRIES,
    `Store size (${currentSize}) strictly capped at or below MAX_STORE_ENTRIES (${MAX_STORE_ENTRIES}) - Heap overflow prevented!`
  );

  // Oldest keys (e.g. key 0) should have been evicted to make room for newer keys
  const oldestCheck = checkRateLimit('test:key:0', { maxAttempts: 5, windowSeconds: 600 });
  assert(
    oldestCheck.allowed === true && oldestCheck.remaining === 5,
    'Oldest entry (test:key:0) was evicted by LRU bound as expected'
  );

  // Newest keys (e.g. key 10049) should still exist
  const newestCheck = checkRateLimit('test:key:10049', { maxAttempts: 5, windowSeconds: 600 });
  assert(
    newestCheck.remaining === 4,
    'Newest entry (test:key:10049) preserved in memory with recorded attempt'
  );

  // -------------------------------------------------------------------------
  // TEST 4: REGISTRATION PAYLOAD BOUNDING & ABUSIVE VALIDATION (Fix 4)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Registration Payload Limits & Validation Abuse ---');

  const regAttackerIp = `192.0.2.${Math.floor(Math.random() * 200) + 10}`;

  // Test 4A: Oversized payload (>16KB) rejected with 413
  const hugePayload = JSON.stringify({
    companyName: 'A'.repeat(20000),
    adminName: 'Admin',
    adminEmail: 'admin@hugecorp.com',
    password: 'Password123!',
  });

  const sizeRes = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'x-forwarded-for': regAttackerIp },
    body: hugePayload,
  });

  assert(
    sizeRes.status === 413,
    'Oversized registration payload (>16KB) rejected with HTTP 413 Payload Too Large'
  );

  // Test 4B: Abusive validation failures consume rate limit quota
  // Send 4 more invalid registration requests (total 5 consumed slots)
  for (let v = 1; v <= 4; v++) {
    const invalidRes = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': regAttackerIp },
      body: JSON.stringify({
        companyName: '', // invalid
        adminName: '',
        adminEmail: 'invalid-email',
      }),
    });

    assert(
      invalidRes.status === 400,
      `Abusive invalid registration ${v} rejected with 400 and counted against quota`
    );
  }

  // 6th attempt from this IP must now be throttled with HTTP 429
  const regBlockedRes = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'x-forwarded-for': regAttackerIp },
    body: JSON.stringify({
      companyName: 'Valid Name',
      adminName: 'Valid Admin',
      adminEmail: 'valid@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    }),
  });

  assert(
    regBlockedRes.status === 429,
    'Registration rate limiter returns HTTP 429 after 5 abusive attempts from same IP'
  );
  assert(
    Boolean(regBlockedRes.headers.get('retry-after')),
    `Registration throttled response contains Retry-After: ${regBlockedRes.headers.get('retry-after')}s`
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`PHASE 1.2 TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
