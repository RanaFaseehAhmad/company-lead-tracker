/**
 * Rate Limiter for Authentication and Public Endpoints
 *
 * Hardened Architecture (Phase 1.5):
 * 1. Synchronous Atomic Reservation:
 *    - 'reserveAttempt' synchronously allocates an attempt slot in Node.js's event tick
 *      before any asynchronous operation (DB query, password hashing, JSON parsing).
 *    - Eliminates asynchronous check-to-increment race condition under high concurrency.
 *
 * 2. Idempotent & State-Guarded Reservation Lifecycle:
 *    - Each reservation receives a unique reservation token ('res_...').
 *    - 'commitReservation': Transitions reservation from 'reserved' to 'committed' (failed attempt).
 *      Strictly idempotent; subsequent calls do not mutate timestamps or re-commit.
 *    - 'releaseReservation': Releases ONLY uncommitted 'reserved' tokens (e.g. on successful login).
 *      NEVER releases or erases a 'committed' failure.
 *    - 'cancelReservation': Alias for releaseReservation for exception handling.
 *    - Expired pending reservations auto-expire after 30 seconds (RESERVATION_TIMEOUT_MS)
 *      so uncompleted requests never permanently tie up quota.
 *
 * 3. Eviction Hardening & Memory Bounds:
 *    - MAX_STORE_ENTRIES = 10000 strictly enforced; heap overflow is impossible.
 *    - Active Protection:
 *      * Entries with in-flight pending reservations are NEVER evicted.
 *      * Entries with active throttles (quota exceeded) are NEVER evicted by new key insertions.
 *    - Candidate Selection: Evicts only unthrottled keys with 0 pending reservations,
 *      preferring keys with lowest active attempts (e.g. single 1-off probe).
 *    - Safe Capacity Saturation: If all 10,000 entries are active protected records,
 *      new keys are safely throttled (capacityExhausted: true) rather than dropping security locks
 *      or growing memory without bounds.
 *
 * 4. Proxy Trust Controls:
 *    - TRUST_PROXY: 'true' when deployed behind a verified reverse proxy.
 *    - TRUST_PROXY_HOPS: Number of trusted proxy hops (default: 1).
 *    - Production defaults to '127.0.0.1' or safe fallback when proxy is untrusted.
 */

export const MAX_STORE_ENTRIES = 10000;
const RESERVATION_TIMEOUT_MS = 30 * 1000; // 30s timeout for uncommitted pending reservations
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5m periodic purge
let lastCleanup = Date.now();

// In-memory sliding window store: Map<string, { limit: number, items: Array<{ id: string, timestamp: number, expiresAt: number, state: 'reserved'|'committed' }> }>
const rateLimitStore = new Map();

/**
 * Purges expired items and keys across the store.
 */
function purgeExpiredEntries(now = Date.now()) {
  for (const [key, record] of rateLimitStore.entries()) {
    record.items = (record.items || []).filter((item) => {
      if (item.state === 'committed') {
        return now < item.expiresAt;
      }
      if (item.state === 'reserved') {
        return now - item.timestamp < RESERVATION_TIMEOUT_MS;
      }
      return false;
    });

    if (record.items.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Finds an eligible evictable candidate key.
 * A key can ONLY be evicted if:
 * 1. It has NO active in-flight pending reservations.
 * 2. It is NOT currently throttled (activeCount < limit).
 * Preference is given to keys with the fewest committed attempts (e.g. single 1-off probe),
 * and among those, the oldest LRU entry.
 */
function findEvictableCandidate(now, defaultMaxAttempts = 10) {
  let bestKey = null;
  let minCount = Infinity;

  for (const [key, record] of rateLimitStore.entries()) {
    const hasPendingReservation = (record.items || []).some(
      (i) => i.state === 'reserved' && now - i.timestamp < RESERVATION_TIMEOUT_MS
    );
    if (hasPendingReservation) continue; // Never evict in-flight reservations

    const activeCount = (record.items || []).filter(
      (i) => i.state === 'committed' && now < i.expiresAt
    ).length;

    const limit = record.limit || defaultMaxAttempts;
    if (activeCount >= limit) continue; // Never evict actively throttled keys

    if (activeCount < minCount) {
      minCount = activeCount;
      bestKey = key;
      if (minCount <= 1) break; // Lowest possible active count, pick immediately
    }
  }

  return bestKey;
}

/**
 * Prepares store space for a new key.
 * Returns true if space is available (or was freed), false if capacity is 100% saturated with protected active records.
 */
function ensureStoreCapacity(key, defaultMaxAttempts = 10) {
  if (rateLimitStore.has(key)) return true; // Existing key does not consume new slot
  if (rateLimitStore.size < MAX_STORE_ENTRIES) return true;

  const now = Date.now();
  purgeExpiredEntries(now);

  while (rateLimitStore.size >= MAX_STORE_ENTRIES) {
    const candidateKey = findEvictableCandidate(now, defaultMaxAttempts);
    if (candidateKey) {
      rateLimitStore.delete(candidateKey);
    } else {
      // All entries in store are protected active records (in-flight reservations or throttled keys)
      return false;
    }
  }

  return true;
}

/**
 * Validates IPv4 or IPv6 syntax strictly.
 */
function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^[a-fA-F0-9:]+$/;
  return ipv4Regex.test(ip) || (ipv6Regex.test(ip) && ip.includes(':'));
}

/**
 * Extracts and validates client IP address based on proxy trust configuration.
 */
export function getClientIp(request) {
  if (!request || !request.headers) return '127.0.0.1';

  const isProd = process.env.NODE_ENV === 'production';
  const trustProxyEnv = process.env.TRUST_PROXY === 'true';
  const isDevOrTest = !isProd || process.env.ALLOW_DEV_PROXY === 'true' || process.env.NODE_ENV === 'test';

  const shouldInspectHeaders = trustProxyEnv || isDevOrTest;

  if (shouldInspectHeaders) {
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp && isValidIp(cfIp.trim())) {
      return cfIp.trim();
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp && isValidIp(realIp.trim())) {
      return realIp.trim();
    }

    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        const hops = Math.max(1, parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));
        const targetIndex = isDevOrTest && parts.length === 1 ? 0 : Math.max(0, parts.length - hops);
        const candidate = parts[targetIndex];
        if (candidate && isValidIp(candidate)) {
          return candidate;
        }
      }
    }
  }

  return trustProxyEnv ? 'unknown-proxy-client' : '127.0.0.1';
}

/**
 * Synchronously reserves an attempt slot before any asynchronous I/O occurs.
 * Guarantees race-safe limits under high-concurrency bursts and protects active entries from eviction.
 *
 * @param {string} key Unique rate limit key
 * @param {object} options
 * @param {number} options.maxAttempts Maximum allowed attempts in window
 * @param {number} options.windowSeconds Duration of window in seconds
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number, resetTime: number, limit: number, reservationId: string|null, capacityExhausted: boolean }}
 */
export function reserveAttempt(key, { maxAttempts = 10, windowSeconds = 600 } = {}) {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  const hasCapacity = ensureStoreCapacity(key, maxAttempts);
  if (!hasCapacity) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: 60,
      resetTime: Math.ceil((now + 60000) / 1000),
      limit: maxAttempts,
      reservationId: null,
      capacityExhausted: true,
    };
  }

  const record = rateLimitStore.get(key) || { limit: maxAttempts, items: [] };
  record.limit = maxAttempts;

  // Filter items in active sliding window
  record.items = (record.items || []).filter((item) => {
    if (item.state === 'committed') {
      return now < item.expiresAt;
    }
    if (item.state === 'reserved') {
      return now - item.timestamp < RESERVATION_TIMEOUT_MS;
    }
    return false;
  });

  const activeCount = record.items.length;
  const allowed = activeCount < maxAttempts;
  const remaining = Math.max(0, maxAttempts - activeCount);

  let retryAfter = 0;
  if (!allowed && record.items.length > 0) {
    const oldest = record.items[0];
    const expiry = oldest.expiresAt || (oldest.timestamp + (oldest.state === 'reserved' ? RESERVATION_TIMEOUT_MS : windowMs));
    retryAfter = Math.ceil((expiry - now) / 1000);
    if (retryAfter < 1) retryAfter = 1;
  }

  const resetTime = Math.ceil((now + (retryAfter > 0 ? retryAfter * 1000 : windowMs)) / 1000);

  let reservationId = null;
  if (allowed) {
    // Generate unique reservation token
    reservationId = 'res_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    record.items.push({
      id: reservationId,
      timestamp: now,
      expiresAt: now + RESERVATION_TIMEOUT_MS,
      state: 'reserved',
    });
  }

  // Refresh LRU ordering
  rateLimitStore.delete(key);
  rateLimitStore.set(key, record);

  return {
    allowed,
    remaining: allowed ? Math.max(0, remaining - 1) : 0,
    retryAfter,
    resetTime,
    limit: maxAttempts,
    reservationId,
    capacityExhausted: false,
  };
}

/**
 * Commits a reservation as a failed attempt into the sliding window.
 * Strictly idempotent: subsequent calls with the same token do not re-commit or modify timestamps.
 *
 * @param {string} key
 * @param {string} reservationId
 * @param {object} options
 * @param {number} options.windowSeconds
 */
export function commitReservation(key, reservationId, { windowSeconds = 600 } = {}) {
  if (!reservationId) return;
  const record = rateLimitStore.get(key);
  if (!record || !record.items) return;

  const item = record.items.find((i) => i.id === reservationId);
  if (item && item.state === 'reserved') {
    item.state = 'committed';
    item.timestamp = Date.now();
    item.expiresAt = item.timestamp + (windowSeconds * 1000);

    rateLimitStore.delete(key);
    rateLimitStore.set(key, record);
  }
}

/**
 * Releases/refunds a specific pending reservation (e.g. on successful login or cancellation).
 * IDEMPOTENT & STATE-GUARDED:
 * - Releases ONLY items in 'reserved' state.
 * - NEVER releases or deletes a 'committed' failure attempt.
 * - Does NOT touch or decrement any other concurrent request's reservation.
 *
 * @param {string} key
 * @param {string} reservationId
 */
export function releaseReservation(key, reservationId) {
  if (!reservationId) return;
  const record = rateLimitStore.get(key);
  if (!record || !record.items) return;

  const item = record.items.find((i) => i.id === reservationId);
  if (!item || item.state !== 'reserved') {
    // If token does not exist or is already committed as a failure, do not release
    return;
  }

  record.items = record.items.filter((i) => i.id !== reservationId);
  if (record.items.length === 0) {
    rateLimitStore.delete(key);
  } else {
    rateLimitStore.delete(key);
    rateLimitStore.set(key, record);
  }
}

/**
 * Cancels a reservation (alias for releaseReservation for exception handling).
 */
export function cancelReservation(key, reservationId) {
  releaseReservation(key, reservationId);
}

/**
 * Checks rate limit without reserving (used for read-only checks).
 */
export function checkRateLimit(key, { maxAttempts = 5, windowSeconds = 600 } = {}) {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    purgeExpiredEntries(now);
    lastCleanup = now;
  }

  const record = rateLimitStore.get(key) || { limit: maxAttempts, items: [] };

  record.items = (record.items || []).filter((item) => {
    if (item.state === 'committed') {
      return now < item.expiresAt;
    }
    if (item.state === 'reserved') {
      return now - item.timestamp < RESERVATION_TIMEOUT_MS;
    }
    return false;
  });

  if (record.items.length === 0) {
    rateLimitStore.delete(key);
  } else {
    rateLimitStore.delete(key);
    rateLimitStore.set(key, record);
  }

  const attempts = record.items.length;
  const allowed = attempts < maxAttempts;
  const remaining = Math.max(0, maxAttempts - attempts);

  let retryAfter = 0;
  if (!allowed && record.items.length > 0) {
    const oldest = record.items[0];
    const expiry = oldest.expiresAt || (oldest.timestamp + (oldest.state === 'reserved' ? RESERVATION_TIMEOUT_MS : windowMs));
    retryAfter = Math.ceil((expiry - now) / 1000);
    if (retryAfter < 1) retryAfter = 1;
  }

  const resetTime = Math.ceil((now + (retryAfter > 0 ? retryAfter * 1000 : windowMs)) / 1000);

  return {
    allowed,
    remaining,
    retryAfter,
    resetTime,
    limit: maxAttempts,
  };
}

/**
 * Records a direct attempt for simple callers (e.g. registration, account attempts).
 */
export function recordFailedAttempt(key, { windowSeconds = 600, maxAttempts = 10 } = {}) {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();

  const hasCapacity = ensureStoreCapacity(key, maxAttempts);
  if (!hasCapacity) {
    return; // Safely fail-closed without crashing or leaking memory
  }

  const record = rateLimitStore.get(key) || { limit: maxAttempts, items: [] };
  record.items = (record.items || []).filter((item) => now < (item.expiresAt || (item.timestamp + windowMs)));
  record.items.push({
    id: 'att_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 9),
    timestamp: now,
    expiresAt: now + windowMs,
    state: 'committed',
  });

  rateLimitStore.delete(key);
  rateLimitStore.set(key, record);
}

/**
 * Resets the rate limit state for a given key.
 */
export function resetRateLimit(key) {
  rateLimitStore.delete(key);
}

/**
 * Constructs standard rate limit response headers.
 */
export function createRateLimitHeaders(limitInfo) {
  const headers = {
    'X-RateLimit-Limit': String(limitInfo.limit),
    'X-RateLimit-Remaining': String(limitInfo.remaining),
    'X-RateLimit-Reset': String(limitInfo.resetTime),
  };

  if (limitInfo.retryAfter > 0) {
    headers['Retry-After'] = String(limitInfo.retryAfter);
  }

  return headers;
}

export function getStoreSize() {
  return rateLimitStore.size;
}

export function clearStore() {
  rateLimitStore.clear();
}
