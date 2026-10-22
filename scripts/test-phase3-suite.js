/**
 * Phase 3 Comprehensive Test Suite
 * Automated verification of Dynamic Form Builder, APIs, Public Lead Capture,
 * Multi-tenant Isolation, Field Validations, and Security Controls.
 */

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, headers: res.headers, data, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runPhase3Tests() {
  console.log('================================================================');
  console.log('         COMPANY LEAD TRACKER — PHASE 3 TEST SUITE              ');
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

  // --- Step 0: Authenticate Super Admin and Provision Isolated Test Tenants ---
  console.log('[Setup] Authenticating Super Admin...');
  const loginAdmin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@companytracker.test', password: 'SuperAdminTest123!' },
  });

  if (loginAdmin.status !== 200 || !loginAdmin.data.success) {
    console.error('Super Admin login failed. Cannot proceed with tests:', loginAdmin.data);
    process.exit(1);
  }

  const superAdminCookie = `auth_token=${extractCookie(loginAdmin.setCookie)}`;

  // Create two distinct test companies
  console.log('[Setup] Provisioning Tenant Alpha and Tenant Beta...');
  const compAlphaRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      companyName: `Tenant Alpha ${Date.now()}`,
      status: 'approved',
      adminName: 'Alpha Admin',
      adminEmail: `alpha_${Date.now()}@test.local`,
      adminPassword: 'PasswordAlpha123!',
    },
  });

  const compBetaRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      companyName: `Tenant Beta ${Date.now()}`,
      status: 'approved',
      adminName: 'Beta Admin',
      adminEmail: `beta_${Date.now()}@test.local`,
      adminPassword: 'PasswordBeta123!',
    },
  });

  const alphaCompany = compAlphaRes.data?.company;
  const alphaAdmin = compAlphaRes.data?.admin;
  const betaCompany = compBetaRes.data?.company;
  const betaAdmin = compBetaRes.data?.admin;

  if (!alphaCompany?.id || !betaCompany?.id) {
    console.error('Failed to provision test companies:', { compAlphaRes: compAlphaRes.data, compBetaRes: compBetaRes.data });
    process.exit(1);
  }

  // Login as Alpha Admin
  const loginAlpha = await request('/api/auth/login', {
    method: 'POST',
    body: { email: alphaAdmin.email, password: 'PasswordAlpha123!' },
  });
  const alphaCookie = `auth_token=${extractCookie(loginAlpha.setCookie)}`;

  // Login as Beta Admin
  const loginBeta = await request('/api/auth/login', {
    method: 'POST',
    body: { email: betaAdmin.email, password: 'PasswordBeta123!' },
  });
  const betaCookie = `auth_token=${extractCookie(loginBeta.setCookie)}`;

  console.log('[Setup] Test tenants ready. Executing test assertions...\n');

  // --- Scenarios 1-10: Form Management APIs ---

  // 1. Unauthenticated requests to private form APIs return 401
  const t1 = await request('/api/forms');
  assert(t1.status === 401 && t1.data?.success === false, 'Test 1: Unauthenticated GET /api/forms returns 401');

  // 2. Company Admin can create a valid draft form
  const validDraftPayload = {
    name: 'Alpha Contact Form',
    description: 'General inquiry capture',
    fields: [
      {
        id: 'fld_name',
        type: 'text',
        label: 'Full Name',
        name: 'full_name',
        required: true,
        placeholder: 'John Doe',
        order: 0,
      },
      {
        id: 'fld_email',
        type: 'email',
        label: 'Email Address',
        name: 'work_email',
        required: true,
        placeholder: 'john@example.com',
        order: 1,
      },
      {
        id: 'fld_service',
        type: 'dropdown',
        label: 'Interested Service',
        name: 'service',
        required: false,
        options: ['Consulting', 'Implementation', 'Enterprise Support'],
        order: 2,
      },
    ],
  };

  const t2 = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: alphaCookie },
    body: validDraftPayload,
  });
  assert(
    t2.status === 201 &&
    t2.data?.success === true &&
    t2.data?.data?.status === 'draft' &&
    !!t2.data?.data?.publicId,
    'Test 2: Company Admin creates valid draft form with crypto publicId',
    JSON.stringify(t2.data)
  );
  const alphaForm = t2.data?.data;

  // 3. Invalid field types are rejected
  const t3 = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: alphaCookie },
    body: {
      name: 'Bad Field Type Form',
      fields: [
        {
          id: 'fld_bad',
          type: 'unsupported_type_xyz',
          label: 'Unsupported',
          name: 'unsupported',
        },
      ],
    },
  });
  assert(t3.status === 400 && t3.data?.success === false, 'Test 3: Unsupported field types rejected with 400');

  // 4. Duplicate field identifiers or submission keys are rejected
  const t4 = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: alphaCookie },
    body: {
      name: 'Duplicate Keys Form',
      fields: [
        { id: 'fld_1', type: 'text', label: 'Field 1', name: 'contact_info' },
        { id: 'fld_2', type: 'text', label: 'Field 2', name: 'contact_info' }, // Duplicate name
      ],
    },
  });
  assert(t4.status === 400 && t4.data?.success === false, 'Test 4: Duplicate submission keys rejected with 400');

  // 5. Invalid dropdown options are rejected
  const t5 = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: alphaCookie },
    body: {
      name: 'Bad Dropdown Form',
      fields: [
        {
          id: 'fld_drop',
          type: 'dropdown',
          label: 'Choose Option',
          name: 'choice',
          options: ['Option 1', 'Option 1'], // Duplicate option
        },
      ],
    },
  });
  assert(t5.status === 400 && t5.data?.success === false, 'Test 5: Duplicate dropdown options rejected with 400');

  // 6. Company Admin cannot create or modify forms belonging to another company
  const t6 = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: betaCookie },
    body: {
      name: 'Attempted Spoof Form',
      companyId: alphaCompany.id, // Client tries to supply Alpha companyId
      fields: [{ id: 'fld_1', type: 'text', label: 'Name', name: 'client_name' }],
    },
  });
  // Server must bind to authenticated user's company (Beta), ignoring client-supplied companyId
  assert(
    t6.status === 201 && t6.data?.data?.companyId === betaCompany.id,
    'Test 6: Tenant isolation enforces server-side company binding (spoofed companyId ignored)'
  );

  // 7. Company Admin cannot retrieve another company's private form
  const t7 = await request(`/api/forms/${alphaForm?._id}`, {
    headers: { Cookie: betaCookie },
  });
  assert(t7.status === 404 && t7.data?.success === false, 'Test 7: Tenant isolation returns 404 when querying foreign tenant form');

  // 8. Unauthorized users cannot publish or unpublish forms
  const t8 = await request(`/api/forms/${alphaForm?._id}`, {
    method: 'PATCH',
    headers: { Cookie: betaCookie }, // Beta tries to alter Alpha's form
    body: { status: 'published' },
  });
  assert(t8.status === 404, 'Test 8: Cross-tenant publish mutation rejected with 404');

  // 9. Invalid forms cannot be published (e.g. 0 fields)
  const emptyFormRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: alphaCookie },
    body: { name: 'Empty Form', fields: [] },
  });
  const emptyFormId = emptyFormRes.data?.data?._id;

  const t9 = await request(`/api/forms/${emptyFormId}`, {
    method: 'PATCH',
    headers: { Cookie: alphaCookie },
    body: { status: 'published' },
  });
  assert(t9.status === 400 && t9.data?.success === false, 'Test 9: Publishing form with 0 fields rejected with 400');

  // 10. Super Admin can access forms across companies
  const t10 = await request('/api/forms', {
    headers: { Cookie: superAdminCookie },
  });
  assert(
    t10.status === 200 && t10.data?.success === true && Array.isArray(t10.data?.data),
    'Test 10: Super Admin retrieves forms cross-tenant via authorized route'
  );

  // Publish alphaForm for public tests
  console.log('\n[Setup] Publishing Alpha Form for public submission tests...');
  const pubRes = await request(`/api/forms/${alphaForm?._id}`, {
    method: 'PATCH',
    headers: { Cookie: alphaCookie },
    body: { status: 'published' },
  });
  assert(pubRes.status === 200 && pubRes.data?.data?.status === 'published', '[Setup] Alpha form published successfully');

  // --- Scenarios 11-23: Public Form APIs & Lead Capture ---

  // 11. Published forms can be retrieved without authentication
  const t11 = await request(`/api/public/forms/${alphaForm?.publicId}`);
  assert(
    t11.status === 200 &&
    t11.data?.success === true &&
    t11.data?.data?.name === 'Alpha Contact Form' &&
    !t11.data?.data?.createdBy && // No internal user references
    Array.isArray(t11.data?.data?.fields),
    'Test 11: Unauthenticated retrieval of published form metadata succeeds'
  );

  // 12. Draft and unpublished forms are not publicly accessible
  const t12 = await request(`/api/public/forms/${emptyFormRes.data?.data?.publicId}`);
  assert(t12.status === 404 && t12.data?.success === false, 'Test 12: Draft form public endpoint returns 404');

  // 13. Invalid public identifiers return safe error
  const t13 = await request('/api/public/forms/nonexistent_token_123');
  assert(t13.status === 404 && t13.data?.success === false, 'Test 13: Nonexistent publicId returns safe 404');

  // 14 & 15. Valid submissions create leads with correct companyId, formId, and status New
  const validSubmission = {
    values: {
      full_name: 'Alice Prospect',
      work_email: 'alice@enterprise.com',
      service: 'Consulting',
    },
  };
  const t14 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: validSubmission,
  });

  // Verify lead was persisted to database with correct tenant isolation and status 'New'
  const alphaLeadsRes = await request('/api/leads', {
    headers: { Cookie: alphaCookie },
  });
  const aliceLead = (alphaLeadsRes.data?.data || []).find((l) => l.email === 'alice@enterprise.com');

  assert(
    t14.status === 201 &&
    t14.data?.success === true &&
    !!aliceLead &&
    aliceLead.status === 'New' &&
    aliceLead.companyId === alphaCompany.id &&
    aliceLead.formId === alphaForm?._id &&
    aliceLead.source === 'public_form',
    'Test 14 & 15: Valid public submission creates Lead associated with company, form, and status "New"'
  );

  // 16. Missing required fields are rejected
  const t16 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        // full_name is required but omitted
        work_email: 'missing_name@example.com',
      },
    },
  });
  assert(t16.status === 400 && t16.data?.success === false, 'Test 16: Missing required field rejected with 400');

  // 17. Invalid email values are rejected
  const t17 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        full_name: 'Bob Smith',
        work_email: 'not-an-email',
      },
    },
  });
  assert(t17.status === 400 && t17.data?.success === false, 'Test 17: Malformed email rejected with 400');

  // 18. Invalid dropdown options are rejected
  const t18 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        full_name: 'Charlie Brown',
        work_email: 'charlie@peanuts.com',
        service: 'Unsupported Arbitrary Service',
      },
    },
  });
  assert(t18.status === 400 && t18.data?.success === false, 'Test 18: Unlisted dropdown option rejected with 400');

  // 19. Unknown submission fields are rejected
  const t19 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        full_name: 'David Miller',
        work_email: 'david@test.com',
        hacker_field: 'malicious_input',
      },
    },
  });
  assert(t19.status === 400 && t19.data?.success === false, 'Test 19: Unknown unconfigured fields rejected with 400');

  // 20. Client-supplied company/form IDs cannot redirect a lead to another tenant
  const t20 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      companyId: betaCompany.id, // Attacker tries to inject foreign companyId
      formId: betaCompany.id,
      values: {
        full_name: 'Eve Mallor',
        work_email: 'eve@spoof.com',
      },
    },
  });

  // Verify lead is strictly scoped to Alpha, not Beta
  const betaLeadsRes = await request('/api/leads', {
    headers: { Cookie: betaCookie },
  });
  const eveInBeta = (betaLeadsRes.data?.data || []).find((l) => l.email === 'eve@spoof.com');
  const alphaLeadsRes2 = await request('/api/leads', {
    headers: { Cookie: alphaCookie },
  });
  const eveInAlpha = (alphaLeadsRes2.data?.data || []).find((l) => l.email === 'eve@spoof.com');

  assert(
    t20.status === 201 &&
    !eveInBeta &&
    !!eveInAlpha &&
    eveInAlpha.companyId === alphaCompany.id,
    'Test 20: Client cannot redirect lead tenant by injecting companyId or formId'
  );

  // 21. Blocked or pending companies cannot accept submissions
  console.log('[Setup] Provisioning a blocked company to verify submission lockdown...');
  const compBlockedRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      companyName: `Blocked Tenant ${Date.now()}`,
      status: 'blocked',
      adminName: 'Blocked Admin',
      adminEmail: `blocked_${Date.now()}@test.local`,
      adminPassword: 'PasswordBlocked123!',
    },
  });
  const blockedCompany = compBlockedRes.data?.company;

  const blockedFormRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      name: 'Blocked Form',
      companyId: blockedCompany.id,
      status: 'published',
      fields: [{ id: 'fld_b', type: 'text', label: 'Name', name: 'name', required: true }],
    },
  });
  const blockedPublicId = blockedFormRes.data?.data?.publicId;

  const t21 = await request(`/api/public/forms/${blockedPublicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        name: 'Frank Blocked',
      },
    },
  });
  assert(
    (t21.status === 404 || t21.status === 403) && t21.data?.success === false,
    'Test 21: Submissions to blocked/inactive company forms are strictly rejected with 404/403'
  );

  // 22. Excessively large payloads are rejected
  const hugePayload = 'X'.repeat(5000);
  const t22 = await request(`/api/public/forms/${alphaForm?.publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        full_name: hugePayload,
        work_email: 'test@large.com',
      },
    },
  });
  assert(t22.status === 400 && t22.data?.success === false, 'Test 22: Oversized field submission rejected with 400');

  // 23. Successful submissions do not expose private lead or company information
  assert(
    t14.status === 201 &&
    t14.data?.success === true &&
    !t14.data?.data &&
    !t14.data?.lead &&
    !t14.data?.companyId,
    'Test 23: Public response returns safe confirmation without leaking private metadata'
  );

  // Summary
  console.log('\n================================================================');
  console.log(`TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
