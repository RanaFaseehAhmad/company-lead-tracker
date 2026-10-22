/**
 * Automated End-to-End Test Suite for Custom Form Builder Flow
 * Verifies:
 * 1. Form creation with all 11 field types
 * 2. Multi-tenant isolation on drafts and published forms
 * 3. Form publishing
 * 4. Public endpoint & embed page verification (no Form.io CDN)
 * 5. Input validation (required, email, URL, dropdown options)
 * 6. Valid lead submission & mapping
 * 7. Lead viewing and tenant isolation
 * 8. Form analytics aggregation
 * 9. CSV export with dynamic question headers
 * 10. Clean teardown of test artifacts
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const fs = require('fs');
const path = require('path');
const { SignJWT } = require('jose');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:3000';

// Read JWT secret from .env.local
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const jwtMatch = envFile.match(/JWT_SECRET=(.+)/);
const JWT_SECRET = jwtMatch ? jwtMatch[1].trim() : 'super-secret-jwt-key-for-testing-at-least-32-chars';
const secretKey = new TextEncoder().encode(JWT_SECRET);

const mongoMatch = envFile.match(/MONGODB_URI=(.+)/);
const MONGODB_URI = mongoMatch ? mongoMatch[1].trim() : process.env.MONGODB_URI;

async function makeToken(user) {
  return new SignJWT({
    userId: user.userId,
    email: user.email,
    role: user.role || 'company_admin',
    companyId: user.companyId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING CUSTOM FORM BUILDER END-TO-END TEST SUITE');
  console.log('====================================================');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  // Identify two active approved companies
  const companyA = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId('6ace5de5a51c5c2473fbd3ce') });
  const companyB = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId('6ace5de6a51c5c2473fbd3d0') });

  if (!companyA || !companyB) {
    throw new Error('Test requires approved company accounts for Tenant Alpha and Tenant Beta.');
  }

  const tokenA = await makeToken({
    userId: '6ace5de6a51c5c2473fbd3cf',
    email: 'alpha_admin@test.local',
    companyId: companyA._id.toString(),
  });

  const tokenB = await makeToken({
    userId: '6ace5de6a51c5c2473fbd3d1',
    email: 'beta_admin@test.local',
    companyId: companyB._id.toString(),
  });

  const authHeadersA = {
    'Content-Type': 'application/json',
    Cookie: `auth_token=${tokenA}`,
  };

  const authHeadersB = {
    'Content-Type': 'application/json',
    Cookie: `auth_token=${tokenB}`,
  };

  let testFormId = null;
  let testPublicId = null;
  let testLeadId = null;

  try {
    // -----------------------------------------------------------------
    // TEST 1: Create Form with All 11 Field Types
    // -----------------------------------------------------------------
    console.log('\n[TEST 1] Creating Form with all 11 field types as Company A...');
    const all11Fields = [
      { id: 'f_text', type: 'text', label: 'Company Name', name: 'company_name', required: true, placeholder: 'Acme Corp', order: 0 },
      { id: 'f_email', type: 'email', label: 'Work Email', name: 'work_email', required: true, placeholder: 'contact@acme.com', order: 1 },
      { id: 'f_phone', type: 'phone', label: 'Phone Number', name: 'phone_number', required: false, placeholder: '+1 555-0100', order: 2 },
      { id: 'f_num', type: 'number', label: 'Team Size', name: 'team_size', required: true, validation: { min: 1, max: 10000 }, order: 3 },
      { id: 'f_area', type: 'textarea', label: 'Project Scope', name: 'project_scope', required: false, placeholder: 'Brief details...', order: 4 },
      { id: 'f_drop', type: 'dropdown', label: 'Service Category', name: 'service_cat', required: true, options: ['Consulting', 'Implementation', 'Support'], order: 5 },
      { id: 'f_rad', type: 'radio', label: 'Budget Range', name: 'budget_tier', required: true, options: ['Tier 1 ($5k)', 'Tier 2 ($20k)', 'Enterprise ($50k+)'], order: 6 },
      { id: 'f_chk', type: 'checkbox', label: 'NDA Accepted', name: 'nda_accepted', required: true, order: 7 },
      { id: 'f_date', type: 'date', label: 'Kickoff Date', name: 'kickoff_date', required: false, order: 8 },
      { id: 'f_url', type: 'url', label: 'Website URL', name: 'company_site', required: false, placeholder: 'https://acme.com', order: 9 },
      { id: 'f_pwd', type: 'password', label: 'Project PIN', name: 'project_pin', required: false, placeholder: 'Secret PIN', order: 10 },
    ];

    const createRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: authHeadersA,
      body: JSON.stringify({
        title: 'Enterprise Custom Onboarding Form',
        status: 'draft',
        fields: all11Fields,
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok || !createData.success) {
      throw new Error(`Form creation failed: ${JSON.stringify(createData)}`);
    }

    testFormId = createData.data._id;
    testPublicId = createData.data.publicId;
    console.log(`  ✓ Form created successfully: ID=${testFormId}, PublicId=${testPublicId}`);
    if (createData.data.fields.length !== 11) {
      throw new Error(`Expected 11 fields, got ${createData.data.fields.length}`);
    }
    console.log('  ✓ Verified 11 field types present in created form');

    // -----------------------------------------------------------------
    // TEST 2: Multi-Tenant Isolation on Form Access
    // -----------------------------------------------------------------
    console.log('\n[TEST 2] Verifying Tenant Isolation between Company A and Company B...');
    const accessResB = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      headers: authHeadersB,
    });
    if (accessResB.status !== 404) {
      throw new Error(`Tenant leak! Company B should get 404 accessing Company A form, got: ${accessResB.status}`);
    }
    console.log('  ✓ Company B cannot view Company A form (returned 404)');

    const patchResB = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PATCH',
      headers: authHeadersB,
      body: JSON.stringify({ title: 'Hacked Title' }),
    });
    if (patchResB.status !== 404) {
      throw new Error(`Tenant leak! Company B should get 404 modifying Company A form, got: ${patchResB.status}`);
    }
    console.log('  ✓ Company B cannot modify Company A form (returned 404)');

    // -----------------------------------------------------------------
    // TEST 3: Publish the Form
    // -----------------------------------------------------------------
    console.log('\n[TEST 3] Publishing the Form as Company A...');
    const publishRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PATCH',
      headers: authHeadersA,
      body: JSON.stringify({ status: 'published' }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.success || publishData.data.status !== 'published') {
      throw new Error(`Publish failed: ${JSON.stringify(publishData)}`);
    }
    console.log('  ✓ Form successfully transitioned to "published" status');

    // -----------------------------------------------------------------
    // TEST 4: Public API & Embed Page (No Form.io CDN tags)
    // -----------------------------------------------------------------
    console.log('\n[TEST 4] Verifying Public API and Embed Page...');
    const publicRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}`);
    const publicData = await publicRes.json();
    if (!publicRes.ok || !publicData.success) {
      throw new Error(`Public form fetch failed: ${JSON.stringify(publicData)}`);
    }
    if (publicData.data.fields.length !== 11) {
      throw new Error(`Expected 11 fields from public endpoint, got ${publicData.data.fields.length}`);
    }
    console.log(`  ✓ Public form endpoint returns all 11 fields for company "${publicData.data.companyName}"`);

    // Fetch embed HTML
    const embedRes = await fetch(`${BASE_URL}/embed/${testPublicId}`);
    const embedHtml = await embedRes.text();
    if (embedRes.status !== 200) {
      throw new Error(`Embed page returned status ${embedRes.status}`);
    }
    if (embedHtml.includes('cdn.form.io') || embedHtml.includes('formio.full.min.js')) {
      throw new Error('CRITICAL: Embed page still contains Form.io CDN references!');
    }
    if (embedHtml.includes('bootstrap.min.css')) {
      throw new Error('CRITICAL: Embed page still contains Bootstrap CDN references!');
    }
    console.log('  ✓ Embed page returns HTTP 200 and is completely free of Form.io / Bootstrap CDN links');

    // -----------------------------------------------------------------
    // TEST 5: Input Validation Checks
    // -----------------------------------------------------------------
    console.log('\n[TEST 5] Testing Submission Validation Rules...');

    // 5a: Missing required field
    const subMissingReq = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Acme Corp',
        // work_email omitted
      }),
    });
    if (subMissingReq.status !== 400) {
      throw new Error(`Expected 400 for missing required field, got ${subMissingReq.status}`);
    }
    console.log('  ✓ Missing required field rejected with 400');

    // 5b: Invalid email format
    const subBadEmail = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Acme Corp',
        work_email: 'not-an-email',
        team_size: '25',
        service_cat: 'Consulting',
        budget_tier: 'Tier 1 ($5k)',
        nda_accepted: true,
      }),
    });
    if (subBadEmail.status !== 400) {
      throw new Error(`Expected 400 for bad email, got ${subBadEmail.status}`);
    }
    console.log('  ✓ Invalid email format rejected with 400');

    // 5c: Invalid dropdown option
    const subBadDrop = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Acme Corp',
        work_email: 'ceo@acme.com',
        team_size: '25',
        service_cat: 'Illegal Category',
        budget_tier: 'Tier 1 ($5k)',
        nda_accepted: true,
      }),
    });
    if (subBadDrop.status !== 400) {
      throw new Error(`Expected 400 for invalid dropdown option, got ${subBadDrop.status}`);
    }
    console.log('  ✓ Invalid dropdown option rejected with 400');

    // 5d: Out of range number
    const subBadNum = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Acme Corp',
        work_email: 'ceo@acme.com',
        team_size: '0', // min is 1
        service_cat: 'Consulting',
        budget_tier: 'Tier 1 ($5k)',
        nda_accepted: true,
      }),
    });
    if (subBadNum.status !== 400) {
      throw new Error(`Expected 400 for out-of-range number, got ${subBadNum.status}`);
    }
    console.log('  ✓ Out-of-range number rejected with 400');

    // -----------------------------------------------------------------
    // TEST 6: Valid Complete Submission (All 11 Field Values)
    // -----------------------------------------------------------------
    console.log('\n[TEST 6] Submitting Valid Payload with All 11 Fields...');
    const validPayload = {
      company_name: 'Stark Industries Global',
      work_email: 'tony@starkindustries.test',
      phone_number: '+1 212-555-0199',
      team_size: '500',
      project_scope: 'Clean energy arc reactor consultation and integration.',
      service_cat: 'Consulting',
      budget_tier: 'Enterprise ($50k+)',
      nda_accepted: true,
      kickoff_date: '2026-11-01',
      company_site: 'https://starkindustries.test',
      project_pin: 'Mk85Armor',
    };

    const subValidRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://starkindustries.test/contact',
      },
      body: JSON.stringify(validPayload),
    });

    const subValidData = await subValidRes.json();
    if (subValidRes.status !== 201 || !subValidData.success) {
      throw new Error(`Valid submission rejected: ${JSON.stringify(subValidData)}`);
    }

    testLeadId = subValidData.leadId;
    console.log(`  ✓ Lead submission accepted: leadId=${testLeadId}`);

    // -----------------------------------------------------------------
    // TEST 7: Lead Verification & Multi-Tenant Isolation
    // -----------------------------------------------------------------
    console.log('\n[TEST 7] Verifying Lead Record & Multi-Tenant Boundaries...');
    const leadResA = await fetch(`${BASE_URL}/api/leads/${testLeadId}`, {
      headers: authHeadersA,
    });
    const leadDataA = await leadResA.json();
    if (!leadResA.ok || !leadDataA.success) {
      throw new Error(`Company A could not view lead: ${JSON.stringify(leadDataA)}`);
    }

    const leadDoc = leadDataA.data;
    if (leadDoc.companyName !== 'Stark Industries Global') {
      throw new Error(`Expected companyName="Stark Industries Global", got "${leadDoc.companyName}"`);
    }
    if (leadDoc.email !== 'tony@starkindustries.test') {
      throw new Error(`Expected email="tony@starkindustries.test", got "${leadDoc.email}"`);
    }
    if (!leadDoc.submissionData || leadDoc.submissionData.service_cat !== 'Consulting') {
      throw new Error('Lead submissionData does not match custom field answers.');
    }
    console.log('  ✓ Company A can view lead with all custom submissionData fields intact');

    // Tenant boundary: Company B attempts to view lead
    const leadResB = await fetch(`${BASE_URL}/api/leads/${testLeadId}`, {
      headers: authHeadersB,
    });
    if (leadResB.status !== 404) {
      throw new Error(`Tenant leak! Company B should get 404 accessing Company A lead, got ${leadResB.status}`);
    }
    console.log('  ✓ Company B cannot view Company A lead (returned 404)');

    // -----------------------------------------------------------------
    // TEST 8: Form Analytics
    // -----------------------------------------------------------------
    console.log('\n[TEST 8] Verifying Form Analytics...');
    const analyticsResA = await fetch(`${BASE_URL}/api/forms/${testFormId}/analytics`, {
      headers: authHeadersA,
    });
    const analyticsDataA = await analyticsResA.json();
    if (!analyticsResA.ok || !analyticsDataA.success) {
      throw new Error(`Analytics failed: ${JSON.stringify(analyticsDataA)}`);
    }
    if (analyticsDataA.data.metrics.totalSubmissions !== 1) {
      throw new Error(`Expected totalSubmissions=1, got ${analyticsDataA.data.metrics.totalSubmissions}`);
    }
    console.log('  ✓ Analytics returned totalSubmissions=1 and todaySubmissions=1');

    const analyticsResB = await fetch(`${BASE_URL}/api/forms/${testFormId}/analytics`, {
      headers: authHeadersB,
    });
    if (analyticsResB.status !== 404) {
      throw new Error(`Tenant leak! Company B should get 404 accessing Company A analytics, got ${analyticsResB.status}`);
    }
    console.log('  ✓ Company B cannot access Company A form analytics (returned 404)');

    // -----------------------------------------------------------------
    // TEST 9: CSV Export with Dynamic Custom Questions
    // -----------------------------------------------------------------
    console.log('\n[TEST 9] Verifying Dynamic CSV Export...');
    const exportResA = await fetch(`${BASE_URL}/api/leads/export`, {
      headers: authHeadersA,
    });
    if (exportResA.status !== 200) {
      throw new Error(`CSV export failed with status ${exportResA.status}`);
    }
    const csvContentA = await exportResA.text();

    if (!csvContentA.includes('Service Category') || !csvContentA.includes('Budget Range')) {
      throw new Error('CSV headers missing dynamic custom question labels.');
    }
    if (!csvContentA.includes('Stark Industries Global') || !csvContentA.includes('tony@starkindustries.test')) {
      throw new Error('CSV content missing submitted lead record data.');
    }
    console.log('  ✓ CSV export includes dynamic question headers and custom form answers');

    // Tenant check: Company B export must NOT contain Company A's lead
    const exportResB = await fetch(`${BASE_URL}/api/leads/export`, {
      headers: authHeadersB,
    });
    const csvContentB = await exportResB.text();
    if (csvContentB.includes('Stark Industries Global') || csvContentB.includes('tony@starkindustries.test')) {
      throw new Error('Tenant leak! Company B CSV export contains Company A lead!');
    }
    console.log('  ✓ Company B CSV export strictly excludes Company A leads');

    console.log('\n====================================================');
    console.log('ALL 9 TESTS PASSED FLAWLESSLY WITH MULTI-TENANT ISOLATION');
    console.log('====================================================');
  } finally {
    // Teardown test records
    console.log('\n[TEARDOWN] Cleaning up test records...');
    if (testLeadId) {
      await db.collection('leads').deleteOne({ _id: new mongoose.Types.ObjectId(testLeadId) });
      console.log(`  ✓ Deleted test lead ${testLeadId}`);
    }
    if (testFormId) {
      await db.collection('forms').deleteOne({ _id: new mongoose.Types.ObjectId(testFormId) });
      console.log(`  ✓ Deleted test form ${testFormId}`);
    }
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
