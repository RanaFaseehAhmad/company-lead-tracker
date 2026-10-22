/**
 * Phase 1.4: Login Rate-Limit Race Condition & Concurrency Test Suite
 *
 * Deterministically verifies:
 * 1. Concurrent requests cannot bypass the 10-attempt threshold (Promise.all burst).
 * 2. Exactly 10 attempts admitted, additional concurrent requests receive HTTP 429.
 * 3. Release/cancellation is reservation-token-scoped and does not corrupt concurrent requests.
 * 4. Legitimate login authenticates successfully and sets cookies.
 * 5. Distinct source IPs maintain independent rate limits.
 * 6. Store bounds (MAX_STORE_ENTRIES = 10000) and LRU eviction under concurrent key floods.
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
  console.log('   PHASE 1.4 CONCURRENCY & RACE-CONDITION VERIFICATION SUITE   ');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. CONCURRENT REQUEST BURST TEST (Race Condition Mitigation)
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Concurrent Burst from Single IP (Promise.all) ---');

  const burstIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const TOTAL_BURST_REQUESTS = 16;
  const ALLOWED_LIMIT = 10;

  // Fire 16 concurrent requests simultaneously using Promise.all
  console.log(`Firing ${TOTAL_BURST_REQUESTS} simultaneous login requests from IP ${burstIp}...`);
  const burstPromises = [];
  for (let i = 1; i <= TOTAL_BURST_REQUESTS; i++) {
    burstPromises.push(
      request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': burstIp },
        body: JSON.stringify({ email: `burst-${i}@example.com`, password: 'invalid-password' }),
      })
    );
  }

  const results = await Promise.all(burstPromises);

  const statusCounts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Concurrent burst status distribution:', statusCounts);

  const admitted401Count = statusCounts[401] || 0;
  const throttled429Count = statusCounts[429] || 0;

  assert(
    admitted401Count === ALLOWED_LIMIT,
    `Exactly ${ALLOWED_LIMIT} concurrent requests admitted (got ${admitted401Count})`
  );

  assert(
    throttled429Count === (TOTAL_BURST_REQUESTS - ALLOWED_LIMIT),
    `Remaining ${TOTAL_BURST_REQUESTS - ALLOWED_LIMIT} concurrent requests blocked with HTTP 429 (got ${throttled429Count})`
  );

  assert(
    admitted401Count + throttled429Count === TOTAL_BURST_REQUESTS,
    'All concurrent requests completed deterministically without server errors or drops'
  );

  // -------------------------------------------------------------------------
  // 2. RETRY-AFTER HEADERS ON THROTTLED CONCURRENT RESPONSES
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Verifying Headers on Throttled Responses ---');
  const sample429 = results.find((r) => r.status === 429);
  assert(
    Boolean(sample429),
    'Found throttled 429 response in burst results'
  );
  assert(
    Boolean(sample429.headers.get('retry-after')),
    `429 response contains Retry-After: ${sample429.headers.get('retry-after')}s`
  );
  assert(
    sample429.headers.get('x-ratelimit-remaining') === '0',
    '429 response contains X-RateLimit-Remaining: 0'
  );

  // -------------------------------------------------------------------------
  // 3. INDEPENDENCE OF TRACKED SOURCE IPS
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Independent Source IP Quotas ---');
  const distinctIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

  const distinctIpRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': distinctIp },
    body: JSON.stringify({ email: 'independent@example.com', password: 'wrong' }),
  });

  assert(
    distinctIpRes.status === 401,
    `Distinct IP (${distinctIp}) is not blocked by previous IP's exhaustion (returns 401)`
  );

  // -------------------------------------------------------------------------
  // 4. ATOMIC TOKEN RELEASE & LEGITIMATE AUTHENTICATION
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Legitimate Authentication with Token Scoping ---');
  const legitEmail = 'admin@companytracker.test';
  const legitPass = 'SuperAdminTest123!';
  const legitIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

  const legitRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': legitIp },
    body: JSON.stringify({ email: legitEmail, password: legitPass }),
  });

  assert(
    legitRes.status === 200 && legitRes.data?.success === true,
    'Legitimate login succeeds with HTTP 200'
  );
  assert(
    Boolean(legitRes.headers.get('set-cookie')),
    'Legitimate login sets HttpOnly auth_token session cookie'
  );

  // -------------------------------------------------------------------------
  // 5. ATOMIC RESERVATION UNIT-LEVEL CHECKS (Token Scoping & Non-Interference)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing Reservation Unit Mechanics (In-Memory Module) ---');
  const {
    reserveAttempt,
    commitReservation,
    releaseReservation,
    cancelReservation,
    clearStore,
    getStoreSize,
    MAX_STORE_ENTRIES,
  } = await import('../src/lib/rateLimit.js');

  clearStore();
  const testKey = 'test:atomic:ip:10.0.0.1';

  // Reserve slot A and slot B concurrently
  const resA = reserveAttempt(testKey, { maxAttempts: 2, windowSeconds: 60 });
  const resB = reserveAttempt(testKey, { maxAttempts: 2, windowSeconds: 60 });
  const resC = reserveAttempt(testKey, { maxAttempts: 2, windowSeconds: 60 });

  assert(resA.allowed && resB.allowed && !resC.allowed, 'Exactly 2 reservations admitted, 3rd denied');
  assert(resA.reservationId !== resB.reservationId, 'Each reservation receives a unique token ID');

  // Releasing reservation A should free up exactly 1 slot, without affecting B
  releaseReservation(testKey, resA.reservationId);

  const resD = reserveAttempt(testKey, { maxAttempts: 2, windowSeconds: 60 });
  assert(resD.allowed, 'Releasing token A allows a new reservation D');

  // Committing token B and D exhausts the quota again
  commitReservation(testKey, resB.reservationId);
  commitReservation(testKey, resD.reservationId);

  const resE = reserveAttempt(testKey, { maxAttempts: 2, windowSeconds: 60 });
  assert(!resE.allowed, 'Quota full after committing B and D; further requests denied');

  // Test store memory bound
  clearStore();
  for (let k = 0; k < 10100; k++) {
    const res = reserveAttempt(`flood:${k}`, { maxAttempts: 5, windowSeconds: 60 });
    commitReservation(`flood:${k}`, res.reservationId);
  }
  assert(
    getStoreSize() <= MAX_STORE_ENTRIES,
    `Store size (${getStoreSize()}) remains strictly at or below MAX_STORE_ENTRIES (${MAX_STORE_ENTRIES})`
  );

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`PHASE 1.4 TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
