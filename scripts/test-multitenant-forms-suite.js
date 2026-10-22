/**
 * Multi-Tenant Lead Forms End-to-End Verification Suite
 *
 * Verifies strict tenant isolation across the full form lifecycle:
 * 1. Health check & Super Admin authentication.
 * 2. Independent provisioning & approval of Company A and Company B.
 * 3. Form creation with Form.io schema (including nested layout components).
 * 4. Multi-tenant visibility: Company A sees only Form A, Company B sees only Form B.
 * 5. Full lifecycle actions: Edit, Preview, Publish, Unpublish, Archive, Restore, Analytics.
 * 6. Cross-tenant authorization attacks (direct ID tampering on GET, PATCH, and Analytics).
 * 7. Public embed endpoints and iframe code delivery.
 * 8. Public submissions & leads pipeline isolation.
 * 9. Submissions and lead count aggregation consistency.
 * 10. Pre-existing records preservation (verifies existing company's form and leads).
 * 11. Clean-up of test-created records only.
 */

const path = require('node:path');
const fs = require('node:fs');

const BASE_URL = 'http://localhost:3000';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
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

async function runMultiTenantFormsSuite() {
  console.log('================================================================');
  console.log('       MULTI-TENANT FORMS AUDIT & VERIFICATION SUITE            ');
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

  // 1. Health Check
  console.log('--- Phase 1: Health & System Diagnostics ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy',
    'Health Check Endpoint returns healthy with connected database',
    JSON.stringify(healthRes.data)
  );

  // 2. Super Admin Login
  console.log('\n--- Phase 2: Super Admin Authentication ---');
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const saCookie = extractCookie(saLogin.setCookie);
  assert(saLogin.status === 200 && saCookie, 'Super Admin login successful');

  const saHeaders = { Cookie: `auth_token=${saCookie}` };

  // 3. Provision Company A & Company B
  console.log('\n--- Phase 3: Multi-Company Provisioning & Approval ---');
  const compAEmail = `admin_a_${runId}@company-a.test`;
  const regARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Alpha Corp ${runId}`,
      adminName: 'Alice Admin',
      adminEmail: compAEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-1111',
    },
  });
  assert(regARes.status === 201 && regARes.data?.company?.id, 'Company A registered successfully');
  const companyAId = regARes.data?.company?.id;

  const compBEmail = `admin_b_${runId}@company-b.test`;
  const regBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Beta Corp ${runId}`,
      adminName: 'Bob Admin',
      adminEmail: compBEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-2222',
    },
  });
  assert(regBRes.status === 201 && regBRes.data?.company?.id, 'Company B registered successfully');
  const companyBId = regBRes.data?.company?.id;

  // Approve both companies via Super Admin
  const approveARes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: saHeaders,
    body: { companyId: companyAId, status: 'approved' },
  });
  assert(approveARes.status === 200 && approveARes.data?.company?.status === 'approved', 'Company A approved by Super Admin');

  const approveBRes = await request('/api/admin/companies', {
    method: 'PATCH',
    headers: saHeaders,
    body: { companyId: companyBId, status: 'approved' },
  });
  assert(approveBRes.status === 200 && approveBRes.data?.company?.status === 'approved', 'Company B approved by Super Admin');

  // Log in as Company A and Company B
  const loginARes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAEmail, password: 'Password123!' },
  });
  const cookieA = extractCookie(loginARes.setCookie);
  assert(loginARes.status === 200 && cookieA, 'Company A logged in successfully');
  const headersA = { Cookie: `auth_token=${cookieA}` };

  const loginBRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compBEmail, password: 'Password123!' },
  });
  const cookieB = extractCookie(loginBRes.setCookie);
  assert(loginBRes.status === 200 && cookieB, 'Company B logged in successfully');
  const headersB = { Cookie: `auth_token=${cookieB}` };

  // 4. Form Creation with Form.io Engine (Testing nested layouts)
  console.log('\n--- Phase 4: Form Creation with Form.io Engine ---');
  // Form A: Uses nested layout components (columns layout)
  const formAPayload = {
    title: `Alpha Inbound Intake ${runId}`,
    name: `Alpha Inbound Intake ${runId}`,
    description: 'Enterprise intake form for Company A',
    status: 'published',
    schema: {
      display: 'form',
      title: `Alpha Inbound Intake ${runId}`,
      components: [
        {
          type: 'columns',
          key: 'columns_layout',
          input: false,
          columns: [
            {
              components: [
                {
                  label: 'Organization Name',
                  key: 'companyName',
                  type: 'textfield',
                  input: true,
                  validate: { required: true },
                },
              ],
            },
            {
              components: [
                {
                  label: 'Contact Person',
                  key: 'contactPerson',
                  type: 'textfield',
                  input: true,
                  validate: { required: true },
                },
              ],
            },
          ],
        },
        {
          label: 'Business Email',
          key: 'email',
          type: 'email',
          input: true,
          validate: { required: true },
        },
        {
          label: 'Project Details',
          key: 'notes',
          type: 'textarea',
          input: true,
          validate: { required: false },
        },
        {
          type: 'button',
          label: 'Submit Application',
          key: 'submit',
          action: 'submit',
          input: true,
        },
      ],
    },
  };

  const createARes = await request('/api/forms', {
    method: 'POST',
    headers: headersA,
    body: formAPayload,
  });
  assert(
    createARes.status === 201 && createARes.data?.success && createARes.data?.data?._id,
    'Company A successfully created and published Form A (with nested columns layout)',
    createARes.data?.error || createARes.text
  );
  const formA = createARes.data?.data;

  // Form B: Company B creates a different form (draft initially)
  const formBPayload = {
    title: `Beta Inquiry Form ${runId}`,
    name: `Beta Inquiry Form ${runId}`,
    description: 'Customer inquiries for Company B',
    status: 'draft',
    schema: {
      display: 'form',
      title: `Beta Inquiry Form ${runId}`,
      components: [
        {
          label: 'Full Name',
          key: 'contactPerson',
          type: 'textfield',
          input: true,
          validate: { required: true },
        },
        {
          label: 'Email',
          key: 'email',
          type: 'email',
          input: true,
          validate: { required: true },
        },
        {
          label: 'Inquiry Subject',
          key: 'notes',
          type: 'textfield',
          input: true,
          validate: { required: true },
        },
        {
          type: 'button',
          label: 'Send Inquiry',
          key: 'submit',
          action: 'submit',
          input: true,
        },
      ],
    },
  };

  const createBRes = await request('/api/forms', {
    method: 'POST',
    headers: headersB,
    body: formBPayload,
  });
  assert(
    createBRes.status === 201 && createBRes.data?.success && createBRes.data?.data?._id,
    'Company B successfully created Form B (draft)',
    createBRes.data?.error || createBRes.text
  );
  const formB = createBRes.data?.data;

  // 5. Multi-Tenant List Isolation
  console.log('\n--- Phase 5: Multi-Tenant Form Listing Isolation ---');
  const listARes = await request('/api/forms', { headers: headersA });
  assert(listARes.status === 200, 'Company A can retrieve forms list');
  const formsForA = listARes.data?.data || [];
  const aSeesFormA = formsForA.some((f) => f._id === formA._id);
  const aSeesFormB = formsForA.some((f) => f._id === formB._id);
  assert(aSeesFormA && !aSeesFormB, 'Company A sees Form A and CANNOT see Form B');
  assert(formsForA.length === 1, `Company A sees exactly 1 form (found: ${formsForA.length})`);

  const listBRes = await request('/api/forms', { headers: headersB });
  assert(listBRes.status === 200, 'Company B can retrieve forms list');
  const formsForB = listBRes.data?.data || [];
  const bSeesFormB = formsForB.some((f) => f._id === formB._id);
  const bSeesFormA = formsForB.some((f) => f._id === formA._id);
  assert(bSeesFormB && !bSeesFormA, 'Company B sees Form B and CANNOT see Form A');
  assert(formsForB.length === 1, `Company B sees exactly 1 form (found: ${formsForB.length})`);

  // 6. Form Lifecycle Actions for Company A and Company B
  console.log('\n--- Phase 6: Form Lifecycle Actions (Edit, Publish, Preview, Archive, Analytics) ---');
  // Form B Publish toggle
  const publishBRes = await request(`/api/forms/${formB._id}`, {
    method: 'PATCH',
    headers: headersB,
    body: { status: 'published' },
  });
  assert(publishBRes.status === 200 && publishBRes.data?.data?.status === 'published', 'Company B published Form B');

  // Form A Edit: Update title and description
  const editARes = await request(`/api/forms/${formA._id}`, {
    method: 'PATCH',
    headers: headersA,
    body: {
      title: `Alpha Updated Form ${runId}`,
      description: 'Updated description for Alpha',
    },
  });
  assert(
    editARes.status === 200 && editARes.data?.data?.title === `Alpha Updated Form ${runId}`,
    'Company A edited Form A and persisted changes to the same form record'
  );

  // Form A Unpublish & Re-publish
  const unpublishARes = await request(`/api/forms/${formA._id}`, {
    method: 'PATCH',
    headers: headersA,
    body: { status: 'draft' },
  });
  assert(unpublishARes.status === 200 && unpublishARes.data?.data?.status === 'draft', 'Company A unpublished Form A (status: draft)');

  // While draft, public access must return 404
  const publicDraftRes = await request(`/api/public/forms/${formA.publicId}`);
  assert(publicDraftRes.status === 404, 'Public access to draft Form A is rejected with 404');

  // Re-publish Form A
  const republishARes = await request(`/api/forms/${formA._id}`, {
    method: 'PATCH',
    headers: headersA,
    body: { status: 'published' },
  });
  assert(republishARes.status === 200 && republishARes.data?.data?.status === 'published', 'Company A re-published Form A');

  // Preview Form A
  const previewARes = await request(`/api/public/forms/${formA.publicId}`);
  assert(
    previewARes.status === 200 && previewARes.data?.data?.publicId === formA.publicId,
    'Public preview for Form A loads successfully'
  );
  assert(
    previewARes.data?.data?.companyName === `Alpha Corp ${runId}`,
    'Public preview correctly attributes company name to Company A'
  );

  // Embed HTML page loads
  const embedPageRes = await request(`/embed/${formA.publicId}`);
  assert(embedPageRes.status === 200 && embedPageRes.text.includes('Form.io'), 'Embed page loads with Form.io engine HTML');

  // Archive & Restore Form B
  const archiveBRes = await request(`/api/forms/${formB._id}`, {
    method: 'PATCH',
    headers: headersB,
    body: { status: 'archived' },
  });
  assert(archiveBRes.status === 200 && archiveBRes.data?.data?.status === 'archived', 'Company B archived Form B');

  const restoreBRes = await request(`/api/forms/${formB._id}`, {
    method: 'PATCH',
    headers: headersB,
    body: { status: 'published' },
  });
  assert(restoreBRes.status === 200 && restoreBRes.data?.data?.status === 'published', 'Company B restored Form B to published');

  // Analytics for empty form
  const analyticsARes = await request(`/api/forms/${formA._id}/analytics`, { headers: headersA });
  assert(
    analyticsARes.status === 200 && analyticsARes.data?.data?.metrics?.totalSubmissions === 0,
    'Company A views empty analytics for Form A (totalSubmissions: 0)'
  );

  // 7. Security & Cross-Tenant Isolation Enforcement
  console.log('\n--- Phase 7: Security & Direct Cross-Tenant Tampering Resistance ---');
  // Company A attempts to GET Form B
  const attackGetRes = await request(`/api/forms/${formB._id}`, { headers: headersA });
  assert(attackGetRes.status === 404, 'Direct GET Form B by Company A is strictly rejected (404 Not Found)');

  // Company A attempts to PATCH Form B
  const attackPatchRes = await request(`/api/forms/${formB._id}`, {
    method: 'PATCH',
    headers: headersA,
    body: { title: 'Hacked Title' },
  });
  assert(attackPatchRes.status === 404, 'Direct PATCH Form B by Company A is strictly rejected (404 Not Found)');

  // Company A attempts to read Form B Analytics
  const attackAnalyticsRes = await request(`/api/forms/${formB._id}/analytics`, { headers: headersA });
  assert(attackAnalyticsRes.status === 404, 'Direct Analytics of Form B by Company A is strictly rejected (404 Not Found)');

  // Company B attempts to GET Form A
  const attackGetBRes = await request(`/api/forms/${formA._id}`, { headers: headersB });
  assert(attackGetBRes.status === 404, 'Direct GET Form A by Company B is strictly rejected (404 Not Found)');

  // 8. Public Submissions & Lead Pipeline Isolation
  console.log('\n--- Phase 8: Public Form Submissions & Pipeline Isolation ---');
  // Submit to Form A
  const subARes = await request(`/api/public/forms/${formA.publicId}/submissions`, {
    method: 'POST',
    body: {
      data: {
        companyName: 'Acme Client Corp',
        contactPerson: 'Charlie Client',
        email: 'charlie@acmeclient.test',
        notes: 'Inquiry for Company A services',
      },
    },
  });
  assert(subARes.status === 201 && subARes.data?.leadId, 'Public submission to Form A succeeds', subARes.data?.error);
  const leadAId = subARes.data?.leadId;

  // Submit to Form B
  const subBRes = await request(`/api/public/forms/${formB.publicId}/submissions`, {
    method: 'POST',
    body: {
      data: {
        contactPerson: 'David Client',
        email: 'david@betaquery.test',
        notes: 'Inquiry for Company B product',
      },
    },
  });
  assert(subBRes.status === 201 && subBRes.data?.leadId, 'Public submission to Form B succeeds', subBRes.data?.error);
  const leadBId = subBRes.data?.leadId;

  // Verify Leads list isolation
  const leadsARes = await request('/api/leads', { headers: headersA });
  assert(leadsARes.status === 200, 'Company A can retrieve leads');
  const leadsForA = leadsARes.data?.data || [];
  const aHasLeadA = leadsForA.some((l) => l._id === leadAId);
  const aHasLeadB = leadsForA.some((l) => l._id === leadBId);
  assert(aHasLeadA && !aHasLeadB, 'Company A leads dashboard contains Lead A and NOT Lead B');
  assert(leadsARes.data?.pagination?.total === 1, `Company A lead total is 1 (found: ${leadsARes.data?.pagination?.total})`);

  const leadsBRes = await request('/api/leads', { headers: headersB });
  assert(leadsBRes.status === 200, 'Company B can retrieve leads');
  const leadsForB = leadsBRes.data?.data || [];
  const bHasLeadB = leadsForB.some((l) => l._id === leadBId);
  const bHasLeadA = leadsForB.some((l) => l._id === leadAId);
  assert(bHasLeadB && !bHasLeadA, 'Company B leads dashboard contains Lead B and NOT Lead A');
  assert(leadsBRes.data?.pagination?.total === 1, `Company B lead total is 1 (found: ${leadsBRes.data?.pagination?.total})`);

  // Verify Form submission counts in forms list
  const refreshedListA = await request('/api/forms', { headers: headersA });
  const refreshedFormA = refreshedListA.data?.data?.find((f) => f._id === formA._id);
  assert(
    refreshedFormA?.submissionsCount === 1,
    `Form A submissionsCount equals 1 in Company A dashboard (found: ${refreshedFormA?.submissionsCount})`
  );

  const refreshedListB = await request('/api/forms', { headers: headersB });
  const refreshedFormB = refreshedListB.data?.data?.find((f) => f._id === formB._id);
  assert(
    refreshedFormB?.submissionsCount === 1,
    `Form B submissionsCount equals 1 in Company B dashboard (found: ${refreshedFormB?.submissionsCount})`
  );

  // Verify Analytics after submission
  const finalAnalyticsA = await request(`/api/forms/${formA._id}/analytics`, { headers: headersA });
  assert(
    finalAnalyticsA.data?.data?.metrics?.totalSubmissions === 1,
    'Company A Analytics reflects 1 total submission'
  );

  const finalAnalyticsB = await request(`/api/forms/${formB._id}/analytics`, { headers: headersB });
  assert(
    finalAnalyticsB.data?.data?.metrics?.totalSubmissions === 1,
    'Company B Analytics reflects 1 total submission'
  );

  // 9. Pre-Existing Data Verification
  console.log('\n--- Phase 9: Pre-Existing Data Integrity ---');
  // Check that sumsol's form is still present and working
  const sumsolFormRes = await request('/api/public/forms/3cb66b7b8a7948538bc6f304');
  assert(
    sumsolFormRes.status === 200 && sumsolFormRes.data?.data?.publicId === '3cb66b7b8a7948538bc6f304',
    "Pre-existing company's form (publicId: 3cb66b7b8a7948538bc6f304) remains intact and published"
  );
  assert(
    sumsolFormRes.data?.data?.companyName === 'sumsol',
    'Pre-existing form correctly belongs to company "sumsol"'
  );

  // 10. Clean Up Test Records Only
  console.log('\n--- Phase 10: Safe Test Artifact Cleanup ---');
  // Clean up only the records created by this test run
  try {
    const projectDir = 'C:\\Users\\RaJPooT\\Desktop\\company lead tracker\\company-lead-tracker';
    const envPath = path.join(projectDir, '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }

    const mongoose = require('mongoose');
    const dns = require('node:dns');
    try {
      const customResolver = new dns.promises.Resolver();
      customResolver.setServers(['8.8.8.8', '1.1.1.1']);
      const orig = dns.promises.resolve.bind(dns.promises);
      dns.promises.resolve = async function (hostname, rrtype) {
        if (rrtype === 'SRV' || rrtype === 'TXT') {
          try {
            return await customResolver.resolve(hostname, rrtype);
          } catch {
            return await orig(hostname, rrtype);
          }
        }
        return await orig(hostname, rrtype);
      };
    } catch {}

    await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false, serverSelectionTimeoutMS: 8000 });
    const db = mongoose.connection.db;

    const toDeleteCompanies = [new mongoose.Types.ObjectId(companyAId), new mongoose.Types.ObjectId(companyBId)];
    const toDeleteForms = [new mongoose.Types.ObjectId(formA._id), new mongoose.Types.ObjectId(formB._id)];
    const toDeleteLeads = [new mongoose.Types.ObjectId(leadAId), new mongoose.Types.ObjectId(leadBId)];

    await db.collection('leads').deleteMany({ _id: { $in: toDeleteLeads } });
    await db.collection('forms').deleteMany({ _id: { $in: toDeleteForms } });
    await db.collection('users').deleteMany({ email: { $in: [compAEmail, compBEmail] } });
    await db.collection('companies').deleteMany({ _id: { $in: toDeleteCompanies } });

    await mongoose.disconnect();
    console.log('[CLEANUP] Successfully cleaned up isolated test records for Company A & B.');
  } catch (cleanErr) {
    console.warn('[CLEANUP WARNING] Non-fatal cleanup issue:', cleanErr.message);
  }

  console.log('\n================================================================');
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMultiTenantFormsSuite().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exit(1);
});
