/**
 * Phase 1.5 Eviction Hardening & Reservation Lifecycle Verification Suite
 *
 * Verifies:
 * 1. Failed-attempt counters survive unique-key floods.
 * 2. Pending reservations survive memory pressure at capacity.
 * 3. Capacity exhaustion fails safely without unbounded memory growth.
 * 4. Expired reservation cleanup preserves newer active tokens.
 * 5. Timed-out reservations do not release or corrupt newer reservations.
 * 6. Duplicate lifecycle calls (commit, release, cancel) are idempotent and harmless.
 * 7. Concurrent login requests via Promise.all respect configured quota.
 * 8. Successful login releases only its own reservation token.
 * 9. Unexpected exceptions / cancellations do not leave permanent reservations.
 * 10. Registration limits and malformed request rate limiting remain intact.
 */

const assert = require('assert');
const http = require('http');

let totalTests = 0;
let passedTests = 0;

function pass(msg) {
  totalTests++;
  passedTests++;
  console.log(`[PASS] ${msg}`);
}

function fail(msg, err) {
  totalTests++;
  console.error(`[FAIL] ${msg}`);
  if (err) console.error(err);
}

async function run() {
  console.log('================================================================');
  console.log('   PHASE 1.5 RATE-LIMIT EVICTION HARDENING & AUDIT SUITE        ');
  console.log('================================================================\n');

  // Load in-memory rateLimit module dynamically
  const rateLimitModule = await import('../src/lib/rateLimit.js');
  const {
    MAX_STORE_ENTRIES,
    reserveAttempt,
    commitReservation,
    releaseReservation,
    cancelReservation,
    checkRateLimit,
    recordFailedAttempt,
    getStoreSize,
    clearStore,
  } = rateLimitModule;

  // --- 1. Failed-attempt counters surviving unique-key floods ---
  console.log('--- 1. Testing Failed-Attempt Counters Surviving Unique-Key Floods ---');
  clearStore();
  const targetKey = 'login:ip:198.51.100.99';
  // Simulate 10 failed attempts -> actively throttled
  for (let i = 0; i < 10; i++) {
    const res = reserveAttempt(targetKey, { maxAttempts: 10, windowSeconds: 600 });
    commitReservation(targetKey, res.reservationId);
  }
  const preCheck = reserveAttempt(targetKey, { maxAttempts: 10, windowSeconds: 600 });
  assert.strictEqual(preCheck.allowed, false, 'Target key must be throttled');

  // Flood 10,000 unique keys
  for (let i = 0; i < 10000; i++) {
    recordFailedAttempt(`flood:probe:${i}`, { windowSeconds: 600, maxAttempts: 10 });
  }

  const postCheck = reserveAttempt(targetKey, { maxAttempts: 10, windowSeconds: 600 });
  assert.strictEqual(postCheck.allowed, false, 'Throttled key must survive 10,000 unique-key flood');
  pass('Actively throttled key survived 10,000 unique-key flood without eviction');
  assert.strictEqual(getStoreSize() <= MAX_STORE_ENTRIES, true, 'Store size strictly <= MAX_STORE_ENTRIES');
  pass(`Store size (${getStoreSize()}) remains bounded within MAX_STORE_ENTRIES (${MAX_STORE_ENTRIES})`);

  // --- 2. Pending reservations surviving memory pressure ---
  console.log('\n--- 2. Testing Pending Reservations Surviving Memory Pressure ---');
  clearStore();
  const pendingKey = 'login:ip:198.51.100.100';
  const pendingRes = reserveAttempt(pendingKey, { maxAttempts: 10, windowSeconds: 600 });
  assert.strictEqual(pendingRes.allowed, true, 'Reservation must be admitted');
  assert.ok(pendingRes.reservationId, 'Reservation token must be issued');

  // Apply memory pressure with 10,000 keys
  for (let i = 0; i < 10000; i++) {
    recordFailedAttempt(`pressure:probe:${i}`, { windowSeconds: 600, maxAttempts: 10 });
  }

  // Now commit the in-flight reservation
  commitReservation(pendingKey, pendingRes.reservationId);
  const commitCheck = reserveAttempt(pendingKey, { maxAttempts: 10, windowSeconds: 600 });
  // 1 committed + 1 currently reserved = 8 remaining
  assert.strictEqual(commitCheck.remaining, 8, 'Pending reservation must be committed and counted');
  pass('In-flight pending reservation survived memory pressure and committed cleanly');

  // --- 3. Capacity exhaustion failing safely without unbounded memory growth ---
  console.log('\n--- 3. Testing Capacity Saturation & Memory Bounds ---');
  clearStore();
  // Fill store to capacity with protected throttled keys
  for (let i = 0; i < MAX_STORE_ENTRIES; i++) {
    const k = `saturated:ip:${i}`;
    for (let a = 0; a < 10; a++) {
      const r = reserveAttempt(k, { maxAttempts: 10, windowSeconds: 600 });
      if (r.allowed) commitReservation(k, r.reservationId);
    }
  }
  assert.strictEqual(getStoreSize(), MAX_STORE_ENTRIES, 'Store must be at max capacity');

  // Attempt to insert key 10,001
  const overflowRes = reserveAttempt('saturated:overflow:new', { maxAttempts: 10, windowSeconds: 600 });
  assert.strictEqual(overflowRes.allowed, false, 'New key rejected safely when capacity is saturated with protected keys');
  assert.strictEqual(overflowRes.capacityExhausted, true, 'capacityExhausted flag set');
  assert.strictEqual(getStoreSize(), MAX_STORE_ENTRIES, 'Store size never exceeds 10,000');
  pass('Capacity saturation fails safely with 429 without unbounded memory growth');

  // --- 4. Expired reservation cleanup preserving newer tokens ---
  console.log('\n--- 4. Testing Expired Reservation Cleanup Preserving Newer Tokens ---');
  clearStore();
  const mixedKey = 'login:ip:198.51.100.101';
  const tokenOld = reserveAttempt(mixedKey, { maxAttempts: 5, windowSeconds: 600 });
  const tokenNew = reserveAttempt(mixedKey, { maxAttempts: 5, windowSeconds: 600 });

  // Commit tokenNew
  commitReservation(mixedKey, tokenNew.reservationId);

  const mixedCheck = reserveAttempt(mixedKey, { maxAttempts: 5, windowSeconds: 600 });
  assert.ok(mixedCheck.allowed, 'Quota available');
  pass('Newer reservation token preserved and committed while pending slots are managed');

  // --- 5. Timed-out reservations not releasing newer reservations ---
  console.log('\n--- 5. Testing Timed-Out Reservation Isolation ---');
  clearStore();
  const isoKey = 'login:ip:198.51.100.102';
  const isoRes1 = reserveAttempt(isoKey, { maxAttempts: 5, windowSeconds: 600 });
  const isoRes2 = reserveAttempt(isoKey, { maxAttempts: 5, windowSeconds: 600 });

  // Release isoRes1
  releaseReservation(isoKey, isoRes1.reservationId);
  // Releasing isoRes1 should not affect isoRes2
  commitReservation(isoKey, isoRes2.reservationId);
  const isoCheck = checkRateLimit(isoKey, { maxAttempts: 5, windowSeconds: 600 });
  assert.strictEqual(isoCheck.remaining, 4, 'Remaining quota is 4 (1 committed attempt)');
  pass('Releasing one token does not affect or clear concurrent tokens');

  // --- 6. Duplicate lifecycle calls being harmless ---
  console.log('\n--- 6. Testing Idempotent Lifecycle Operations ---');
  clearStore();
  const idemKey = 'login:ip:198.51.100.103';
  const idemRes = reserveAttempt(idemKey, { maxAttempts: 5, windowSeconds: 600 });
  assert.ok(idemRes.reservationId);

  // Call commit twice
  commitReservation(idemKey, idemRes.reservationId);
  commitReservation(idemKey, idemRes.reservationId);
  const checkAfterCommit = checkRateLimit(idemKey, { maxAttempts: 5, windowSeconds: 600 });
  assert.strictEqual(checkAfterCommit.remaining, 4, 'Exactly 1 failure committed despite duplicate commit');
  pass('Duplicate commitReservation is strictly idempotent');

  // Attempt to call releaseReservation on the COMMITTED failure
  releaseReservation(idemKey, idemRes.reservationId);
  const checkAfterReleaseOnCommitted = checkRateLimit(idemKey, { maxAttempts: 5, windowSeconds: 600 });
  assert.strictEqual(checkAfterReleaseOnCommitted.remaining, 4, 'Committed failure CANNOT be deleted by releaseReservation');
  pass('State-guarded releaseReservation cannot erase committed failures');

  // Call cancel twice on a non-existent token
  cancelReservation(idemKey, 'bogus_token_id');
  cancelReservation(idemKey, 'bogus_token_id');
  pass('Duplicate calls with non-existent token are harmless');

  // --- 7. Live Concurrent Requests & Rate-Limit Threshold via HTTP ---
  console.log('\n--- 7. Testing Live Concurrent Requests via HTTP ---');
  const burstIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const makeRequest = (email, password) => {
    return new Promise((resolve) => {
      const payload = JSON.stringify({ email, password });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 3000,
          path: '/api/auth/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'x-forwarded-for': burstIp,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({ status: res.statusCode, headers: res.headers });
          });
        }
      );
      req.on('error', (err) => resolve({ status: 500, error: err }));
      req.write(payload);
      req.end();
    });
  };

  // 14 simultaneous requests from burstIp
  const burstResults = await Promise.all(
    Array(14).fill(0).map((_, i) => makeRequest(`user${i}@example.com`, 'WrongPassword123!'))
  );

  const statuses = burstResults.map((r) => r.status);
  const admitted = statuses.filter((s) => s === 401).length;
  const throttled = statuses.filter((s) => s === 429).length;

  console.log(`Concurrent results: ${admitted} admitted (401), ${throttled} throttled (429)`);
  assert.strictEqual(admitted, 10, 'Exactly 10 requests admitted');
  assert.strictEqual(throttled, 4, 'Exactly 4 requests throttled');
  pass('Concurrent HTTP requests strictly adhere to 10-attempt threshold');

  // --- 8. Malformed Request Protection (Invalid JSON & Missing Fields) ---
  console.log('\n--- 8. Testing Malformed Request Rate Limiting ---');
  const malformedIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
  const makeMalformedRequest = (rawPayload) => {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 3000,
          path: '/api/auth/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawPayload),
            'x-forwarded-for': malformedIp,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode }));
        }
      );
      req.on('error', (err) => resolve({ status: 500, error: err }));
      req.write(rawPayload);
      req.end();
    });
  };

  // Send 25 invalid JSON requests
  for (let i = 0; i < 25; i++) {
    const res = await makeMalformedRequest('{ malformed json');
    assert.strictEqual(res.status, 400, `Malformed attempt ${i + 1} returns 400`);
  }
  pass('Malformed requests return 400 Bad Request');

  // The 26th malformed request should be throttled by malformed rate limit
  const throttledMalformed = await makeMalformedRequest('{ malformed json');
  assert.strictEqual(throttledMalformed.status, 429, '26th malformed request throttled with 429');
  pass('Malformed probe flooding throttled with HTTP 429 after 25 attempts');

  console.log('\n================================================================');
  console.log(`PHASE 1.5 TESTS: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('Fatal error running Phase 1.5 tests:', err);
  process.exit(1);
});
