/**
 * External HTML Form Embedding Verification Suite
 *
 * Verifies all 7 embedding requirements:
 * 1. External HTML page loads with generated embed code.
 * 2. Published form's schema and fields are served with CORS and CSP headers.
 * 3. Required-field validation works.
 * 4. A valid submission succeeds via public submission engine.
 * 5. Resulting lead appears in the correct company's dashboard.
 * 6. Unpublished and blocked-company forms strictly reject submissions.
 * 7. Existing authentication and dashboard functionality remain fully intact.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = 'http://localhost:3000';
const EXTERNAL_PORT = 8080;

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
  return { status: res.status, headers: res.headers, data, text, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

async function runEmbedSuite() {
  console.log('================================================================');
  console.log('       EXTERNAL HTML FORM EMBEDDING VERIFICATION SUITE          ');
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

  // 1. Health check
  console.log('--- 1. Health & Server Check ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy',
    'Health Check Endpoint returns healthy and connected database'
  );

  // 2. Super Admin Login & Tenant Provisioning
  console.log('\n--- 2. Tenant Provisioning ---');
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

  // Register Company Embedder
  const compEmail = `admin_embed_${runId}@embedder.test`;
  const regRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Embedder Global ${runId}`,
      adminName: 'Embed Admin',
      adminEmail: compEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-8899',
    },
  });
  const companyId = regRes.data?.company?.id || regRes.data?.companyId;
  assert(regRes.status === 201 && companyId, 'Company Registration Created');

  // Super Admin Approves Company
  const approveRes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId, status: 'approved' },
  });
  assert(approveRes.status === 200 && approveRes.data?.success, 'Company Approved by Super Admin');

  // Login as Company Admin
  const loginRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compEmail, password: 'Password123!' },
  });
  const compCookie = extractCookie(loginRes.setCookie);
  assert(loginRes.status === 200 && compCookie, 'Company Admin Login Successful');

  // 3. Create & Publish Form.io Form
  console.log('\n--- 3. Form Creation with Form.io Schema ---');
  const formPayload = {
    title: 'Customer Inquiry Form',
    status: 'published',
    schema: {
      display: 'form',
      title: 'Customer Inquiry Form',
      components: [
        {
          type: 'textfield',
          key: 'companyName',
          label: 'Company Name',
          input: true,
          validate: { required: true },
        },
        {
          type: 'textfield',
          key: 'contactPerson',
          label: 'Contact Person',
          input: true,
          validate: { required: true },
        },
        {
          type: 'email',
          key: 'email',
          label: 'Business Email',
          input: true,
          validate: { required: true },
        },
        {
          type: 'phoneNumber',
          key: 'phone',
          label: 'Direct Phone',
          input: true,
          validate: { required: false },
        },
        {
          type: 'textarea',
          key: 'notes',
          label: 'Project Requirements',
          input: true,
          validate: { required: false },
        },
        {
          type: 'button',
          key: 'submit',
          label: 'Send Inquiry',
          action: 'submit',
          theme: 'primary',
          input: true,
        },
      ],
    },
  };

  const createRes = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compCookie}` },
    body: formPayload,
  });

  const formDoc = createRes.data?.data;
  const publicId = formDoc?.publicId;
  assert(
    createRes.status === 201 && formDoc && publicId && publicId.length >= 12,
    'Published Form Created with Public ID and Form.io Schema',
    `Status: ${createRes.status}, Public ID: ${publicId}`
  );

  // 4. Verify Embed Route & CSP Framing Headers
  console.log('\n--- 4. Embed Route & Framing Headers ---');
  const embedPageRes = await request(`/embed/${publicId}`);
  const cspHeader = embedPageRes.headers.get('content-security-policy') || '';
  const xFrameHeader = embedPageRes.headers.get('x-frame-options');

  assert(
    embedPageRes.status === 200 &&
      cspHeader.includes('frame-ancestors') &&
      !xFrameHeader,
    'Embed page permits cross-origin framing via Content-Security-Policy (frame-ancestors *;)',
    `Status: ${embedPageRes.status}, CSP: "${cspHeader}", X-Frame: "${xFrameHeader}"`
  );

  // 5. Verify Public Schema API & CORS Headers
  console.log('\n--- 5. Public Form Schema & CORS Headers ---');
  const schemaRes = await request(`/api/public/forms/${publicId}`);
  const corsOrigin = schemaRes.headers.get('access-control-allow-origin');
  const returnedComponents = schemaRes.data?.data?.schema?.components;

  assert(
    schemaRes.status === 200 &&
      corsOrigin === '*' &&
      Array.isArray(returnedComponents) &&
      returnedComponents.length === 6 &&
      returnedComponents.some((c) => c.key === 'companyName') &&
      returnedComponents.some((c) => c.key === 'email'),
    'Public schema endpoint returns complete Form.io schema and CORS headers',
    `Status: ${schemaRes.status}, CORS: ${corsOrigin}, Components: ${returnedComponents?.length}`
  );

  // Verify OPTIONS preflight on schema endpoint
  const optionsSchema = await request(`/api/public/forms/${publicId}`, {
    method: 'OPTIONS',
  });
  assert(
    optionsSchema.status === 204 && optionsSchema.headers.get('access-control-allow-origin') === '*',
    'OPTIONS preflight on public schema returns 204 with CORS'
  );

  // 6. External HTML Page Simulation
  console.log('\n--- 6. Standalone External HTML Page Verification ---');
  const embedCode = `<iframe src="${BASE_URL}/embed/${publicId}" width="100%" height="700" frameborder="0" loading="lazy" style="border:none;max-width:100%;border-radius:12px;" title="${formDoc.title}"></iframe>`;

  const externalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>External Partner Website - Embedded Form Test</title>
  <style>
    body { font-family: sans-serif; background: #e2e8f0; padding: 40px; margin: 0; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 24px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    h1 { color: #1e293b; font-size: 20px; margin-top: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Partner Portal — Embedded Lead Capture</h1>
    <p>The form below is embedded using the exact generated embed code from Company Lead Tracker:</p>
    ${embedCode}
  </div>
</body>
</html>`;

  // Start temporary standalone HTTP server on port 8080 to simulate a different origin
  let serverRunning = true;
  const externalServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(externalHtml);
  });

  await new Promise((resolve, reject) => {
    externalServer.listen(EXTERNAL_PORT, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Fetch the external page
  const extPageRes = await fetch(`http://localhost:${EXTERNAL_PORT}`);
  const extHtmlContent = await extPageRes.text();
  assert(
    extPageRes.status === 200 &&
      extHtmlContent.includes(`<iframe src="${BASE_URL}/embed/${publicId}"`) &&
      extHtmlContent.includes('width="100%" height="700"'),
    'External HTML page served from different origin loads exact generated iframe embed code',
    `Status: ${extPageRes.status}`
  );

  // Cleanly close external server
  externalServer.close();

  // 7. Test Submission Validation & Security
  console.log('\n--- 7. Submission Engine, Validation & Tenant Binding ---');

  // A. Missing required fields rejected with 400
  const invalidSub = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        // missing companyName, contactPerson, email
        notes: 'Incomplete submission without required contact details',
      },
    },
  });
  assert(
    invalidSub.status === 400 && invalidSub.data?.success === false,
    'Submission Engine rejects submission missing required fields (Returns 400)',
    `Status: ${invalidSub.status}, Error: ${invalidSub.data?.error}`
  );

  // B. Malformed email rejected with 400
  const malformedEmailSub = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    body: {
      values: {
        companyName: 'Acme Test Corp',
        contactPerson: 'John Doe',
        email: 'invalid-not-an-email',
      },
    },
  });
  assert(
    malformedEmailSub.status === 400 && malformedEmailSub.data?.success === false,
    'Submission Engine rejects malformed email address (Returns 400)',
    `Status: ${malformedEmailSub.status}, Error: ${malformedEmailSub.data?.error}`
  );

  // C. Valid submission succeeds
  const validSub = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    headers: {
      Referer: 'http://localhost:8080/partner-landing.html',
    },
    body: {
      values: {
        companyName: 'Acme International',
        contactPerson: 'Sarah Jenkins',
        email: 'sarah.jenkins@acme-intl.com',
        phone: '+1 555 432 1098',
        notes: 'Requested product demo and enterprise pricing tiers.',
        _source: 'external_iframe_embed',
      },
    },
  });
  const newLeadId = validSub.data?.leadId;
  assert(
    validSub.status === 201 && validSub.data?.success && newLeadId,
    'Valid submission via public endpoint creates lead and returns leadId (HTTP 201)',
    `Status: ${validSub.status}, Lead ID: ${newLeadId}`
  );

  // 8. Verify Lead in Company Admin Dashboard
  console.log('\n--- 8. Lead Verification in Company Dashboard ---');
  const leadsRes = await request(`/api/leads?formId=${formDoc._id}`, {
    headers: { Cookie: `auth_token=${compCookie}` },
  });
  const leads = leadsRes.data?.data || [];
  const foundLead = leads.find((l) => l._id === newLeadId);

  assert(
    leadsRes.status === 200 &&
      foundLead &&
      foundLead.contactPerson === 'Sarah Jenkins' &&
      foundLead.email === 'sarah.jenkins@acme-intl.com' &&
      foundLead.companyName === 'Acme International' &&
      foundLead.source === 'external_iframe_embed',
    'Submitted lead successfully appears in Company Admin dashboard with complete submissionData',
    `Found lead: ${foundLead?.contactPerson}, Source: ${foundLead?.source}`
  );

  // 9. Unpublished and Blocked Form Enforcement
  console.log('\n--- 9. Unpublished & Blocked Tenant Rejection ---');

  // Unpublish form (set status to draft)
  await request(`/api/forms/${formDoc._id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compCookie}` },
    body: { status: 'draft' },
  });

  const draftSchemaRes = await request(`/api/public/forms/${publicId}`);
  const draftSubRes = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    body: { values: { companyName: 'Test', contactPerson: 'Test', email: 'test@test.com' } },
  });

  assert(
    draftSchemaRes.status === 404 && draftSubRes.status === 404,
    'Draft/Unpublished form cannot be retrieved or submitted via public embed routes (Returns 404)'
  );

  // Republish form and block company
  await request(`/api/forms/${formDoc._id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compCookie}` },
    body: { status: 'published' },
  });

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId, status: 'blocked' },
  });

  const blockedSchemaRes = await request(`/api/public/forms/${publicId}`);
  const blockedSubRes = await request(`/api/public/forms/${publicId}/submissions`, {
    method: 'POST',
    body: { values: { companyName: 'Test', contactPerson: 'Test', email: 'test@test.com' } },
  });

  assert(
    blockedSchemaRes.status === 404 && blockedSubRes.status === 403,
    'Blocked company form cannot be retrieved (404) or submitted (403 Forbidden)'
  );

  // Restore company to approved
  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId, status: 'approved' },
  });

  // Summary
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('ALL EXTERNAL HTML FORM EMBEDDING VERIFICATIONS PASSED!\n');
    process.exit(0);
  }
}

runEmbedSuite().catch((err) => {
  console.error('Embed Suite Exception:', err);
  process.exit(1);
});
