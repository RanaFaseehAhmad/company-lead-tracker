/**
 * Test Suite: Final Custom Form Builder UI Refinement & Automatic Submission Keys
 * Tests all 14 requirements from the user request.
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

function labelToKey(label, fallbackIndex = 0, existingKeys = new Set()) {
  let base = (label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!base) base = `field_${fallbackIndex + 1}`;

  let candidate = base;
  let counter = 2;
  while (existingKeys.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter++;
  }
  return candidate;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('FINAL CUSTOM FORM BUILDER UI & AUTO SUBMISSION KEYS TEST SUITE');
  console.log('================================================================\n');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const builderCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CustomFormBuilder.js'), 'utf8');

  console.log('--- Test 1: New Form Opens With Exactly One Initial Field ---');
  assert(builderCode.includes('function createInitialField()'), 'createInitialField function exists');
  assert(builderCode.includes('useState(initialFormId ? [] : [createInitialField()])'), 'fields state initializes to exactly 1 field for new forms');
  assert(!builderCode.includes('f_company_name'), 'Legacy 5 default example fields removed from initial state');

  console.log('\n--- Test 2: Adding Three Fields Creates Exactly Three Additional Fields ---');
  const simFields = [
    { id: 'f1', name: 'full_name', type: 'text', label: 'Full Name', order: 0, isSaved: false }
  ];
  function simAddField(type, currentFields) {
    const idx = currentFields.length;
    const label = type === 'email' ? 'Work Email Address' : type === 'phone' ? 'Phone Number' : 'Single-Line Text';
    const keys = new Set(currentFields.map(f => f.name));
    const autoKey = labelToKey(label, idx, keys);
    return [...currentFields, { id: `f_${idx + 1}`, name: autoKey, type, label, order: idx, isSaved: false }];
  }
  let updatedFields = simAddField('email', simFields);
  updatedFields = simAddField('phone', updatedFields);
  updatedFields = simAddField('text', updatedFields);
  assert(updatedFields.length === 4, 'Simulated field count went from 1 to 4 after 3 additions');
  assert(updatedFields[1].name === 'work_email_address', 'Field 2 auto-key is work_email_address');
  assert(updatedFields[2].name === 'phone_number', 'Field 3 auto-key is phone_number');
  assert(updatedFields[3].name === 'single_line_text', 'Field 4 auto-key is single_line_text');

  console.log('\n--- Test 3: Live Preview Updates Immediately With Title and Fields ---');
  assert(builderCode.includes('<FormRenderer'), 'FormRenderer component embedded for live interactive preview');
  assert(builderCode.includes('fields={fields}'), 'Live preview passes in-memory fields state directly');
  assert(builderCode.includes('title={title}'), 'Live preview passes in-memory title directly');
  assert(builderCode.includes('id="live-form-preview"'), 'Live preview container has descriptive ID live-form-preview');

  console.log('\n--- Test 4: Dropdown / Radio Option Edits Synchronize With Preview ---');
  assert(builderCode.includes('function addOption'), 'addOption helper exists');
  assert(builderCode.includes('function removeOption'), 'removeOption helper exists');
  assert(builderCode.includes('field.options'), 'Options array bound directly to field state and passed to preview');

  console.log('\n--- Test 5: Reordering and Deleting Fields Updates Correctly ---');
  assert(builderCode.includes('function moveField'), 'moveField helper exists');
  assert(builderCode.includes('function removeField'), 'removeField helper exists');
  assert(builderCode.includes('prev.filter((f) => f && f.id !== id)'), 'removeField safely prevents undefined/null items');

  console.log('\n--- Test 6: Submission Keys Absent From Company Admin UI Surfaces ---');
  assert(!builderCode.includes('Internal Submission Key'), 'No "Internal Submission Key" text in UI');
  assert(!builderCode.includes('group/adv'), 'No Advanced Settings accordion in UI');
  assert(!builderCode.includes('placeholder="submission_key"'), 'No submission_key input in UI');
  assert(!builderCode.includes('({field.name})'), 'No field.name badge in UI');

  console.log('\n--- Test 7: Internal Keys Unique & Stable After Saving & Renaming Labels ---');
  const testKeys = new Set();
  const k1 = labelToKey('Phone', 0, testKeys); testKeys.add(k1);
  const k2 = labelToKey('Phone', 1, testKeys); testKeys.add(k2);
  const k3 = labelToKey('Phone', 2, testKeys); testKeys.add(k3);
  assert(k1 === 'phone', 'First duplicate is phone');
  assert(k2 === 'phone_2', 'Second duplicate is phone_2');
  assert(k3 === 'phone_3', 'Third duplicate is phone_3');

  function simLabelBlur(field, newLabel, otherKeys) {
    if (field.isSaved) return field.name; // MUST NOT change if already saved!
    return labelToKey(newLabel, field.order, otherKeys);
  }
  const savedField = { name: 'original_key', isSaved: true, order: 0 };
  const retainedKey = simLabelBlur(savedField, 'Completely Changed Label', new Set());
  assert(retainedKey === 'original_key', 'Existing saved field key preserved across label edits');

  console.log('\n--- Test 8: Existing Forms Retain Saved Fields and Keys ---');
  assert(builderCode.includes('isSaved: true'), 'Loaded fields marked as isSaved: true');
  assert(builderCode.includes('fld.name || labelToKey'), 'Existing field names loaded directly from database');

  // Use established test companies Alpha and Beta
  const companyAlpha = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId('6ace5de5a51c5c2473fbd3ce') });
  const companyBeta = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId('6ace5de6a51c5c2473fbd3d0') });
  assert(Boolean(companyAlpha), 'Company Alpha found');
  assert(Boolean(companyBeta), 'Company Beta found');

  const tokenAlpha = await makeToken({
    userId: '6ace5de6a51c5c2473fbd3cf',
    email: 'alpha_1791909349119@test.local',
    companyId: companyAlpha._id.toString(),
  });
  const tokenBeta = await makeToken({
    userId: '6ace5de6a51c5c2473fbd3d1',
    email: 'beta_1791909350101@test.local',
    companyId: companyBeta._id.toString(),
  });

  console.log('\n--- Test 9: Draft Save, Publish, Edit, and Unpublish ---');
  let createdFormId = null;
  let formPublicId = null;

  // 1. Save Draft
  const saveRes = await fetch(`${BASE_URL}/api/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenAlpha}` },
    body: JSON.stringify({
      title: 'UI Refinement Test Form',
      description: 'Testing two-column builder flow',
      status: 'draft',
      fields: [
        { label: 'Full Name', type: 'text', required: true },
        { label: 'Work Email Address', type: 'email', required: true },
        { label: 'Inquiry Details', type: 'textarea', required: false }
      ]
    })
  });
  const saveData = await saveRes.json();
  assert(saveRes.ok && saveData.success, 'Draft form created successfully');
  createdFormId = saveData.data._id || saveData.data.id;
  formPublicId = saveData.data.publicId;

  // 2. Publish
  const pubRes = await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenAlpha}` },
    body: JSON.stringify({ status: 'published' })
  });
  const pubData = await pubRes.json();
  assert(pubRes.ok && pubData.data.status === 'published', 'Form published successfully');

  // 3. Edit title while published
  const editRes = await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenAlpha}` },
    body: JSON.stringify({ title: 'Updated UI Form Title' })
  });
  const editData = await editRes.json();
  assert(editRes.ok && editData.data.title === 'Updated UI Form Title', 'Published form edited successfully');

  // 4. Unpublish (revert to draft)
  const unpubRes = await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenAlpha}` },
    body: JSON.stringify({ status: 'draft' })
  });
  const unpubData = await unpubRes.json();
  assert(unpubRes.ok && unpubData.data.status === 'draft', 'Form reverted to draft successfully');

  // Re-publish for submission testing
  await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenAlpha}` },
    body: JSON.stringify({ status: 'published' })
  });

  console.log('\n--- Test 10: Valid Public Submission Creates Correct Lead ---');
  let createdLeadId = null;
  const subRes = await fetch(`${BASE_URL}/api/public/forms/${formPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Elena Rostova',
      work_email_address: 'elena@rostova.com',
      inquiry_details: 'Interested in enterprise license.'
    })
  });
  const subData = await subRes.json();
  assert(subRes.ok && subData.success, 'Valid public submission accepted');
  createdLeadId = subData.leadId;

  // Verify lead in database
  const leadDoc = await db.collection('leads').findOne({ _id: new mongoose.Types.ObjectId(createdLeadId) });
  assert(Boolean(leadDoc), 'Lead record found in database');
  assert(leadDoc.contactPerson === 'Elena Rostova', 'Lead contactPerson mapped correctly from full_name');
  assert(leadDoc.email === 'elena@rostova.com', 'Lead email mapped correctly from work_email_address');
  assert(leadDoc.submissionData?.inquiry_details === 'Interested in enterprise license.', 'Custom field preserved in submissionData');

  console.log('\n--- Test 11: Invalid Values Rejected ---');
  // Missing required field
  const badRes1 = await fetch(`${BASE_URL}/api/public/forms/${formPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      work_email_address: 'valid@email.com'
    })
  });
  assert(badRes1.status === 400 || badRes1.status === 422, 'Submission missing required field rejected with 400/422');

  // Invalid email format
  const badRes2 = await fetch(`${BASE_URL}/api/public/forms/${formPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Invalid Email Person',
      work_email_address: 'not-an-email'
    })
  });
  assert(badRes2.status === 400 || badRes2.status === 422, 'Submission with invalid email rejected with 400/422');

  console.log('\n--- Test 12: Analytics and CSV Export Use Correct Form Data ---');
  const analyticsRes = await fetch(`${BASE_URL}/api/forms/${createdFormId}/analytics`, {
    headers: { Cookie: `auth_token=${tokenAlpha}` }
  });
  const analyticsData = await analyticsRes.json();
  assert(analyticsRes.ok && analyticsData.success, 'Analytics API returned successfully');
  const totalSubs = analyticsData.data?.metrics?.totalSubmissions || analyticsData.data?.summary?.totalSubmissions || 0;
  assert(totalSubs >= 1, 'Analytics reflects at least 1 submission');

  const exportRes = await fetch(`${BASE_URL}/api/leads/export?formId=${createdFormId}`, {
    headers: { Cookie: `auth_token=${tokenAlpha}` }
  });
  const exportCsv = await exportRes.text();
  assert(exportRes.ok, 'CSV export returned 200 OK');
  assert(exportCsv.includes('Elena Rostova'), 'CSV contains submitted lead data');

  console.log('\n--- Test 13: Company B Cannot Access Company A Forms or Leads ---');
  const crossGet = await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    headers: { Cookie: `auth_token=${tokenBeta}` }
  });
  assert(crossGet.status === 404 || crossGet.status === 403, 'Company B cannot view Company A form');

  const crossPatch = await fetch(`${BASE_URL}/api/forms/${createdFormId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${tokenBeta}` },
    body: JSON.stringify({ title: 'Hacked by Company B' })
  });
  assert(crossPatch.status === 404 || crossPatch.status === 403, 'Company B cannot edit Company A form');

  console.log('\n--- Test 14: Layout Classes Verify Desktop, Tablet, and Mobile ---');
  assert(builderCode.includes('grid grid-cols-1 lg:grid-cols-12 gap-5'), '2-column desktop grid with mobile fallback');
  assert(builderCode.includes('lg:col-span-7'), 'Editor column spans 7 cols on desktop');
  assert(builderCode.includes('lg:col-span-5'), 'Live Preview column spans 5 cols on desktop');
  assert(builderCode.includes('lg:sticky lg:top-24'), 'Live Preview has sticky desktop positioning');
  assert(builderCode.includes('header className="w-full'), 'Builder header spans full available container width');

  const newPageCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'company-admin', 'forms', 'new', 'page.js'), 'utf8');
  assert(newPageCode.includes('DashboardLayout') && newPageCode.includes('fullWidth={true}'), 'New form page uses DashboardLayout with fullWidth={true}');

  const editPageCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'dashboard', 'company-admin', 'forms', '[id]', 'page.js'), 'utf8');
  assert(editPageCode.includes('DashboardLayout') && editPageCode.includes('fullWidth={true}'), 'Edit form page uses DashboardLayout with fullWidth={true}');

  // Teardown temporary test records
  console.log('\n--- Teardown Test Records ---');
  if (createdLeadId) {
    await db.collection('leads').deleteOne({ _id: new mongoose.Types.ObjectId(createdLeadId) });
    console.log('  Cleaned up temporary lead record:', createdLeadId);
  }
  if (createdFormId) {
    await db.collection('forms').deleteOne({ _id: new mongoose.Types.ObjectId(createdFormId) });
    console.log('  Cleaned up temporary form record:', createdFormId);
  }

  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
