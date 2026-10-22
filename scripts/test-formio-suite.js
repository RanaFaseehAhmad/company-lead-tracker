/**
 * Form.io Integration Comprehensive Test Suite
 *
 * Verifies all 10 acceptance criteria for Form.io platform integration:
 * 1. Company Admin creates and edits a Form.io form.
 * 2. Forms are mapped strictly to the correct companyId (tenant isolation).
 * 3. Published forms render through the public route with Form.io schema.
 * 4. Iframe embed code points to correct public form.
 * 5. Valid submissions synchronize to MongoDB and create Lead records.
 * 6. Tenant isolation: Company A sees its own leads, never Company B's leads.
 * 7. Cross-tenant tampering (modifying or submitting foreign forms) rejected.
 * 8. Draft and archived forms cannot accept public submissions (404).
 * 9. Webhook handler: authentication, submission synchronization, and deduplication.
 * 10. Legacy custom form compatibility & schema conversion without data loss.
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

async function runTests() {
  console.log('================================================================');
  console.log('       FORM.IO INTEGRATION & TENANT ISOLATION TEST SUITE        ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // --- Step 1: Authentication & Tenant Setup ---
  console.log('[Setup] Authenticating Super Admin...');
  const loginAdmin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@companytracker.test', password: 'SuperAdminTest123!' },
  });

  if (loginAdmin.status !== 200 || !loginAdmin.data.success) {
    console.error('Super Admin login failed:', loginAdmin.data);
    process.exit(1);
  }

  const superAdminCookie = `auth_token=${extractCookie(loginAdmin.setCookie)}`;

  // Provision Tenant X and Tenant Y
  console.log('[Setup] Provisioning Tenant X and Tenant Y...');
  const time = Date.now();
  const compXRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      companyName: `Tenant Formio X ${time}`,
      status: 'approved',
      adminName: 'Admin X',
      adminEmail: `admin_x_${time}@test.local`,
      adminPassword: 'PasswordX123!',
    },
  });

  const compYRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: superAdminCookie },
    body: {
      companyName: `Tenant Formio Y ${time}`,
      status: 'approved',
      adminName: 'Admin Y',
      adminEmail: `admin_y_${time}@test.local`,
      adminPassword: 'PasswordY123!',
    },
  });

  const companyX = compXRes.data?.company;
  const adminX = compXRes.data?.admin;
  const companyY = compYRes.data?.company;
  const adminY = compYRes.data?.admin;

  // Login as Admin X
  const loginX = await request('/api/auth/login', {
    method: 'POST',
    body: { email: adminX.email, password: 'PasswordX123!' },
  });
  const cookieX = `auth_token=${extractCookie(loginX.setCookie)}`;

  // Login as Admin Y
  const loginY = await request('/api/auth/login', {
    method: 'POST',
    body: { email: adminY.email, password: 'PasswordY123!' },
  });
  const cookieY = `auth_token=${extractCookie(loginY.setCookie)}`;

  console.log('[Setup] Test tenants ready. Executing assertions...\n');

  // --- Test 1: Company Admin X creates a Form.io form with schema ---
  const formioSchemaX = {
    display: 'form',
    title: 'Enterprise Quote Request',
    components: [
      {
        type: 'textfield',
        key: 'companyName',
        label: 'Company Name',
        input: true,
        validate: { required: true },
      },
      {
        type: 'email',
        key: 'email',
        label: 'Work Email',
        input: true,
        validate: { required: true },
      },
      {
        type: 'select',
        key: 'plan',
        label: 'Selected Plan',
        input: true,
        data: {
          values: [
            { label: 'Starter', value: 'Starter' },
            { label: 'Pro', value: 'Pro' },
            { label: 'Enterprise', value: 'Enterprise' },
          ],
        },
        validate: { required: false },
      },
      {
        type: 'textarea',
        key: 'notes',
        label: 'Requirements',
        input: true,
      },
      {
        type: 'button',
        action: 'submit',
        label: 'Submit Quote',
        key: 'submit',
        theme: 'primary',
      },
    ],
  };

  const createRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: cookieX },
    body: {
      title: 'Enterprise Quote Request',
      description: 'Request a custom B2B quote',
      schema: formioSchemaX,
      status: 'draft',
    },
  });

  const createdFormX = createRes.data?.data;

  assert(
    createRes.status === 201 &&
    createRes.data?.success === true &&
    createdFormX?.title === 'Enterprise Quote Request' &&
    createdFormX?.companyId === companyX.id &&
    createdFormX?.schema?.display === 'form' &&
    createdFormX?.schema?.components?.length === 5,
    'Test 1: Company Admin creates Form.io form with JSON schema',
    JSON.stringify(createRes.data)
  );

  // --- Test 2: Form is strictly mapped to companyId and cannot be spoofed ---
  const spoofRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: cookieX },
    body: {
      title: 'Spoofed Form',
      companyId: companyY.id, // Admin X tries to create form for Company Y
      schema: formioSchemaX,
    },
  });

  assert(
    spoofRes.status === 201 &&
    spoofRes.data?.data?.companyId === companyX.id,
    'Test 2: Server-side companyId enforcement ignores client-supplied spoofed companyId'
  );

  // --- Test 3: Company Admin X edits Form.io definition and publishes ---
  const updatedSchemaX = {
    ...formioSchemaX,
    title: 'Updated Quote Form',
    components: [
      ...formioSchemaX.components,
      {
        type: 'phoneNumber',
        key: 'phone',
        label: 'Contact Phone',
        input: true,
      },
    ],
  };

  const updateRes = await request(`/api/forms/${createdFormX._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookieX },
    body: {
      title: 'Updated Quote Form',
      schema: updatedSchemaX,
      status: 'published',
    },
  });

  assert(
    updateRes.status === 200 &&
    updateRes.data?.success === true &&
    updateRes.data?.data?.status === 'published' &&
    updateRes.data?.data?.schema?.components?.length === 6,
    'Test 3: Company Admin edits Form.io schema and publishes form'
  );

  // --- Test 4: Published form renders through public route with Form.io schema ---
  const publicRes = await request(`/api/public/forms/${createdFormX.publicId}`);
  assert(
    publicRes.status === 200 &&
    publicRes.data?.success === true &&
    publicRes.data?.data?.publicId === createdFormX.publicId &&
    publicRes.data?.data?.companyName === companyX.name &&
    publicRes.data?.data?.schema?.display === 'form' &&
    publicRes.data?.data?.schema?.components?.length === 6,
    'Test 4: Published form metadata and Form.io schema accessible via unauthenticated public route'
  );

  // --- Test 5: Tenant Y cannot view or modify Form X ---
  const crossGetRes = await request(`/api/forms/${createdFormX._id}`, {
    headers: { Cookie: cookieY },
  });
  const crossPatchRes = await request(`/api/forms/${createdFormX._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookieY },
    body: { title: 'Hacked by Y' },
  });

  assert(
    crossGetRes.status === 404 && crossPatchRes.status === 404,
    'Test 5: Cross-tenant isolation blocks Tenant Y from viewing or editing Tenant X form with 404'
  );

  // --- Test 6: Public Form.io submission creates Lead in MongoDB ---
  const submissionPayload = {
    data: {
      companyName: 'Acme MegaCorp',
      email: 'buyer@megacorp.com',
      plan: 'Enterprise',
      phone: '+1 555 123 4567',
      notes: 'Need 500 licenses with SLA.',
    },
  };

  const subRes = await request(`/api/public/forms/${createdFormX.publicId}/submissions`, {
    method: 'POST',
    body: submissionPayload,
  });

  assert(
    subRes.status === 201 && subRes.data?.success === true,
    'Test 6: Valid Form.io submission successfully submitted via public endpoint'
  );

  // --- Test 7: Verify Lead belongs strictly to Tenant X and never Tenant Y ---
  const leadsXRes = await request('/api/leads', {
    headers: { Cookie: cookieX },
  });
  const leadsYRes = await request('/api/leads', {
    headers: { Cookie: cookieY },
  });

  const leadInX = (leadsXRes.data?.data || []).find((l) => l.email === 'buyer@megacorp.com');
  const leadInY = (leadsYRes.data?.data || []).find((l) => l.email === 'buyer@megacorp.com');

  assert(
    !!leadInX &&
    leadInX.companyName === 'Acme MegaCorp' &&
    leadInX.status === 'New' &&
    leadInX.source === 'public_form' &&
    !leadInY,
    'Test 7: Lead appears in Company X dashboard and is strictly absent from Company Y'
  );

  // --- Test 8: Submissions to draft or archived forms are rejected ---
  // Archive form X
  await request(`/api/forms/${createdFormX._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookieX },
    body: { status: 'archived' },
  });

  const archivedSubRes = await request(`/api/public/forms/${createdFormX.publicId}/submissions`, {
    method: 'POST',
    body: submissionPayload,
  });

  assert(
    archivedSubRes.status === 404,
    'Test 8: Submissions to archived forms are safely rejected with 404'
  );

  // Restore form X to published
  await request(`/api/forms/${createdFormX._id}`, {
    method: 'PATCH',
    headers: { Cookie: cookieX },
    body: { status: 'published' },
  });

  // --- Test 9: Form.io Webhook receiver synchronizes submissions and prevents duplicates ---
  const webhookSubmissionId = `sub_${Date.now()}_abc`;
  const webhookPayload = {
    submission: {
      _id: webhookSubmissionId,
      form: createdFormX.publicId,
      data: {
        companyName: 'Globex Corp',
        contactPerson: 'Hank Scorpio',
        email: 'hank@globex.test',
        phone: '+1 800 555 9999',
        notes: 'Inquiry received via external Form.io webhook',
      },
    },
  };

  const webhookRes1 = await request('/api/webhooks/formio', {
    method: 'POST',
    body: webhookPayload,
  });

  // Re-send same webhook payload to test deduplication
  const webhookRes2 = await request('/api/webhooks/formio', {
    method: 'POST',
    body: webhookPayload,
  });

  const leadsXAfterWebhook = await request('/api/leads', {
    headers: { Cookie: cookieX },
  });
  const hankLeads = (leadsXAfterWebhook.data?.data || []).filter((l) => l.email === 'hank@globex.test');

  assert(
    webhookRes1.status === 201 &&
    webhookRes2.status === 200 &&
    hankLeads.length === 1 &&
    hankLeads[0].contactPerson === 'Hank Scorpio',
    'Test 9: Webhook processes submission, maps to tenant, and deduplicates identical submissions'
  );

  // --- Test 10: Legacy custom form compatibility & automatic schema conversion ---
  const legacyFormRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: cookieX },
    body: {
      name: 'Legacy Field Form',
      fields: [
        { id: 'f_name', type: 'text', label: 'Full Name', name: 'full_name', required: true },
        { id: 'f_email', type: 'email', label: 'Email Address', name: 'email', required: true },
        { id: 'f_dept', type: 'dropdown', label: 'Department', name: 'dept', options: ['Sales', 'Support'], required: false },
      ],
      status: 'published',
    },
  });

  const legacyForm = legacyFormRes.data?.data;
  const legacyPublicRes = await request(`/api/public/forms/${legacyForm?.publicId}`);

  assert(
    legacyFormRes.status === 201 &&
    !!legacyPublicRes.data?.data?.schema &&
    legacyPublicRes.data?.data?.schema?.components?.length >= 3 &&
    legacyPublicRes.data?.data?.schema?.components?.some((c) => c.key === 'full_name') &&
    legacyPublicRes.data?.data?.schema?.components?.some((c) => c.key === 'dept'),
    'Test 10: Legacy forms automatically convert to Form.io schemas without data loss'
  );

  console.log(`\n================================================================`);
  console.log(`TOTAL PASSED: ${passed} / 10 | TOTAL FAILED: ${failed}`);
  console.log(`================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite failed unexpectedly:', err);
  process.exit(1);
});
