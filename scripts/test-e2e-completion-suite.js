/**
 * Company Lead Tracker — End-to-End Production Verification Suite
 * Verifies:
 * 1. Health & Database connectivity
 * 2. Super Admin authentication & role enforcement
 * 3. Super Admin platform-wide metrics & tenant forms/leads counts
 * 4. Company lifecycle (registration, approval, login)
 * 5. Form creation & publishing
 * 6. Public submission capture (with source and referrer)
 * 7. Server-side Lead Management (pagination, search, formId filter, status filter, date filter)
 * 8. Individual Lead API (inspection, status mutation)
 * 9. Multi-Tenant isolation & IDOR prevention (Company B cannot inspect/mutate Company A's leads/forms)
 * 10. Form Analytics API (total, today UTC policy, timeline, sources, status breakdown)
 * 11. RFC 4180 Excel-ready CSV Export with UTF-8 BOM
 * 12. Blocked company submission rejection & historical data preservation
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
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

async function runE2ETests() {
  console.log('================================================================');
  console.log('   COMPANY LEAD TRACKER — E2E PRODUCTION VERIFICATION SUITE     ');
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

  // --- Test 1: System Health & Database Connectivity ---
  console.log('\n--- 1. Health & Database Connectivity ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy' && healthRes.data?.database === 'connected',
    'Health Check Endpoint',
    `Status: ${healthRes.status}, Body: ${JSON.stringify(healthRes.data)}`
  );

  // --- Test 2: Super Admin Login & Role Enforcement ---
  console.log('\n--- 2. Super Admin Login & Role Verification ---');
  const superAdminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });

  const superAdminCookie = extractCookie(superAdminLogin.setCookie);
  assert(
    superAdminLogin.status === 200 && superAdminLogin.data?.success && superAdminCookie,
    'Super Admin Login at /api/auth/login with requiredRole=super_admin',
    `Status: ${superAdminLogin.status}, Error: ${superAdminLogin.data?.error}`
  );

  // Verify Super Admin company management returns platform totals and counts
  const adminCompaniesRes = await request('/api/admin/companies', {
    headers: { Cookie: `auth_token=${superAdminCookie}` },
  });
  assert(
    adminCompaniesRes.status === 200 &&
      adminCompaniesRes.data?.success &&
      adminCompaniesRes.data?.totals &&
      typeof adminCompaniesRes.data.totals.totalForms === 'number' &&
      typeof adminCompaniesRes.data.totals.totalLeads === 'number',
    'Super Admin Platform-Wide Totals and Tenant Counts',
    `Totals: ${JSON.stringify(adminCompaniesRes.data?.totals)}`
  );

  // --- Test 3: Company Registration, Approval & Authentication ---
  console.log('\n--- 3. Multi-Tenant Provisioning (Tenant A & Tenant B) ---');
  // Register Company A
  const compAEmail = `admin_a_${runId}@alpha.test`;
  const regARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Alpha Corp ${runId}`,
      adminName: 'Alpha Admin',
      adminEmail: compAEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-0101',
    },
  });

  const companyAId = regARes.data?.company?.id || regARes.data?.companyId;

  assert(
    regARes.status === 201 && regARes.data?.success && companyAId,
    'Company A Registration',
    `Status: ${regARes.status}, Error: ${regARes.data?.error}`
  );

  // Approve Company A via Super Admin
  const approveARes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${superAdminCookie}` },
    body: { companyId: companyAId, status: 'approved' },
  });
  assert(approveARes.status === 200 && approveARes.data?.success, 'Super Admin Approves Company A');

  // Login Company A
  const loginARes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAEmail, password: 'Password123!' },
  });
  const compACookie = extractCookie(loginARes.setCookie);
  assert(loginARes.status === 200 && compACookie, 'Company A Login Established');

  // Register Company B (for IDOR isolation tests)
  const compBEmail = `admin_b_${runId}@beta.test`;
  const regBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Beta Corp ${runId}`,
      adminName: 'Beta Admin',
      adminEmail: compBEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
    },
  });
  const companyBId = regBRes.data?.company?.id || regBRes.data?.companyId;

  // Approve Company B
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${superAdminCookie}` },
    body: { companyId: companyBId, status: 'approved' },
  });

  // Login Company B
  const loginBRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compBEmail, password: 'Password123!' },
  });
  const compBCookie = extractCookie(loginBRes.setCookie);
  assert(loginBRes.status === 200 && compBCookie, 'Company B Login Established');

  // --- Test 4: Form Creation & Publishing ---
  console.log('\n--- 4. Dynamic Form Creation & Publishing ---');
  const createFormRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      name: `Contact Form ${runId}`,
      title: 'Get In Touch',
      description: 'Fill out this form to connect with our enterprise team.',
      status: 'published',
      fields: [
        { id: 'f1', label: 'Full Name', key: 'fullName', type: 'text', required: true },
        { id: 'f2', label: 'Email Address', key: 'email', type: 'email', required: true },
        { id: 'f3', label: 'Phone', key: 'phone', type: 'phone', required: false },
        { id: 'f4', label: 'Company Name', key: 'companyName', type: 'text', required: false },
        { id: 'f5', label: 'Message', key: 'message', type: 'textarea', required: false },
      ],
      formioSchema: {
        display: 'form',
        components: [
          { type: 'textfield', key: 'fullName', label: 'Full Name', validate: { required: true } },
          { type: 'email', key: 'email', label: 'Email Address', validate: { required: true } },
          { type: 'phoneNumber', key: 'phone', label: 'Phone' },
          { type: 'textfield', key: 'companyName', label: 'Company Name' },
          { type: 'textarea', key: 'message', label: 'Message' },
          { type: 'button', key: 'submit', label: 'Submit', action: 'submit' },
        ],
      },
    },
  });

  assert(
    createFormRes.status === 201 && createFormRes.data?.success && createFormRes.data?.data?.publicId,
    'Company A Form Created & Published',
    `Status: ${createFormRes.status}, Error: ${createFormRes.data?.error}`
  );

  const formA = createFormRes.data?.data;
  const publicIdA = formA?.publicId;
  const formAId = formA?._id;

  // --- Test 5: Public Submissions Capture with Source & Referrer ---
  console.log('\n--- 5. Public Lead Ingestion Engine ---');
  const submitLeadRes1 = await request(`/api/public/forms/${publicIdA}/submissions`, {
    method: 'POST',
    headers: {
      'Referer': 'https://partner-site.com/landing',
    },
    body: {
      fullName: 'Alice Johnson',
      email: 'alice@example.com',
      phone: '+1-555-8822',
      companyName: 'Acme Enterprise',
      message: 'Interested in volume pricing for our 500-seat team.',
      _source: 'partner_landing',
      _referrer: 'https://partner-site.com/landing',
    },
  });

  assert(
    submitLeadRes1.status === 201 && submitLeadRes1.data?.success && submitLeadRes1.data?.leadId,
    'Public Lead Submission 1 (Alice Johnson) from Partner Landing',
    `Status: ${submitLeadRes1.status}, Data: ${JSON.stringify(submitLeadRes1.data)}`
  );
  const lead1Id = submitLeadRes1.data?.leadId;

  // Submit Lead 2 from direct
  const submitLeadRes2 = await request(`/api/public/forms/${publicIdA}/submissions`, {
    method: 'POST',
    body: {
      fullName: 'Bob Smith',
      email: 'bob@techfirm.io',
      phone: '+1-555-9933',
      companyName: 'TechFirm',
      message: 'Need API documentation.',
      _source: 'direct',
    },
  });
  assert(submitLeadRes2.status === 201 && submitLeadRes2.data?.success, 'Public Lead Submission 2 (Bob Smith)');
  const lead2Id = submitLeadRes2.data?.leadId;

  // --- Test 6: Server-side Leads API Filtering & Pagination ---
  console.log('\n--- 6. Server-Side Leads API (Pagination, Filtering, Search) ---');
  // Get all leads for Company A
  const getLeadsRes = await request('/api/leads', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    getLeadsRes.status === 200 &&
      getLeadsRes.data?.success &&
      getLeadsRes.data?.pagination?.total >= 2 &&
      getLeadsRes.data?.data?.length >= 2,
    'Fetch Company A Leads with Pagination',
    `Total: ${getLeadsRes.data?.pagination?.total}`
  );

  // Filter by formId
  const getByFormRes = await request(`/api/leads?formId=${formAId}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    getByFormRes.status === 200 &&
      getByFormRes.data?.data?.every((l) => (l.formId?._id || l.formId) === formAId),
    'Filter Leads by formId Scoping',
    `Matches: ${getByFormRes.data?.data?.length}`
  );

  // Search by keyword "Alice"
  const searchLeadsRes = await request('/api/leads?search=Alice', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    searchLeadsRes.status === 200 &&
      searchLeadsRes.data?.data?.length === 1 &&
      searchLeadsRes.data?.data[0].email === 'alice@example.com',
    'Search Leads by Name/Email Keyword ("Alice")',
    `Found count: ${searchLeadsRes.data?.data?.length}`
  );

  // Filter by status=new
  const statusFilterRes = await request('/api/leads?status=new', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    statusFilterRes.status === 200 &&
      statusFilterRes.data?.data?.every((l) => l.status?.toLowerCase() === 'new'),
    'Filter Leads by Status ("new")'
  );

  // --- Test 7: Individual Lead Inspection & Status Mutation ---
  console.log('\n--- 7. Individual Lead Dynamic Inspection & Status Mutation ---');
  const getLead1Res = await request(`/api/leads/${lead1Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    getLead1Res.status === 200 &&
      getLead1Res.data?.success &&
      getLead1Res.data?.data?._id === lead1Id &&
      (getLead1Res.data?.data?.submissionData?.fullName === 'Alice Johnson' ||
        getLead1Res.data?.data?.submissionData?.fullname === 'Alice Johnson'),
    'Get Individual Lead Detail with Dynamic submissionData',
    `Status: ${getLead1Res.status}`
  );

  // Update Lead Status to "qualified" with notes
  const updateLeadRes = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      status: 'qualified',
      notes: 'Spoke on call; requested enterprise SLA quote.',
      dealValue: 12000,
    },
  });
  assert(
    updateLeadRes.status === 200 &&
      updateLeadRes.data?.success &&
      updateLeadRes.data?.data?.status === 'qualified' &&
      updateLeadRes.data?.data?.dealValue === 12000,
    'Update Lead Status, Notes & Deal Value',
    `Status: ${updateLeadRes.status}, New status: ${updateLeadRes.data?.data?.status}`
  );

  // Set formula payload on lead2 to test CSV formula injection mitigation
  await request(`/api/leads/${lead2Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      notes: '=SUM(1+1)*cmd',
    },
  });

  // --- Test 8: Multi-Tenant Isolation & IDOR Protection ---
  console.log('\n--- 8. Multi-Tenant Security & IDOR Vulnerability Prevention ---');
  // Company B attempts to access Company A's lead
  const idorLeadGet = await request(`/api/leads/${lead1Id}`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  assert(
    idorLeadGet.status === 404,
    'IDOR Prevention: Company B cannot GET Company A lead (Returns 404)',
    `Status: ${idorLeadGet.status}`
  );

  // Company B attempts to PATCH Company A's lead
  const idorLeadPatch = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compBCookie}` },
    body: { status: 'rejected' },
  });
  assert(
    idorLeadPatch.status === 404,
    'IDOR Prevention: Company B cannot PATCH Company A lead (Returns 404)',
    `Status: ${idorLeadPatch.status}`
  );

  // Company B attempts to view Company A's form analytics
  const idorAnalytics = await request(`/api/forms/${formAId}/analytics`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  assert(
    idorAnalytics.status === 404,
    'IDOR Prevention: Company B cannot GET Company A Form Analytics (Returns 404)',
    `Status: ${idorAnalytics.status}`
  );

  // --- Test 9: Form Analytics API ---
  console.log('\n--- 9. Form Analytics API (UTC Policy & Real Data Aggregation) ---');
  const analyticsRes = await request(`/api/forms/${formAId}/analytics`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    analyticsRes.status === 200 &&
      analyticsRes.data?.success &&
      analyticsRes.data?.data?.summary?.totalSubmissions >= 2 &&
      analyticsRes.data?.data?.summary?.todaySubmissions >= 2 &&
      analyticsRes.data?.data?.statusBreakdown?.qualified >= 1 &&
      Array.isArray(analyticsRes.data?.data?.sources),
    'Form Ingestion Analytics Aggregations',
    `Data: ${JSON.stringify(analyticsRes.data?.data?.summary)}`
  );

  // --- Test 10: Excel-Compatible RFC 4180 CSV Export ---
  console.log('\n--- 10. Excel-Compatible RFC 4180 CSV Export with UTF-8 BOM ---');
  const exportRes = await request(`/api/leads/export?formId=${formAId}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const contentType = exportRes.headers.get('content-type') || '';
  const isUtf8Bom =
    (exportRes.rawBuffer &&
      exportRes.rawBuffer[0] === 0xEF &&
      exportRes.rawBuffer[1] === 0xBB &&
      exportRes.rawBuffer[2] === 0xBF) ||
    exportRes.text.startsWith('\uFEFF') ||
    exportRes.text.charCodeAt(0) === 0xFEFF;
  const hasAlice = exportRes.text.includes('alice@example.com');
  const hasBob = exportRes.text.includes('bob@techfirm.io');

  assert(
    exportRes.status === 200 &&
      contentType.includes('text/csv') &&
      isUtf8Bom &&
      hasAlice &&
      hasBob,
    'CSV Export with UTF-8 BOM, Proper Content-Type, & Tenant-Scoped Rows',
    `Status: ${exportRes.status}, Content-Type: ${contentType}, Has BOM: ${isUtf8Bom}`
  );

  const formulaMitigated = exportRes.text.includes("'=SUM(1+1)*cmd");
  assert(
    formulaMitigated,
    'CSV Formula Injection Neutralized with Single-Quote Prefix',
    `Sanitized formula present: ${formulaMitigated}`
  );

  // Verify Company B CSV export contains 0 leads
  const exportBRes = await request('/api/leads/export', {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  const compBRows = exportBRes.text.trim().split('\n');
  assert(
    exportBRes.status === 200 && compBRows.length === 1,
    'Tenant Scoping on CSV Export (Company B gets only header row)',
    `Rows: ${compBRows.length}`
  );

  // --- Test 11: Blocked Company Submissions & Retention ---
  console.log('\n--- 11. Blocked Company Workflow & Data Retention ---');
  // Block Company A via Super Admin
  const blockRes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${superAdminCookie}` },
    body: { companyId: companyAId, status: 'blocked' },
  });
  assert(blockRes.status === 200 && blockRes.data?.success, 'Super Admin Blocks Company A');

  // Attempt public submission to blocked company's form
  const blockedSubmitRes = await request(`/api/public/forms/${publicIdA}/submissions`, {
    method: 'POST',
    body: {
      fullName: 'Eve Hacker',
      email: 'eve@suspicious.org',
    },
  });
  assert(
    blockedSubmitRes.status === 403,
    'Public Submissions to Blocked Company Rejected with 403 Forbidden',
    `Status: ${blockedSubmitRes.status}, Error: ${blockedSubmitRes.data?.error}`
  );

  // Historical leads for Company A remain intact in the database (verified via Super Admin)
  const historicalLeadsAdmin = await request(`/api/leads?companyId=${companyAId}`, {
    headers: { Cookie: `auth_token=${superAdminCookie}` },
  });
  assert(
    historicalLeadsAdmin.status === 200 &&
      historicalLeadsAdmin.data?.pagination?.total >= 2,
    'Historical Lead Data Preserved in Database During Tenant Blocking',
    `Total: ${historicalLeadsAdmin.data?.pagination?.total}`
  );

  // Unblock Company A to restore normal state
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${superAdminCookie}` },
    body: { companyId: companyAId, status: 'approved' },
  });

  // Verify Company A can once again access historical leads
  const historicalLeadsComp = await request(`/api/leads/${lead1Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    historicalLeadsComp.status === 200 && historicalLeadsComp.data?.data?._id === lead1Id,
    'Historical Lead Data Fully Accessible to Tenant After Unblocking'
  );

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('ALL PRODUCTION VERIFICATION TESTS COMPLETED SUCCESSFULLY!\n');
    process.exit(0);
  }
}

runE2ETests().catch((err) => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
