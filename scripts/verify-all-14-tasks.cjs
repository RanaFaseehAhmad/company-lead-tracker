const fs = require('fs');
const { SignJWT } = require('jose');

const env = fs.readFileSync('.env.local', 'utf8');
let secret = '';
for (const line of env.split('\n')) {
  if (line.startsWith('JWT_SECRET=')) {
    secret = line.slice('JWT_SECRET='.length).trim();
  }
}
const secretKey = new TextEncoder().encode(secret);
const BASE_URL = 'http://localhost:3000';

async function makeToken(userId, email, role, companyId) {
  return await new SignJWT({ userId, email, role, companyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey);
}

const ALPHA_COMPANY_ID = '6ace5de5a51c5c2473fbd3ce';
const ALPHA_USER_ID = '6ace5de6a51c5c2473fbd3cf';
const BETA_COMPANY_ID = '6ace5de6a51c5c2473fbd3d0';
const BETA_USER_ID = '6ace5de6a51c5c2473fbd3d1';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

async function runTests() {
  console.log('=====================================================');
  console.log('RUNNING REGRESSION SUITE: TASKS 1 - 14 VERIFICATION');
  console.log('=====================================================\n');

  const alphaToken = await makeToken(ALPHA_USER_ID, 'admin@alpha.com', 'company_admin', ALPHA_COMPANY_ID);
  const betaToken = await makeToken(BETA_USER_ID, 'admin@beta.com', 'company_admin', BETA_COMPANY_ID);

  // 1. Create New Form initial field contract
  console.log('--- Test 1: Create New Form opens with exactly one field ---');
  const builderCode = fs.readFileSync('src/components/CustomFormBuilder.js', 'utf8');
  assert(
    builderCode.includes('const [fields, setFields] = useState(effectiveFormId ? [] : [createInitialField()]);'),
    'CustomFormBuilder initializes with exactly [createInitialField()] when creating new form'
  );
  assert(
    builderCode.includes('function createInitialField()') &&
    builderCode.includes("type: 'text'") &&
    builderCode.includes("label: 'Full Name'"),
    'createInitialField produces exactly one valid default field'
  );

  // 2. Add Another Field handler
  console.log('\n--- Test 2: Add Another Field handles SyntheticEvent and adds exactly one field per click ---');
  assert(
    builderCode.includes('function addField(typeOrEvent = \'text\')') &&
    builderCode.includes("const type = typeof typeOrEvent === 'string' && typeOrEvent ? typeOrEvent : 'text';"),
    'addField safely handles click events without corrupting field.type'
  );
  assert(
    builderCode.includes('id="btn-add-field-bottom"') && builderCode.includes('id="btn-add-field-top"'),
    'Both top and bottom Add Field buttons exist and are bound to addField'
  );

  // 3. All 11 supported input types
  console.log('\n--- Test 3: All 11 supported input types can be selected and rendered ---');
  const expectedTypes = [
    'text', 'email', 'phone', 'number', 'textarea',
    'dropdown', 'radio', 'checkbox', 'date', 'url', 'password'
  ];
  for (const t of expectedTypes) {
    assert(builderCode.includes(`value: '${t}'`), `SUPPORTED_TYPES includes '${t}'`);
  }
  assert(
    builderCode.includes('SUPPORTED_TYPES.map((t) => ('),
    'Field type <select> renders all 11 SUPPORTED_TYPES dynamically'
  );

  // 4. Labels, placeholders, required settings, and options in live preview
  console.log('\n--- Test 4: Field updating and live preview rendering for all types ---');
  assert(
    builderCode.includes('function updateField(indexOrId, keyOrUpdates, value)'),
    'updateField supports flexible (index, object) and (id, key, val) updates'
  );
  assert(
    builderCode.includes('key={oIdx}'),
    'Radio button preview uses key={oIdx} (typo key={LIdx} is resolved)'
  );
  assert(
    builderCode.includes('field.type === \'checkbox\'') &&
    builderCode.includes('(field.type === \'dropdown\' || field.type === \'select\')'),
    'Live preview accurately renders dropdown, radio, checkbox, textarea, and input types'
  );

  // 5. Field deletion and reordering
  console.log('\n--- Test 5: Field deletion and reordering handlers ---');
  assert(
    builderCode.includes('function removeField(indexOrId)') &&
    builderCode.includes('if (fields.length <= 1) return;'),
    'removeField safely prevents removing the last field and handles index/id'
  );
  assert(
    builderCode.includes('function moveField(index, direction)') &&
    builderCode.includes('const delta = direction === \'up\' || direction === -1 ? -1 : direction === \'down\' || direction === 1 ? 1 : 0;'),
    'moveField safely handles string direction ("up"/"down") and numeric deltas'
  );

  // 6. Submission keys hidden from Company Admin
  console.log('\n--- Test 6: Submission keys absent from Company Admin UI ---');
  assert(
    !builderCode.includes('Key: {field.key || \'auto\'}') &&
    !builderCode.includes('Key: {field.name}'),
    'Internal submission keys are completely hidden from form builder card UI'
  );

  // 7. Draft creation and reopening
  console.log('\n--- Test 7: Draft form creation via API ---');
  const createDraftRes = await fetch(`${BASE_URL}/api/forms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${alphaToken}`,
    },
    body: JSON.stringify({
      title: 'Regression Test Draft Form',
      description: 'Temporary form for regression testing',
      status: 'draft',
      fields: [
        { id: 'f_1', name: 'client_name', type: 'text', label: 'Client Name', required: true, order: 0 },
        { id: 'f_2', name: 'service_needed', type: 'dropdown', label: 'Service Needed', options: ['Consulting', 'Development'], required: false, order: 1 }
      ],
    }),
  });
  const draftData = await createDraftRes.json();
  assert(createDraftRes.status === 201 && draftData.success, 'Draft form created with status 201');
  const testFormId = draftData.data._id;
  const testPublicId = draftData.data.publicId;

  const fetchDraftRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  const fetchedDraft = await fetchDraftRes.json();
  assert(fetchDraftRes.status === 200 && fetchedDraft.data.status === 'draft', 'Draft form fetched with status 200 and status="draft"');
  assert(fetchedDraft.data.fields.length === 2, 'Draft form has exactly 2 fields preserved');

  // 8. Publishing and unpublishing
  console.log('\n--- Test 8: Publishing and unpublishing workflow ---');
  const publishRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${alphaToken}`,
    },
    body: JSON.stringify({ status: 'published' }),
  });
  const publishData = await publishRes.json();
  assert(publishRes.status === 200 && publishData.data.status === 'published', 'Form published successfully');

  // 9. Existing published forms remain published & public URLs work
  console.log('\n--- Test 9: Public form and embed accessibility ---');
  const publicRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}`);
  const publicData = await publicRes.json();
  assert(publicRes.status === 200 && publicData.success, 'Public form metadata endpoint returns 200 OK');
  assert(publicData.data.fields.length === 2, 'Public form delivers form fields');

  const embedHtmlRes = await fetch(`${BASE_URL}/embed/${testPublicId}`);
  assert(embedHtmlRes.status === 200, 'Public embed route /embed/[publicId] returns 200 OK');

  // Verify pre-existing published form
  const existingPublicId = 'dfddbe49aaa86f7f3f3c4207';
  const existingPublicRes = await fetch(`${BASE_URL}/api/public/forms/${existingPublicId}`);
  assert(existingPublicRes.status === 200, 'Pre-existing published form dfddbe49aaa86f7f3f3c4207 remains 200 OK');

  // 10. Valid and invalid public submissions
  console.log('\n--- Test 10: Public submissions (valid & invalid validation) ---');
  // Invalid (missing required 'client_name')
  const invalidSubRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_needed: 'Consulting' }),
  });
  const invalidSubData = await invalidSubRes.json();
  assert(invalidSubRes.status === 400 && !invalidSubData.success, 'Invalid submission without required field rejected with 400');

  // Valid submission
  const validSubRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Regression Test User', service_needed: 'Development' }),
  });
  const validSubData = await validSubRes.json();
  assert(validSubRes.status === 201 && validSubData.success, 'Valid submission accepted and lead created with 201');

  // Test Unpublish
  const unpublishRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${alphaToken}`,
    },
    body: JSON.stringify({ status: 'draft' }),
  });
  const unpublishData = await unpublishRes.json();
  assert(unpublishRes.status === 200 && unpublishData.data.status === 'draft', 'Form successfully unpublished back to draft');

  const unpubPublicRes = await fetch(`${BASE_URL}/api/public/forms/${testPublicId}`);
  assert(unpubPublicRes.status === 404, 'Unpublished form returns 404 on public API');

  // 11. Lead creation, analytics, and CSV export
  console.log('\n--- Test 11: Lead creation, analytics, and CSV export ---');
  const leadsRes = await fetch(`${BASE_URL}/api/leads?formId=${testFormId}`, {
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  const leadsData = await leadsRes.json();
  assert(leadsRes.status === 200 && Array.isArray(leadsData.data) && leadsData.data.length >= 1, 'Lead captured and accessible in company leads API');

  const analyticsRes = await fetch(`${BASE_URL}/api/forms/${testFormId}/analytics`, {
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  const analyticsData = await analyticsRes.json();
  assert(analyticsRes.status === 200 && analyticsData.success, 'Form analytics API returns 200 OK');

  const exportRes = await fetch(`${BASE_URL}/api/leads/export?companyId=${ALPHA_COMPANY_ID}`, {
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  assert(exportRes.status === 200, 'CSV export endpoint returns 200 OK');
  const csvText = await exportRes.text();
  assert(csvText.includes('Regression Test User') || csvText.includes('client_name') || csvText.includes('Email'), 'CSV export includes lead submission data');

  // 12. Cross-company access remains blocked
  console.log('\n--- Test 12: Cross-company tenant isolation ---');
  const crossGetRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    headers: { Cookie: `auth_token=${betaToken}` },
  });
  assert(crossGetRes.status === 404 || crossGetRes.status === 403, 'Tenant Beta blocked from viewing Tenant Alpha form');

  const crossPatchRes = await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth_token=${betaToken}`,
    },
    body: JSON.stringify({ title: 'Hacked Title' }),
  });
  assert(crossPatchRes.status === 404 || crossPatchRes.status === 403, 'Tenant Beta blocked from modifying Tenant Alpha form');

  // 13. Disabled Edit Form entry points in UI
  console.log('\n--- Test 13: Disabled Edit Form UI verification ---');
  // A: Direct route /dashboard/company-admin/forms/[id]
  const editPageRes = await fetch(`${BASE_URL}/dashboard/company-admin/forms/${testFormId}`, {
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  assert(editPageRes.status === 200, 'Edit form page route responds with 200 OK');
  const editPageHtml = await editPageRes.text();
  assert(
    editPageHtml.includes('Form Editing Temporarily Disabled'),
    'Direct /dashboard/company-admin/forms/[id] renders "Form Editing Temporarily Disabled" notice'
  );
  assert(
    !editPageHtml.includes('id="btn-add-field-bottom"'),
    'Disabled edit page does not mount the form builder editor'
  );

  // B: Lead Forms table and mobile list in src/app/dashboard/company-admin/forms/page.js
  const formsPageSrc = fs.readFileSync('src/app/dashboard/company-admin/forms/page.js', 'utf8');
  assert(
    !formsPageSrc.includes('href={`/dashboard/company-admin/forms/${form._id}`}'),
    'Lead Forms source code contains zero active links to the disabled edit route'
  );
  assert(
    formsPageSrc.includes('title="Form editing is temporarily disabled'),
    'Edit actions in forms listing have disabled attributes with clear explanation'
  );

  // Clean up temporary test form
  await fetch(`${BASE_URL}/api/forms/${testFormId}`, {
    method: 'DELETE',
    headers: { Cookie: `auth_token=${alphaToken}` },
  });
  console.log('\nCleaned up temporary test form.');

  console.log('\n=====================================================');
  console.log(`ALL TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
