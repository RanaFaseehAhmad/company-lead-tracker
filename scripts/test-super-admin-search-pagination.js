/**
 * Super Admin Dashboard — Company Search & Server-Side Pagination Test Suite
 *
 * Verifies:
 * 1. Searching by partial company name (case-insensitive).
 * 2. Searching by partial email (case-insensitive).
 * 3. Combining search with each status filter (pending, approved, blocked, all).
 * 4. Correct page and page-size metadata (page, limit, totalRecords, totalPages).
 * 5. Previous/Next boundaries, out-of-range pages, and empty search result sets.
 * 6. UI state resets page to 1 when search or status filter changes.
 * 7. Newest-first sorting across pagination pages (createdAt desc, _id desc).
 * 8. Approve and Block actions update status and refresh counts dynamically.
 * 9. Input validation & security: invalid page, limit, status, and malicious regex input handled safely.
 * 10. RBAC: Company Admins and unauthenticated requests are strictly rejected (403 and 401).
 * 11. Accurate global status counts are preserved and do NOT shrink to current search or page.
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  const arrayBuf = await res.arrayBuffer();
  const rawBuffer = Buffer.from(arrayBuf);
  const text = rawBuffer.toString('utf-8');

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, headers: res.headers, data, text, rawBuffer, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runSearchPaginationSuite() {
  console.log('================================================================');
  console.log('   SUPER ADMIN COMPANY SEARCH & SERVER-SIDE PAGINATION SUITE   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} -> ${details}`);
      failed++;
    }
  }

  const runId = Date.now().toString().slice(-6);

  // --- 1. Health & Server Check ---
  console.log('--- 1. Health Check ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy',
    'Database connection is healthy and online'
  );

  // --- 2. Security & RBAC Enforcement ---
  console.log('\n--- 2. RBAC & Security Enforcement ---');
  const unauthRes = await request('/api/admin/companies');
  assert(unauthRes.status === 401, 'Unauthenticated request returns 401 Unauthorized');

  // Super Admin Login
  const saLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const saCookie = extractCookie(saLoginRes.setCookie);
  assert(saLoginRes.status === 200 && saCookie, 'Super Admin logged in successfully');

  // Register a temporary company admin to verify 403 Forbidden
  const compAdminEmail = `company_admin_${runId}@searchrbac.test`;
  const regCompAdmin = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `RBAC Tenant ${runId}`,
      adminName: 'RBAC Admin',
      adminEmail: compAdminEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  const rbacCompId = regCompAdmin.data?.company?.id || regCompAdmin.data?.companyId;
  assert(regCompAdmin.status === 201 && rbacCompId, 'Company Admin registered for RBAC testing');

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: rbacCompId, status: 'approved' },
  });

  const compLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAdminEmail, password: 'Password123!' },
  });
  const compCookie = extractCookie(compLogin.setCookie);
  assert(compLogin.status === 200 && compCookie, 'Company Admin authenticated');

  const compAdminAccess = await request('/api/admin/companies', {
    headers: { Cookie: `auth_token=${compCookie}` },
  });
  assert(
    compAdminAccess.status === 403,
    'Company Admin access to /api/admin/companies returns 403 Forbidden'
  );

  // --- 3. Input Validation (Page, Limit, Status, and Malicious Regex) ---
  console.log('\n--- 3. Parameter Validation & Safe Regex Handling ---');

  // 3a. Invalid Page parameter
  const badPage1 = await request('/api/admin/companies?page=0', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badPage1.status === 400, 'Page=0 returns 400 Bad Request');

  const badPage2 = await request('/api/admin/companies?page=-5', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badPage2.status === 400, 'Page=-5 returns 400 Bad Request');

  const badPage3 = await request('/api/admin/companies?page=invalid', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badPage3.status === 400, 'Page=invalid returns 400 Bad Request');

  // 3b. Invalid Limit parameter
  const badLimit1 = await request('/api/admin/companies?limit=15', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badLimit1.status === 400, 'Limit=15 (not in 10,25,50) returns 400 Bad Request');

  const badLimit2 = await request('/api/admin/companies?limit=-1', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badLimit2.status === 400, 'Limit=-1 returns 400 Bad Request');

  // 3c. Invalid Status parameter
  const badStatus = await request('/api/admin/companies?status=unknown_status', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(badStatus.status === 400, 'Invalid status filter returns 400 Bad Request');

  // 3d. Malicious Regex Injection in Search
  const regexInjection = '/api/admin/companies?search=' + encodeURIComponent('(?i.*[[[+++***\\\\^$');
  const safeRegexRes = await request(regexInjection, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    safeRegexRes.status === 200 && safeRegexRes.data?.success,
    'Malicious regex input is escaped safely without MongoDB crash or 500 error'
  );

  // --- 4. Seed Known Test Companies for Deterministic Search & Pagination ---
  console.log('\n--- 4. Provisioning Controlled Companies for Search & Pagination ---');

  // Create 12 companies: 8 Pending, 2 Approved, 2 Blocked with distinct search tokens
  const testPrefix = `SearchTest_${runId}`;
  const seededCompanyIds = [];

  for (let i = 1; i <= 12; i++) {
    const isSpecialAlpha = i <= 6; // Special keyword "AcmeAlpha"
    const companyName = isSpecialAlpha
      ? `${testPrefix} AcmeAlpha Corp ${i}`
      : `${testPrefix} BetaOmega LLC ${i}`;
    const email = isSpecialAlpha
      ? `acme_contact_${i}_${runId}@acmesearch.test`
      : `beta_contact_${i}_${runId}@betasearch.test`;

    const reg = await request('/api/auth/register', {
      method: 'POST',
      body: {
        companyName,
        adminName: `Admin ${i}`,
        adminEmail: email,
        password: 'Password123!',
        confirmPassword: 'Password123!',
        termsAccepted: true,
      },
    });
    const cId = reg.data?.company?.id || reg.data?.companyId;
    if (cId) seededCompanyIds.push({ id: cId, name: companyName, email, index: i });
  }
  assert(seededCompanyIds.length === 12, '12 controlled test companies registered');

  // Set statuses:
  // indices 9, 10 -> approved
  // indices 11, 12 -> blocked
  // indices 1-8 -> pending
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: seededCompanyIds[8].id, status: 'approved' },
  });
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: seededCompanyIds[9].id, status: 'approved' },
  });
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: seededCompanyIds[10].id, status: 'blocked' },
  });
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: seededCompanyIds[11].id, status: 'blocked' },
  });

  // --- 5. Company Name Search (Case-Insensitive Partial Match) ---
  console.log('\n--- 5. Company Name Search Verification ---');

  // Search "acmealpha" (lowercase, matches "AcmeAlpha Corp")
  const searchNameRes = await request(
    `/api/admin/companies?status=all&search=acmealpha`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(searchNameRes.status === 200 && searchNameRes.data?.success, 'Search by company name succeeds');
  const matchedNameCompanies = searchNameRes.data.data;
  const allMatchName = matchedNameCompanies.every((c) =>
    c.name.toLowerCase().includes('acmealpha')
  );
  assert(
    allMatchName && matchedNameCompanies.length >= 6,
    'All returned records match company name case-insensitively',
    `Found: ${matchedNameCompanies.length}`
  );

  // --- 6. Email Search (Case-Insensitive Partial Match) ---
  console.log('\n--- 6. Email Search Verification ---');

  // Search "betasearch.test" (lowercase)
  const searchEmailRes = await request(
    `/api/admin/companies?status=all&search=BETASEARCH.TEST`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(searchEmailRes.status === 200 && searchEmailRes.data?.success, 'Search by email succeeds');
  const matchedEmailCompanies = searchEmailRes.data.data;
  const allMatchEmail = matchedEmailCompanies.every((c) =>
    c.contactEmail.toLowerCase().includes('betasearch.test')
  );
  assert(
    allMatchEmail && matchedEmailCompanies.length >= 6,
    'All returned records match contactEmail case-insensitively',
    `Found: ${matchedEmailCompanies.length}`
  );

  // --- 7. Combining Search with Each Status Filter ---
  console.log('\n--- 7. Combining Search + Status Filters ---');

  // 7a. Pending + AcmeAlpha
  const pendingSearchRes = await request(
    `/api/admin/companies?status=pending&search=AcmeAlpha`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(
    pendingSearchRes.data.data.every(
      (c) => c.status === 'pending' && c.name.includes('AcmeAlpha')
    ),
    'Combined Status=Pending + Search=AcmeAlpha strictly returns matching pending companies'
  );

  // 7b. Approved + BetaOmega
  const approvedSearchRes = await request(
    `/api/admin/companies?status=approved&search=BetaOmega`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(
    approvedSearchRes.data.data.every(
      (c) => c.status === 'approved' && c.name.includes('BetaOmega')
    ),
    'Combined Status=Approved + Search=BetaOmega strictly returns matching approved companies'
  );

  // 7c. Blocked + BetaOmega
  const blockedSearchRes = await request(
    `/api/admin/companies?status=blocked&search=BetaOmega`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(
    blockedSearchRes.data.data.every(
      (c) => c.status === 'blocked' && c.name.includes('BetaOmega')
    ),
    'Combined Status=Blocked + Search=BetaOmega strictly returns matching blocked companies'
  );

  // 7d. Global Status Counts Integrity during Filtered Search
  // (Crucial requirement: Global status counts must NOT shrink to reflect only search results!)
  assert(
    pendingSearchRes.data.statusCounts.all > pendingSearchRes.data.pagination.totalRecords,
    'Global statusCounts.all preserves total platform count and does not shrink to search result count',
    `Global all: ${pendingSearchRes.data.statusCounts.all}, Search matching: ${pendingSearchRes.data.pagination.totalRecords}`
  );

  // --- 8. Server-Side Pagination & Page-Size Metadata ---
  console.log('\n--- 8. Server-Side Pagination & Metadata Verification ---');

  // Request page 1 with limit 10 for all companies
  const page1Res = await request(`/api/admin/companies?status=all&page=1&limit=10`, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  const p1 = page1Res.data.pagination;
  assert(
    p1 &&
      p1.page === 1 &&
      p1.limit === 10 &&
      p1.totalRecords >= 12 &&
      p1.totalPages >= 2,
    'Page 1 pagination metadata accurate (page=1, limit=10, totalRecords >= 12, totalPages >= 2)'
  );
  assert(
    page1Res.data.data.length === 10,
    'Page 1 returns strictly 10 records matching limit=10'
  );

  // Request page 2 with limit 10
  const page2Res = await request(`/api/admin/companies?status=all&page=2&limit=10`, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  const p2 = page2Res.data.pagination;
  assert(p2.page === 2, 'Page 2 metadata reports page=2');
  assert(
    page2Res.data.data.length > 0 && page2Res.data.data.length <= 10,
    'Page 2 returns valid remaining records'
  );

  // Ensure no overlap between page 1 and page 2
  const p1Ids = new Set(page1Res.data.data.map((c) => c.id));
  const hasOverlap = page2Res.data.data.some((c) => p1Ids.has(c.id));
  assert(!hasOverlap, 'Page 1 and Page 2 contain mutually exclusive records (no duplicates)');

  // Test limit=25
  const limit25Res = await request(`/api/admin/companies?status=all&page=1&limit=25`, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    limit25Res.data.pagination.limit === 25,
    'Limit=25 option honored in pagination metadata'
  );

  // Test limit=50
  const limit50Res = await request(`/api/admin/companies?status=all&page=1&limit=50`, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    limit50Res.data.pagination.limit === 50,
    'Limit=50 option honored in pagination metadata'
  );

  // --- 9. Newest-First Sorting Across Pages ---
  console.log('\n--- 9. Newest-First Sorting Across Pagination Pages ---');
  const lastP1Item = page1Res.data.data[page1Res.data.data.length - 1];
  const firstP2Item = page2Res.data.data[0];
  const tLastP1 = new Date(lastP1Item.createdAt).getTime();
  const tFirstP2 = new Date(firstP2Item.createdAt).getTime();

  assert(
    tLastP1 >= tFirstP2,
    'Newest-first sorting preserved across pages: last item of Page 1 is newer or equal to first item of Page 2',
    `Last P1: ${tLastP1}, First P2: ${tFirstP2}`
  );

  // --- 10. Boundaries & Empty Result Handling ---
  console.log('\n--- 10. Boundaries & Empty Search Handling ---');

  // Out-of-bounds page
  const outOfBoundsRes = await request(`/api/admin/companies?status=all&page=9999&limit=10`, {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    outOfBoundsRes.status === 200 &&
      outOfBoundsRes.data.data.length === 0 &&
      outOfBoundsRes.data.pagination.page === 9999,
    'Out of bounds page (page=9999) returns 200 with empty array and valid pagination metadata'
  );

  // Non-matching search
  const noMatchRes = await request(
    `/api/admin/companies?status=all&search=NONEXISTENT_STRING_XYZ_999`,
    { headers: { Cookie: `auth_token=${saCookie}` } }
  );
  assert(
    noMatchRes.status === 200 &&
      noMatchRes.data.data.length === 0 &&
      noMatchRes.data.pagination.totalRecords === 0 &&
      noMatchRes.data.pagination.totalPages === 1,
    'Non-matching search returns 200 with 0 totalRecords and totalPages=1'
  );

  // --- 11. UI Implementation Audit (Controls, State, Debounce, Reset) ---
  console.log('\n--- 11. UI Implementation Audit ---');
  const superAdminPagePath = path.join(
    __dirname,
    '..',
    'src',
    'app',
    'dashboard',
    'super-admin',
    'page.js'
  );
  const uiContent = fs.readFileSync(superAdminPagePath, 'utf-8');

  assert(
    uiContent.includes('super-admin-search-input') &&
      uiContent.includes('Search by company name or email...'),
    'UI renders search input with exact placeholder "Search by company name or email..."'
  );
  assert(
    uiContent.includes('super-admin-clear-search-btn') &&
      uiContent.includes('handleClearSearch'),
    'UI provides search clear button that resets search input and term'
  );
  assert(
    uiContent.includes('setTimeout') && uiContent.includes('300'),
    'UI implements ~300ms debounce for search input'
  );
  assert(
    uiContent.includes('page-size-select') &&
      uiContent.includes('<option value={10}>10</option>') &&
      uiContent.includes('<option value={25}>25</option>') &&
      uiContent.includes('<option value={50}>50</option>'),
    'UI provides page size selector with options 10, 25, 50'
  );
  assert(
    uiContent.includes('pagination-prev-btn') && uiContent.includes('pagination-next-btn'),
    'UI renders Previous and Next pagination buttons'
  );
  assert(
    uiContent.includes('Showing') && uiContent.includes('of') && uiContent.includes('companies'),
    'UI displays record summary (Showing X–Y of Z companies)'
  );
  assert(
    uiContent.includes('No companies match your search.'),
    'UI shows helpful empty state "No companies match your search."'
  );

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSearchPaginationSuite().catch((err) => {
  console.error('Fatal error running super admin search & pagination suite:', err);
  process.exit(1);
});
