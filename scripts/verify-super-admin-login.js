/**
 * Verification script for Super Admin login and /api/auth/me
 */

import fs from 'node:fs';
import path from 'node:path';

// Parse .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const BASE_URL = 'http://localhost:3000';
const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function run() {
  console.log('=== Verifying Super Admin Login & /api/auth/me ===\n');

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

  // 1. Wrong password check
  const badLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'IncorrectPassword999!' }),
  });
  const badLoginData = await badLoginRes.json();
  assert(
    badLoginRes.status === 401 && badLoginData.success === false,
    'Wrong password rejected with 401'
  );

  // 2. Correct login check
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  const loginData = await loginRes.json();
  const token = extractCookie(setCookie);

  assert(
    loginRes.status === 200 &&
    loginData.success === true &&
    loginData.user.email === email &&
    loginData.user.role === 'super_admin' &&
    !!token &&
    setCookie.includes('HttpOnly'),
    'Super Admin login successful with valid credentials & HTTP-only cookie set'
  );

  // 3. /api/auth/me check
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: `auth_token=${token}` },
  });
  const meData = await meRes.json();

  assert(
    meRes.status === 200 &&
    meData.success === true &&
    meData.user.email === email &&
    meData.user.role === 'super_admin' &&
    !meData.user.passwordHash,
    '/api/auth/me returns valid super_admin profile without password hash'
  );

  // 4. Verify existing test Super Admin (admin@companytracker.test) still functions
  const originalAdminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
    }),
  });
  const origAdminData = await originalAdminLoginRes.json();
  assert(
    originalAdminLoginRes.status === 200 &&
    origAdminData.success === true &&
    origAdminData.user.role === 'super_admin',
    'Existing Super Admin (admin@companytracker.test) remains intact and fully functional'
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
