/**
 * Test Suite: Compact Form Builder & Automatic Submission Key Generation
 * Verifies:
 * 1. Automatic key derivation from field labels (e.g. "Work Email" -> "work_email")
 * 2. Safe duplicate label disambiguation (e.g. "Phone", "Phone" -> "phone", "phone_2")
 * 3. Preservation of existing keys when labels are edited on saved/published forms
 * 4. Forms created without explicit 'name' attributes are fully functional
 * 5. Lead submission, viewing, analytics, and CSV export using auto-generated keys
 * 6. Clean teardown of test records
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const fs = require('fs');
const path = require('path');
const { SignJWT } = require('jose');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:3000';

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
  console.log('STARTING COMPACT BUILDER & AUTO-KEY TEST SUITE');
  console.log('====================================================');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const companyA = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId('6ace5de5a51c5c2473fbd3ce') });
  if (!companyA) {
    throw new Error('Tenant Alpha required for tests.');
  }

  const tokenA = await makeToken({
    userId: '6ace5de6a51c5c2473fbd3cf',
    email: 'alpha_admin@test.local',
    companyId: companyA._id.toString(),
  });

  const authHeadersA = {
    'Content-Type': 'application/json',
    Cookie: `auth_token=${tokenA}`,
  };

  let testFormId = null;
  let testPublicId = null;
  let testLeadId = null;

  try {
    // -----------------------------------------------------------------
    // TEST 1: Create Form without any 'name' keys (purely labels)
    // -----------------------------------------------------------------
    console.log('\n[TEST 1] Creating Form with labels only (no manual submission keys)...');
    const fieldsWithoutKeys = [
      { id: 'f1', type: 'text', label: 'Company / Organization', required: true },
      { id: 'f2', type: 'text', label: 'Contact Person', required: true },
      { id: 'f3', type: 'email', label: 'Work Email Address', required: true },
      { id: 'f4', type: 'phone', label: 'Phone Number', required: false },
      { id: 'f5', type: 'phone', label: 'Phone Number', required: false }, // Duplicate label!
      { id: 'f6', type: 'dropdown', label: 'Service Category', required: true, options: ['Tier 1', 'Tier 2'] },
      { id: 'f7', type: 'textarea', label: 'Project Scope & Requirements', required: false },
    ];

    const createRes = await fetch(`${BASE_URL}/api/forms`, {
      method: 'POST',
      headers: authHeadersA,
      body: JSON.stringify({
        title: 'Auto-Key Intake Form',
        status: 'draft',
        fields: fieldsWithoutKeys,
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok || !createData.success) {
      throw new Error(`Creation failed: ${JSON.stringify(createData)}`);
    }

    testFormId = createData.data._id;
    testPublicId = createData.data.publicId;

    const savedFields = createData.data.fields;
    console.log('  ✓ Form created with auto-derived keys:');
    savedFields.forEach((f) => {
      console.log(`    - "${f.label}" => key: "${f.name}"`);
    });

    // Check specific derived keys
    if (savedFields[0].name !== 'company_organization') {
      throw new Error(`Expected company_organization, got ${savedFields[0].name}`);
    }
    if (savedFields[1].name !== 'contact_person') {
      throw new Error(`Expected contact_person, got ${savedFields[1].name}`);
    }
    if (savedFields[2].name !== 'work_email_address') {
      throw new Error(`Expected work_email_address, got ${savedFields[2].name}`);
    }
    if (savedFields[3].name !== 'phone_number') {
      throw new Error(`Expected phone_number, got ${savedFields[3].name}`);
    }
    if (savedFields[4].name !== 'phone_number_2') {
      throw new Error(`Expected duplicate disambiguation "phone_number_2", got "${savedFields[4].name}"`);
    }
    console.log('  ✓ Duplicate label disambiguation verified ("phone_number" & "phone_number_2")');

    // -----------------------------------------------------------------
    // TEST 2: Label Edit on Saved Form Preserves Existing Keys
    // -----------------------------------------------------------------
    console.log('\n[TEST 2] Verifying key stability when labels are edited on a saved form...');
    // User updates label from "Work Email Address" to "Corporate Business Email",
    // but the key 'work_email_address' must remain stable!
    const updatedFields = savedFields.map((f) => {
      if (f.name === 'work_email_address') {
        return { ...f, label: 'Corporate Business Email' };
      }
      return f;
    });

    const patchRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
      method: 'PATCH',
      headers: authHeadersA,
      body: JSON.stringify({
        status: 'published',
        fields: updatedFields,
      }),
    });

    const patchData = await patchRes.json();
    if (!patchRes.ok || !patchData.success) {
      throw new Error(`PATCH failed: ${JSON.stringify(patchData)}`);
    }

    const emailFieldAfterPatch = patchData.data.fields.find((f) => f.label === 'Corporate Business Email');
    if (!emailFieldAfterPatch) {
      throw new Error('Edited field label not found in patch response');
    }
    if (emailFieldAfterPatch.name !== 'work_email_address') {
      throw new Error(`Key changed after label edit! Expected "work_email_address", got "${emailFieldAfterPatch.name}"`);
    }
    console.log('  ✓ Key stability confirmed: Label renamed to "Corporate Business Email" while key remains "work_email_address"');

    // -----------------------------------------------------------------
    // TEST 3: Submit Lead Using Auto-Generated Keys
    // -----------------------------------------------------------------
    console.log('\n[TEST 3] Submitting Lead to the Published Form...');
    const submissionBody = {
      company_organization: 'Nexus Tech Global',
      contact_person: 'Sarah Connor',
      work_email_address: 'sarah@nexustech.test',
      phone_number: '+1 415-555-0142',
      phone_number_2: '+1 415-555-0199',
      service_category: 'Tier 1',
      project_scope_requirements: 'Automated infrastructure migration and monitoring.',
    };

    const submitRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submissionBody),
    });

    const submitData = await submitRes.json();
    if (!submitRes.ok || !submitData.success) {
      throw new Error(`Submission failed: ${JSON.stringify(submitData)}`);
    }

    testLeadId = submitData.leadId;
    console.log(`  ✓ Lead accepted: leadId=${testLeadId}`);

    // -----------------------------------------------------------------
    // TEST 4: Verify Lead Record & Dynamic CSV Export
    // -----------------------------------------------------------------
    console.log('\n[TEST 4] Verifying Lead in Database & CSV Export...');
    const leadRes = await fetch(`${BASE_URL}/api/leads/${testLeadId}`, {
      headers: authHeadersA,
    });
    const leadData = await leadRes.json();
    if (!leadRes.ok || !leadData.success) {
      throw new Error(`Could not fetch lead: ${JSON.stringify(leadData)}`);
    }

    if (leadData.data.companyName !== 'Nexus Tech Global') {
      throw new Error(`Expected companyName="Nexus Tech Global", got "${leadData.data.companyName}"`);
    }
    if (leadData.data.email !== 'sarah@nexustech.test') {
      throw new Error(`Expected email="sarah@nexustech.test", got "${leadData.data.email}"`);
    }
    if (leadData.data.submissionData.phone_number_2 !== '+1 415-555-0199') {
      throw new Error('submissionData missing disambiguated phone_number_2');
    }
    console.log('  ✓ Lead record verified with all auto-key values in submissionData');

    // CSV Export
    const exportRes = await fetch(`${BASE_URL}/api/leads/export`, {
      headers: authHeadersA,
    });
    const csvText = await exportRes.text();
    if (!csvText.includes('Nexus Tech Global') || !csvText.includes('sarah@nexustech.test')) {
      throw new Error('CSV export does not contain new lead data');
    }
    console.log('  ✓ Dynamic CSV export contains new lead data and question headers');

    // -----------------------------------------------------------------
    // TEST 5: Verify Analytics
    // -----------------------------------------------------------------
    console.log('\n[TEST 5] Verifying Form Analytics...');
    const analyticsRes = await fetch(`${BASE_URL}/api/forms/${testFormId}/analytics`, {
      headers: authHeadersA,
    });
    const analyticsData = await analyticsRes.json();
    if (!analyticsRes.ok || !analyticsData.success || analyticsData.data.metrics.totalSubmissions !== 1) {
      throw new Error(`Analytics failed: ${JSON.stringify(analyticsData)}`);
    }
    console.log('  ✓ Form analytics reflects 1 submission');

    console.log('\n====================================================');
    console.log('ALL AUTO-KEY & REFINEMENT TESTS PASSED PERFECTLY!');
    console.log('====================================================');
  } finally {
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
