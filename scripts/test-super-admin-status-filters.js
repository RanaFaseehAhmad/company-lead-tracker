/**
 * Super Admin Dashboard — Company Status Filters & Newest-First Sorting Test Suite
 *
 * Verifies:
 * 1. Default view is Pending companies with newest-first sorting (createdAt descending, _id secondary).
 * 2. Status filtering for pending, approved, blocked, and all companies returns strictly matching records.
 * 3. Status counts (pending, approved, blocked, all) match actual database state.
 * 4. Invalid status filter parameter returns 400 Bad Request.
 * 5. Approve and Block transitions dynamically update the list and counts.
 * 6. RBAC enforcement: Unauthorized requests return 401, non-Super Admin returns 403.
 * 7. Existing platform totals (totalForms, totalLeads, totalCompanies) remain fully intact.
 * 8. UI file inspection confirms default pending state, filter buttons, dynamic counts, and empty states.
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

async function runSuperAdminFilterSuite() {
  console.log('================================================================');
  console.log('   SUPER ADMIN STATUS FILTERS & NEWEST-FIRST SORTING SUITE      ');
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

  // --- 2. Security & Authorization Enforcement ---
  console.log('\n--- 2. RBAC & Security Enforcement ---');
  const anonRes = await request('/api/admin/companies');
  assert(
    anonRes.status === 401,
    'Unauthenticated access to /api/admin/companies is rejected with 401',
    `Status: ${anonRes.status}`
  );

  // Register a temporary company admin to test non-super_admin access
  const compAdminEmail = `company_admin_${runId}@filtertest.test`;
  const regRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Test Security Tenant ${runId}`,
      adminName: 'Security Admin',
      adminEmail: compAdminEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  const securityCompId = regRes.data?.company?.id || regRes.data?.companyId;
  assert(regRes.status === 201 && securityCompId, 'Company Admin registered for security tests');

  // Super Admin login to approve for login
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

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: securityCompId, status: 'approved' },
  });

  const compLoginRes = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: compAdminEmail,
      password: 'Password123!',
    },
  });
  const compCookie = extractCookie(compLoginRes.setCookie);
  assert(compLoginRes.status === 200 && compCookie, 'Company Admin logged in');

  const compAdminAttempt = await request('/api/admin/companies', {
    headers: { Cookie: `auth_token=${compCookie}` },
  });
  assert(
    compAdminAttempt.status === 403,
    'Company Admin access to /api/admin/companies is strictly forbidden with 403',
    `Status: ${compAdminAttempt.status}`
  );

  // --- 3. Status Filter Query Parameter Validation ---
  console.log('\n--- 3. Query Parameter Validation ---');
  const invalidFilterRes = await request('/api/admin/companies?status=nonexistent_status', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    invalidFilterRes.status === 400 && invalidFilterRes.data?.error?.includes('Invalid status filter'),
    'Invalid status filter parameter returns 400 with descriptive error message',
    `Status: ${invalidFilterRes.status}, Error: ${invalidFilterRes.data?.error}`
  );

  // --- 4. Initial Status Counts & Totals Integrity ---
  console.log('\n--- 4. Status Counts & Platform Totals Integrity ---');
  const baseRes = await request('/api/admin/companies', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    baseRes.status === 200 && baseRes.data?.success,
    'Super Admin GET /api/admin/companies succeeds'
  );
  assert(
    baseRes.data?.totals &&
      typeof baseRes.data.totals.totalForms === 'number' &&
      typeof baseRes.data.totals.totalLeads === 'number' &&
      typeof baseRes.data.totals.totalCompanies === 'number',
    'Platform totals structure preserved with totalForms, totalLeads, and totalCompanies'
  );
  assert(
    baseRes.data?.statusCounts &&
      typeof baseRes.data.statusCounts.pending === 'number' &&
      typeof baseRes.data.statusCounts.approved === 'number' &&
      typeof baseRes.data.statusCounts.blocked === 'number' &&
      typeof baseRes.data.statusCounts.all === 'number',
    'Dynamic statusCounts returned with pending, approved, blocked, and all counts'
  );

  const initialCounts = baseRes.data.statusCounts;
  assert(
    initialCounts.all === initialCounts.pending + initialCounts.approved + initialCounts.blocked,
    'statusCounts.all matches the sum of pending + approved + blocked counts',
    `all: ${initialCounts.all}, sum: ${initialCounts.pending + initialCounts.approved + initialCounts.blocked}`
  );

  // --- 5. Status Filtering Verification (Pending, Approved, Blocked, All) ---
  console.log('\n--- 5. Status Filtering Verification ---');

  // 5a. Pending Filter
  const pendingRes = await request('/api/admin/companies?status=pending', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(pendingRes.status === 200 && pendingRes.data?.success, 'GET /api/admin/companies?status=pending succeeds');
  const pendingList = pendingRes.data.data;
  const allPendingMatch = pendingList.every((c) => c.status === 'pending');
  assert(
    allPendingMatch,
    'All companies in pending filter response strictly have status === "pending"'
  );
  assert(
    pendingRes.data.pagination?.totalRecords === pendingRes.data.statusCounts.pending &&
      pendingList.length === Math.min(pendingRes.data.pagination.limit, pendingRes.data.statusCounts.pending),
    'Pending filter result count matches statusCounts.pending and pagination limit',
    `Returned: ${pendingList.length}, Count: ${pendingRes.data.statusCounts.pending}`
  );

  // 5b. Approved Filter
  const approvedRes = await request('/api/admin/companies?status=approved', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(approvedRes.status === 200 && approvedRes.data?.success, 'GET /api/admin/companies?status=approved succeeds');
  const approvedList = approvedRes.data.data;
  const allApprovedMatch = approvedList.every((c) => c.status === 'approved');
  assert(
    allApprovedMatch,
    'All companies in approved filter response strictly have status === "approved"'
  );
  assert(
    approvedRes.data.pagination?.totalRecords === approvedRes.data.statusCounts.approved &&
      approvedList.length === Math.min(approvedRes.data.pagination.limit, approvedRes.data.statusCounts.approved),
    'Approved filter result count matches statusCounts.approved and pagination limit',
    `Returned: ${approvedList.length}, Count: ${approvedRes.data.statusCounts.approved}`
  );

  // 5c. Blocked Filter
  const blockedRes = await request('/api/admin/companies?status=blocked', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(blockedRes.status === 200 && blockedRes.data?.success, 'GET /api/admin/companies?status=blocked succeeds');
  const blockedList = blockedRes.data.data;
  const allBlockedMatch = blockedList.every((c) => c.status === 'blocked');
  assert(
    allBlockedMatch,
    'All companies in blocked filter response strictly have status === "blocked"'
  );
  assert(
    blockedRes.data.pagination?.totalRecords === blockedRes.data.statusCounts.blocked &&
      blockedList.length === Math.min(blockedRes.data.pagination.limit, blockedRes.data.statusCounts.blocked),
    'Blocked filter result count matches statusCounts.blocked and pagination limit',
    `Returned: ${blockedList.length}, Count: ${blockedRes.data.statusCounts.blocked}`
  );

  // 5d. All Filter
  const allRes = await request('/api/admin/companies?status=all', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(allRes.status === 200 && allRes.data?.success, 'GET /api/admin/companies?status=all succeeds');
  assert(
    allRes.data.pagination?.totalRecords === allRes.data.statusCounts.all &&
      allRes.data.data.length === Math.min(allRes.data.pagination.limit, allRes.data.statusCounts.all),
    'All filter result count matches statusCounts.all and pagination limit',
    `Returned: ${allRes.data.data.length}, Count: ${allRes.data.statusCounts.all}`
  );

  // --- 6. Newest-First Sorting & Deterministic Secondary Sort ---
  console.log('\n--- 6. Newest-First Sorting & Deterministic Secondary Sort ---');
  function verifyNewestFirstSorting(list, label) {
    if (list.length < 2) return true;
    for (let i = 0; i < list.length - 1; i++) {
      const current = list[i];
      const next = list[i + 1];
      const curTime = new Date(current.createdAt || 0).getTime();
      const nextTime = new Date(next.createdAt || 0).getTime();

      if (curTime < nextTime) {
        console.error(`Sort violation in ${label}: index ${i} (${curTime}) is older than index ${i + 1} (${nextTime})`);
        return false;
      }
      // If timestamps are equal, verify deterministic secondary sort on ID
      if (curTime === nextTime) {
        if (String(current.id).localeCompare(String(next.id)) < 0) {
          console.error(`Secondary sort violation in ${label} for equal timestamps`);
          return false;
        }
      }
    }
    return true;
  }

  assert(
    verifyNewestFirstSorting(allRes.data.data, 'All Companies'),
    'Companies are sorted newest-first by createdAt descending with deterministic secondary sort'
  );
  assert(
    verifyNewestFirstSorting(pendingList, 'Pending Companies'),
    'Pending companies are sorted newest-first by createdAt descending'
  );

  // --- 7. Dynamic Workflow Transitions: Registration, Approval, Blocking ---
  console.log('\n--- 7. Dynamic Workflow Transitions & Count Refresh ---');

  // Step 7a: Register a brand new company (should be pending)
  const newCompanyEmail = `new_tenant_${runId}@workflow.test`;
  const registerNewRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Brand New Pending Co ${runId}`,
      adminName: 'Brand New Admin',
      adminEmail: newCompanyEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-800-NEW-CO',
    },
  });
  const newCompanyId = registerNewRes.data?.company?.id || registerNewRes.data?.companyId;
  assert(registerNewRes.status === 201 && newCompanyId, 'Brand new company registered');

  // Verify it appears at the TOP of the pending list (newest first!)
  const pendingAfterReg = await request('/api/admin/companies?status=pending', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  assert(
    pendingAfterReg.data.statusCounts.pending === initialCounts.pending + 1,
    'statusCounts.pending incremented by 1 after new registration',
    `Before: ${initialCounts.pending}, After: ${pendingAfterReg.data.statusCounts.pending}`
  );
  assert(
    pendingAfterReg.data.data.length > 0 && pendingAfterReg.data.data[0].id === newCompanyId,
    'Most recently registered pending company appears at the very top (index 0) of the pending list',
    `First company ID: ${pendingAfterReg.data.data[0]?.id}, Expected: ${newCompanyId}`
  );

  // Step 7b: Super Admin Approves the company
  const approveRes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: newCompanyId, status: 'approved' },
  });
  assert(approveRes.status === 200 && approveRes.data?.success, 'Company approved via PATCH /api/admin/companies');

  // Re-fetch pending: company should be gone, pending count decremented
  const pendingAfterApprove = await request('/api/admin/companies?status=pending', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  const inPendingAfterApprove = pendingAfterApprove.data.data.some((c) => c.id === newCompanyId);
  assert(
    !inPendingAfterApprove,
    'Approved company is no longer returned in the Pending filter'
  );
  assert(
    pendingAfterApprove.data.statusCounts.pending === initialCounts.pending,
    'statusCounts.pending decremented back after approval'
  );

  // Re-fetch approved: company should now be in approved list at the top
  const approvedAfterApprove = await request('/api/admin/companies?status=approved', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  const inApprovedAfterApprove = approvedAfterApprove.data.data.some((c) => c.id === newCompanyId);
  assert(
    inApprovedAfterApprove,
    'Newly approved company now appears in the Approved filter'
  );
  assert(
    approvedAfterApprove.data.data[0].id === newCompanyId,
    'Newly approved company appears at the top of the Approved filter list (newest-first)'
  );

  // Step 7c: Super Admin Blocks the company
  const blockRes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: newCompanyId, status: 'blocked' },
  });
  assert(blockRes.status === 200 && blockRes.data?.success, 'Company blocked via PATCH /api/admin/companies');

  // Re-fetch blocked: company should now be in blocked list
  const blockedAfterBlock = await request('/api/admin/companies?status=blocked', {
    headers: { Cookie: `auth_token=${saCookie}` },
  });
  const inBlockedAfterBlock = blockedAfterBlock.data.data.some((c) => c.id === newCompanyId);
  assert(
    inBlockedAfterBlock,
    'Blocked company now appears in the Blocked filter'
  );
  assert(
    blockedAfterBlock.data.statusCounts.blocked === initialCounts.blocked + 1,
    'statusCounts.blocked incremented after blocking company'
  );

  // Re-approve / Unblock to leave tenant active and safe
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: newCompanyId, status: 'approved' },
  });

  // --- 8. UI & Responsive Implementation Audit ---
  console.log('\n--- 8. UI Implementation & State Audit ---');
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
    uiContent.includes("useState('pending')"),
    'UI sets default filter state to "pending"'
  );
  assert(
    uiContent.includes("fetchCompanies('pending')"),
    'UI initially fetches only pending companies on mount'
  );
  assert(
    uiContent.includes('filter-pending-btn') &&
      uiContent.includes('filter-approved-btn') &&
      uiContent.includes('filter-blocked-btn') &&
      uiContent.includes('filter-all-btn'),
    'UI renders dedicated filter buttons for Pending, Approved, Blocked, and All Companies'
  );
  assert(
    uiContent.includes('{statusCounts.pending}') &&
      uiContent.includes('{statusCounts.approved}') &&
      uiContent.includes('{statusCounts.blocked}') &&
      uiContent.includes('{statusCounts.all}'),
    'UI displays dynamic database counts next to each filter tab'
  );
  assert(
    uiContent.includes('No pending companies found') &&
      uiContent.includes('No approved companies found') &&
      uiContent.includes('No blocked companies found'),
    'UI provides clear, contextual empty states for each filter'
  );
  assert(
    uiContent.includes('isFetchingCompanies') && uiContent.includes('animate-spin'),
    'UI provides responsive loading spinner during filter state transitions'
  );
  assert(
    uiContent.includes('Registered') && uiContent.includes('toLocaleDateString'),
    'UI displays registration timestamp to reflect newest-first sorting clearly'
  );

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuperAdminFilterSuite().catch((err) => {
  console.error('Fatal error running super admin filter test suite:', err);
  process.exit(1);
});
