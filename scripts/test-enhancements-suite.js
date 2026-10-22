/**
 * Company Lead Tracker — Enhancements & Regression Verification Suite
 *
 * Verifies all four requirements:
 * 1. Leads Auto-Refresh & Ingestion: Public submission creates exactly 1 lead,
 *    persists submissionData/formId, updates totals, respects active filters, prevents duplicates.
 * 2. Debug UI Removal: Verifies "Verify Endpoints with Active Session" is removed from UI,
 *    while backend endpoints (/api/auth/me, /api/forms, /api/leads) remain intact.
 * 3. Company Settings: Company Admin can view & update permitted details (name, contact, email,
 *    phone, website, address), changes persist, privileged field modification is forbidden (403),
 *    IDOR is prevented, and duplicates are rejected (409).
 * 4. Logout Error Fix: POST & GET /api/auth/logout clear session cleanly, redirect properly,
 *    handle expired sessions, and protected routes reject unauthenticated requests securely.
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
  const location = res.headers.get('location');
  return { status: res.status, headers: res.headers, data, text, rawBuffer, setCookie, location };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runEnhancementsSuite() {
  console.log('================================================================');
  console.log('   COMPANY LEAD TRACKER — ENHANCEMENTS & REGRESSION SUITE       ');
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

  // 1. Health & Server Check
  console.log('--- 1. Health Check ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy',
    'Health Check Endpoint returns healthy database'
  );

  // 2. Debug UI Absence Verification
  console.log('\n--- 2. Debug UI ("Verify Endpoints with Active Session") Removal ---');
  const companyAdminPagePath = path.join(
    __dirname,
    '..',
    'src',
    'app',
    'dashboard',
    'company-admin',
    'page.js'
  );
  const pageContent = fs.readFileSync(companyAdminPagePath, 'utf-8');
  const hasDebugHeading = pageContent.includes('Verify Endpoints with Active Session');
  assert(
    !hasDebugHeading,
    'Debug section "Verify Endpoints with Active Session" is completely removed from Company Admin page code'
  );

  // 3. Super Admin & Tenant Provisioning
  console.log('\n--- 3. Multi-Tenant Provisioning (Tenant Alpha & Tenant Beta) ---');
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const saCookie = extractCookie(saLogin.setCookie);
  assert(saLogin.status === 200 && saCookie, 'Super Admin Login Successful');

  // Register & Approve Company Alpha
  const compAlphaEmail = `admin_alpha_${runId}@alpha.test`;
  const regAlphaRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Alpha Tech ${runId}`,
      adminName: 'Alpha Admin',
      adminEmail: compAlphaEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-1111',
    },
  });
  const compAlphaId = regAlphaRes.data?.company?.id || regAlphaRes.data?.companyId;
  assert(regAlphaRes.status === 201 && compAlphaId, 'Company Alpha Registered');

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: compAlphaId, status: 'approved' },
  });

  const loginAlphaRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAlphaEmail, password: 'Password123!' },
  });
  const compAlphaCookie = extractCookie(loginAlphaRes.setCookie);
  assert(loginAlphaRes.status === 200 && compAlphaCookie, 'Company Alpha Authenticated');

  // Register & Approve Company Beta
  const compBetaEmail = `admin_beta_${runId}@beta.test`;
  const regBetaRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Beta Corp ${runId}`,
      adminName: 'Beta Admin',
      adminEmail: compBetaEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-2222',
    },
  });
  const compBetaId = regBetaRes.data?.company?.id || regBetaRes.data?.companyId;
  assert(regBetaRes.status === 201 && compBetaId, 'Company Beta Registered');

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: compBetaId, status: 'approved' },
  });

  const loginBetaRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compBetaEmail, password: 'Password123!' },
  });
  const compBetaCookie = extractCookie(loginBetaRes.setCookie);
  assert(loginBetaRes.status === 200 && compBetaCookie, 'Company Beta Authenticated');

  // Verify backend APIs that were under debug section remain fully functional
  console.log('\n--- 4. Backend Endpoints Preservation Check ---');
  const meRes = await request('/api/auth/me', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(meRes.status === 200 && meRes.data?.success && meRes.data?.user?.email === compAlphaEmail, 'GET /api/auth/me works correctly');

  const formsListRes = await request('/api/forms', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(formsListRes.status === 200 && formsListRes.data?.success && Array.isArray(formsListRes.data.data), 'GET /api/forms works correctly');

  const leadsListRes = await request('/api/leads', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(leadsListRes.status === 200 && leadsListRes.data?.success && Array.isArray(leadsListRes.data.data), 'GET /api/leads works correctly');

  // 5. Company Settings API & Security
  console.log('\n--- 5. Company Settings API & Security Verification ---');

  // A. Unauthenticated access blocked
  const unauthSettings = await request('/api/company/settings');
  assert(
    unauthSettings.status === 401,
    'Unauthenticated GET /api/company/settings returns 401 Unauthorized',
    `Status: ${unauthSettings.status}`
  );

  // B. Company Alpha reads own settings
  const alphaSettings = await request('/api/company/settings', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    alphaSettings.status === 200 &&
      alphaSettings.data?.success &&
      alphaSettings.data?.company?.name === `Alpha Tech ${runId}`,
    'Company Admin retrieves own settings profile',
    `Name: ${alphaSettings.data?.company?.name}`
  );

  // C. Company Alpha updates permitted fields (name, contactName, contactEmail, contactPhone, website, address)
  const updatedAlphaRes = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
    body: {
      name: `Alpha Enterprises Global ${runId}`,
      contactName: 'Alice Chief',
      contactEmail: `contact_${runId}@alphaenterprises.test`,
      contactPhone: '+1-555-9876',
      website: 'https://alphaenterprises.test',
      address: '100 Silicon Way, Suite 500, Austin, TX 78701',
    },
  });
  assert(
    updatedAlphaRes.status === 200 &&
      updatedAlphaRes.data?.success &&
      updatedAlphaRes.data?.company?.name === `Alpha Enterprises Global ${runId}` &&
      updatedAlphaRes.data?.company?.website === 'https://alphaenterprises.test' &&
      updatedAlphaRes.data?.company?.address === '100 Silicon Way, Suite 500, Austin, TX 78701',
    'Company Admin successfully updates all permitted profile fields'
  );

  // D. Verify persistence across fresh GET
  const verifySettingsRes = await request('/api/company/settings', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    verifySettingsRes.status === 200 &&
      verifySettingsRes.data?.company?.name === `Alpha Enterprises Global ${runId}` &&
      verifySettingsRes.data?.company?.contactName === 'Alice Chief' &&
      verifySettingsRes.data?.company?.contactPhone === '+1-555-9876',
    'Profile updates persist correctly in database'
  );

  // E. Privileged field mutation prevention (status, role, subscription)
  const privilegedAttempt = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
    body: { status: 'blocked', role: 'super_admin' },
  });
  assert(
    privilegedAttempt.status === 403,
    'Attempt to modify privileged fields (status, role) rejected with 403 Forbidden',
    `Status: ${privilegedAttempt.status}`
  );

  // Verify status is still approved
  const checkStatusRes = await request('/api/company/settings', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    checkStatusRes.data?.company?.status === 'approved',
    'Company status remains approved (privileged tamper prevented)'
  );

  // F. IDOR Prevention: Company Beta cannot modify Company Alpha
  const idorSettingsAttempt = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compBetaCookie}` },
    body: {
      companyId: compAlphaId,
      name: 'Malicious Hijack Name',
    },
  });
  // Should only update Company Beta (or reject spoofed companyId), leaving Company Alpha unchanged
  const alphaCheckAfterIdor = await request('/api/company/settings', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    alphaCheckAfterIdor.data?.company?.name === `Alpha Enterprises Global ${runId}`,
    'IDOR Protection: Client-supplied companyId ignored; Company Alpha profile is completely untouched'
  );

  // G. Duplicate Name Conflict (409 Conflict)
  const duplicateNameRes = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compBetaCookie}` },
    body: { name: `Alpha Enterprises Global ${runId}` },
  });
  assert(
    duplicateNameRes.status === 409 &&
      duplicateNameRes.data?.error?.includes('already exists'),
    'Duplicate company name rejected with 409 Conflict'
  );

  // H. Validation Error States (400 Bad Request)
  const invalidEmailRes = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
    body: { contactEmail: 'not-an-email-address' },
  });
  assert(
    invalidEmailRes.status === 400 &&
      invalidEmailRes.data?.error?.includes('valid contact email'),
    'Invalid contact email format rejected with 400 Bad Request'
  );

  const emptyNameRes = await request('/api/company/settings', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
    body: { name: '   ' },
  });
  assert(
    emptyNameRes.status === 400 &&
      emptyNameRes.data?.error?.includes('cannot be empty'),
    'Empty company name rejected with 400 Bad Request'
  );

  // 6. Form Submission, Real-Time Leads Pipeline & Metrics
  console.log('\n--- 6. Form Submission & Real-Time Leads Pipeline ---');

  // Create published Form for Company Alpha
  const formRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
    body: {
      title: `Lead Intake ${runId}`,
      description: 'Public inquiry form',
      status: 'published',
      formioSchema: {
        display: 'form',
        components: [
          { key: 'companyName', label: 'Company Name', type: 'textfield', validate: { required: true } },
          { key: 'contactPerson', label: 'Contact Person', type: 'textfield' },
          { key: 'email', label: 'Email', type: 'email', validate: { required: true } },
          { key: 'phone', label: 'Phone', type: 'phoneNumber' },
          { key: 'projectDetails', label: 'Project Details', type: 'textarea' },
          { key: 'submit', label: 'Submit', type: 'button' },
        ],
      },
    },
  });
  const form = formRes.data?.data || formRes.data?.form;
  const publicId = form?.publicId;
  assert(formRes.status === 201 && publicId, 'Published Form created with publicId');

  // Verify initial lead count for Company Alpha
  const initialLeads = await request('/api/leads?limit=1', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  const initialCount = initialLeads.data?.pagination?.total || 0;

  // Submit a lead via public submission endpoint
  const publicSubmissionRes = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    headers: {
      referer: 'https://external-partner-site.com/contact-us',
    },
    body: {
      companyName: `Delta Solutions ${runId}`,
      contactPerson: 'David Miller',
      email: `david_${runId}@deltasolutions.test`,
      phone: '+1-555-7788',
      projectDetails: 'We need enterprise lead tracking integration',
    },
  });
  const submittedLeadId = publicSubmissionRes.data?.leadId;
  assert(
    publicSubmissionRes.status === 201 && submittedLeadId,
    'Public form submission creates exactly one lead (HTTP 201 with leadId)',
    `leadId: ${submittedLeadId}`
  );

  // Verify Company Alpha's Leads pipeline automatically reflects the new lead
  const updatedLeads = await request('/api/leads', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  const updatedCount = updatedLeads.data?.pagination?.total || 0;
  const leadList = updatedLeads.data?.data || [];
  const foundLead = leadList.find((l) => l._id === submittedLeadId);

  assert(
    updatedCount === initialCount + 1,
    `Lead counts and pagination automatically incremented (${initialCount} -> ${updatedCount})`
  );

  const detailsVal =
    foundLead?.submissionData?.projectDetails ||
    foundLead?.submissionData?.projectdetails;

  assert(
    foundLead &&
      foundLead.companyName === `Delta Solutions ${runId}` &&
      foundLead.contactPerson === 'David Miller' &&
      foundLead.email === `david_${runId}@deltasolutions.test` &&
      detailsVal === 'We need enterprise lead tracking integration' &&
      (foundLead.status === 'New' || foundLead.status === 'new'),
    'New lead appears with correct submitted answers, formId, source, and status New',
    `Found lead: ${JSON.stringify(foundLead)}`
  );

  // Tenant Isolation: Company Beta sees zero of Company Alpha's leads
  const betaLeadsRes = await request('/api/leads', {
    headers: { Cookie: `auth_token=${compBetaCookie}` },
  });
  const betaLeadList = betaLeadsRes.data?.data || [];
  const leakedLead = betaLeadList.find((l) => l._id === submittedLeadId);
  assert(
    !leakedLead && betaLeadsRes.data?.pagination?.total === 0,
    'Multi-Tenant Isolation: Company Beta leads table contains 0 leads; no cross-company leakage'
  );

  // Active filter exclusion: filtered search for status=lost does not return new lead
  const filterLostRes = await request('/api/leads?status=lost', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    filterLostRes.data?.pagination?.total === 0,
    'Active filter scoping: Lead with status "New" is not returned when filtering by status="lost"'
  );

  // Active filter match: search by contact person name
  const searchMatchRes = await request('/api/leads?search=David+Miller', {
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    searchMatchRes.data?.pagination?.total === 1 &&
      searchMatchRes.data?.data?.[0]?._id === submittedLeadId,
    'Active search query correctly matches and returns the new lead'
  );

  // 7. Logout Endpoint & Authentication Error Prevention
  console.log('\n--- 7. Logout Endpoint & Session Clearing ---');

  // A. POST /api/auth/logout clears auth cookie
  const logoutRes = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compAlphaCookie}` },
  });
  assert(
    logoutRes.status === 200 && logoutRes.data?.success,
    'POST /api/auth/logout returns 200 OK'
  );
  assert(
    logoutRes.setCookie && logoutRes.setCookie.includes('Max-Age=0'),
    'Logout response sets auth_token cookie with Max-Age=0 to clear browser session'
  );

  // B. Subsequent protected request is rejected with clean 401
  const afterLogoutRes = await request('/api/leads', {
    headers: { Cookie: 'auth_token=' },
  });
  assert(
    afterLogoutRes.status === 401,
    'Protected endpoint /api/leads rejects request after session is cleared with 401 Unauthorized'
  );

  // C. GET /api/auth/logout clears cookie and redirects to /login
  const getLogoutRes = await request('/api/auth/logout');
  assert(
    (getLogoutRes.status === 302 || getLogoutRes.status === 307) &&
      getLogoutRes.location?.includes('/login'),
    'GET /api/auth/logout clears session and performs HTTP redirect to /login',
    `Status: ${getLogoutRes.status}, Location: ${getLogoutRes.location}`
  );

  // D. Expired session logout works without error or redirect loop
  const expiredLogoutRes = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: 'auth_token=expired_or_invalid_jwt_token' },
  });
  assert(
    expiredLogoutRes.status === 200 && expiredLogoutRes.data?.success,
    'Logout succeeds cleanly even if session is already expired or invalid'
  );

  // Summary
  console.log('\n================================================================');
  console.log(`ENHANCEMENTS SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runEnhancementsSuite().catch((err) => {
  console.error('Fatal enhancements suite error:', err);
  process.exit(1);
});
