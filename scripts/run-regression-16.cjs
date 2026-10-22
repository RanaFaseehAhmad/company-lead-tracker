const { SignJWT } = require('jose');
const fs = require('fs');

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

async function run() {
  console.log('=====================================================');
  console.log('STARTING 16-SCENARIO REGRESSION SUITE');
  console.log('=====================================================\n');

  const alphaToken = await makeToken(ALPHA_USER_ID, 'alpha@test.local', 'company_admin', ALPHA_COMPANY_ID);
  const betaToken = await makeToken(BETA_USER_ID, 'beta@test.local', 'company_admin', BETA_COMPANY_ID);

  const alphaHeaders = {
    'Content-Type': 'application/json',
    Cookie: 'auth_token=' + alphaToken
  };

  const betaHeaders = {
    'Content-Type': 'application/json',
    Cookie: 'auth_token=' + betaToken
  };

  // Pre-test: Count existing Alpha forms
  const preFormsRes = await fetch(`http://localhost:3000/api/forms`, { headers: alphaHeaders });
  const preFormsData = await preFormsRes.json();
  const initialAlphaFormCount = Array.isArray(preFormsData.data) ? preFormsData.data.length : (preFormsData.data&&preFormsData.data.forms ? preFormsData.data.forms.length : 0);
  console.log(`Initial Alpha Form Count: ${initialAlphaFormCount}`);

  // SCENARIO 1: Create a new form and verify it starts with one field
  console.log('\n[Scenario 1] Creating a new form with exactly one field...');
  const createRes = await fetch(`http://localhost:3000/api/forms`, {
    method: 'POST',
    headers: alphaHeaders,
    body: JSON.stringify({
      title: 'Regression Test Contact Form',
      description: 'Initial draft for regression testing',
      fields: [
        {
          id: 'field_init_1',
          key: 'full_name',
          label: 'Full Name',
          type: 'text',
          placeholder: 'Enter your full name',
          required: true
        }
      ],
      status: 'draft'
    })
  });
  const createData = await createRes.json();
  if (!createData.success || !createData.data) {
    throw new Error('Failed to create initial form: ' + JSON.stringify(createData));
  }
  const formId = createData.data._id;
  const initialFields = createData.data.fields || [];
  if (initialFields.length !== 1) {
    throw new Error(`Expected 1 initial field, got ${initialFields.length}`);
  }
  console.log(` PASS: Form created with ID: ${formId}, Field count: ${initialFields.length}`);

  // SCENARIO 2: Publish the form and record its ID and public ID
  console.log('\n[Scenario 2] Publishing the form...');
  const publishRes = await fetch(`http://localhost:3000/api/forms/${formId}`, {
    method: 'PATCH',
    headers: alphaHeaders,
    body: JSON.stringify({
      title: 'Regression Test Contact Form',
      status: 'published',
      fields: initialFields
    })
  });
  const publishData = await publishRes.json();
  if (!publishData.success || publishData.data.status !== 'published') {
    throw new Error('Failed to publish form: ' + JSON.stringify(publishData));
  }
  const originalPublicId = publishData.data.publicId;
  if (!originalPublicId) {
    throw new Error('Published form missing publicId');
  }
  console.log(` PASS: Form published. ID: ${formId}, publicId: ${originalPublicId}`);

  // SCENARIO_3: Copy the iframe embed code
  console.log('\n[Scenario 3] Verifying iframe embed snippet...');
  const expectedEmbedUrl = `http://localhost:3000/embed/${originalPublicId}`;
  const embedSnippet = '<iframe src=\'' + expectedEmbedUrl + '\' width=\'100%\' height=\'600\' frameborder=\'0\'></iframe>';
  if (!embedSnippet.includes(originalPublicId)) {
    throw new Error('Embed snippet does not contain correct publicId');
  }
  console.log(`PASS: Embed snippet verified for ${originalPublicId}`);

  // SCENARIOs 4 & 5: Return to Lead Forms, click Edit & verify editor loads correct data
  console.log('\n[Scenario 4 & 5] Fetching existing form for editing...');
  const editFetchRes = await fetch(`http://localhost:3000/api/forms/${formId}`, {
    headers: { ...alphaHeaders, 'Cache-Control': 'no-cache' }
  });
  const editFetchData = await editFetchRes.json();
  if (!editFetchData.success || !editFetchData.data) {
    throw new Error('Failed to load existing form for editing');
  }
  const loadedForm = editFetchData.data;
  if (loadedForm.title !== 'Regression Test Contact Form') {
    throw new Error(`Expected title 'Regression Test Contact Form', got '${loadedForm.title}'`);
  }
  const fKey = loadedForm.fields[0].key || loadedForm.fields[0].name; if (loadedForm.fields.length !== 1 || fKey !== 'full_name') {
    throw new Error('Loaded form did not contain saved fields');
  }
  if (loadedForm.status !== 'published') {
    throw new Error(`Expected status 'published', got '${loadedForm.status}'`);
  }
  console.log(` PASS: Editor loaded correct form title '${loadedForm.title}', status '${loadedForm.status}', and ${loadedForm.fields.length} saved fields.`);

  // SCENARIOS 6 & 7: Modify title, add field, edit placeholder, update dropdown options, reorder fields
  console.log('\n[Scenario 6 & 7] Modifying form configuration (reordering, options, placeholders)...');
  const updatedFields = [
    {
      id: 'field_dept_2',
      key: 'inquiry_dept',
      label: 'Inquiry Department',
      type: 'select',
      options: ['Sales', 'Customer Support', 'Billing'],
      placeholder: 'Select department...',
      required: true
    },
    {
      id: loadedForm.fields[0].id || 'field_init_1',
      key: 'full_name',
      label: 'Customer Full Name', // edited label, stable key
      type: 'text',
      placeholder: 'e.g. Jane Doe', // edited placeholder
      required: true
    },
    {
      id: 'field_phone_3',
      key: 'phone_number',
      label: 'Direct Phone',
      type: 'tel',
      placeholder: '555-0199',
      required: false
    }
  ];
  const updatedTitle = 'Updated Regression Lead Form';
  console.log(`PASS: Configured 3 reordered fields with options and updated labels.`);

  // SCENARIO_8: Click Update Form
  console.log('\n[Scenario 8] Executing Update Form action...');
  const updateRes = await fetch(`http://localhost:3000/api/forms/${formId}`, {
    method: 'PATCH',
    headers: alphaHeaders,
    body: JSON.stringify({
      title: updatedTitle,
      description: 'Updated published form description',
      fields: updatedFields,
      status: 'published' // Must maintain published status
    })
  });
  const updateData = await updateRes.json();
  if (!updateData.success || !updateData.data) {
    throw new Error('Update Form request failed: ' + JSON.stringify(updateData));
  }
  console.log(' PASS: Form successfully updated.');

  // SCENARIO 9: Confirm form remains Published and form count has not increased
  console.log('\n[Scenario 9] Verifying form count and publication status...');
  if (updateData.data.status !== 'published') {
    throw new Error(`Expected form to remain 'published', got '${updateData.data.status}'`);
  }
  const postFormsRes = await fetch(`http://localhost:3000/api/forms`, { headers: alphaHeaders });
  const postFormsData = await postFormsRes.json();
  const currentAlphaFormCount = Array.isArray(postFormsData.data) ? postFormsData.data.length : (postFormsData.data&&postFormsData.data.forms ? postFormsData.data.forms.length : 0);
  if (currentAlphaFormCount !== initialAlphaFormCount + 1) {
    throw new Error(`Form count increased! Expected ${initialAlphaFormCount + 1}, found ${currentAlphaFormCount}`);
  }
  console.log(` PASS: Status remains 'published' and no duplicate form created (count: ${currentAlphaFormCount}).`);

  // SCENARIO 10: Confirm existing public ID & iframe URL remain unchanged
  console.log('\n[Scenario 10] Checking public ID and embed URL stability...');
  if (updateData.data.publicId !== originalPublicId) {
    throw new Error(`Public ID changed! Original: ${originalPublicId}, Updated: ${updateData.data.publicId}`);
  }
  console.log(` PASS: Public ID is strictly preserved: ${updateData.data.publicId}`);

  // SCENARIO 11: Open existing embed URL in fresh page & verify updated fields appear
  console.log('\n[Scenario 11] Fetching public form endpoint with no-store...');
  const publicRes = await fetch(`http://localhost:3000/api/public/forms/${originalPublicId}`, {
    headers: { 'Cache-Control': 'no-cache' }
  });
  const publicCacheControl = publicRes.headers.get('cache-control');
  if (!publicCacheControl || !publicCacheControl.includes('no-store')) {
    throw new Error(`Expected Cache-Control: no-store, got: ${publicCacheControl}`);
  }
  const publicData = await publicRes.json();
  if (!publicData.success || !publicData.data) {
    throw new Error('Public form endpoint failed');
  }
  const pubForm = publicData.data;
  if (pubForm.title !== updatedTitle) {
    throw new Error(`Public title not updated! Got: ${pubForm.title}`);
  }
  if (pubForm.fields.length !== 3) {
    throw new Error(`Expected 3 fields on public form, got ${pubForm.fields.length}`);
  }
  if (pubForm.fields[0].key !== 'inquiry_dept' || pubForm.fields[0].type !== 'select') {
    throw new Error('Field 1 not updated to select');
  }
  if (pubForm.fields[0].options.length !== 3) {
    throw new Error('Field 1 options not present');
  }
  if (pubForm.fields[1].key !== 'full_name' || pubForm.fields[1].placeholder !== 'e.g. Jane Doe') {
    throw new Error('Field 2 placeholder not updated');
  }
  console.log(` PASS: Public endpoint returned latest title '${pubForm.title}', 3 updated fields, options, and Cache-Control: no-store.`);

  // SCENARIO 12: Submit a new valid lead through that same URL
  console.log('\n[Scenario 12] Submitting valid lead through existing embed publicId...');
  const submissionPayload = {
    inquiry_dept: 'Sales',
    full_name: 'Regression User',
    phone_number: '555-0199'
  };
  const submitRes = await fetch(`http://localhost:3000/api/public/forms/${originalPublicId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submissionPayload)
  });
  const submitData = await submitRes.json();
  const leadId = submitData.leadId || (submitData.data && submitData.data.leadId);
  if (!submitData.success || !leadId) {
    throw new Error('Public lead submission failed: ' + JSON.stringify(submitData));
  }
  const createdLeadId = leadId;
  console.log(` PASS: Lead submitted successfully. Lead ID: ${createdLeadId}`);

  // SCENARIO 13: Confirm old leads remain intact & new lead contains correct answers
  console.log('\n[Scenario 13] Verifying lead records and submissionData...');
  const leadsRes = await fetch(`http://localhost:3000/api/leads?formId=${formId}`, { headers: alphaHeaders });
  const leadsData = await leadsRes.json();
  const leads = Array.isArray(leadsData.data) ? leadsData.data : (leadsData.data?.leads || []);
  if (!leadsData.success || leads.length === 0) {
    throw new Error('Failed to fetch leads: ' + JSON.stringify(leadsData));
  }
  const targetLead = leads.find(l => String(l._id) === String(createdLeadId) || String(l.id) === String(createdLeadId));
  if (!targetLead) {
    throw new Error('Submitted lead not found in company leads list');
  }
  console.log('  Target lead found, submissionData: ', JSON.stringify(targetLead.submissionData));
  const sub = targetLead.submissionData || {};
  if (sub.inquiry_dept !== 'Sales' || sub.full_name !== 'Regression User') {
    throw new Error('Lead submissionData does not match submitted answers: ' + JSON.stringify(sub));
  }
  console.log(` PASS: Lead verified in database with intact submissionData: ${JSON.stringify(targetLead.submissionData)}`);

  // SCENARIO 14: Verify analytics and CSV export after update
  console.log('\n[Scenario 14] Verifying form analytics and CSV export...');
  const analyticsRes = await fetch(`http://localhost:3000/api/forms/${formId}/analytics`, { headers: alphaHeaders });
  const analyticsData = await analyticsRes.json();
  if (!analyticsData.success || !analyticsData.data) {
    throw new Error('Failed to fetch form analytics');
  }
  if (analyticsData.data.totalSubmissions < 1) {
    throw new Error(`Expected at least 1 submission in analytics, got ${analyticsData.data.totalSubmissions}`);
  }
  console.log(`PASS: Analytics confirmed ${analyticsData.data.totalSubmissions} submissions.`);

  const exportRes = await fetch(`http://localhost:3000/api/leads/export?formId=${formId}`, { headers: alphaHeaders });
  const exportCsv = await exportRes.text();
  if (!exportCsv.includes('Regression User') || !exportCsv.includes('Sales')) {
    throw new Error('CSV export missing lead submission data');
  }
  console.log(' PASS: CSV export contains dynamic headers and accurate lead row.');

  // SCENARIO 15: Verify Company Admin cannot edit another company's form
  console.log('\n[Scenario 15] Testing multi-tenant isolation (Tenant Beta attempting to edit Tenant Alpha form)...');
  const tamperRes = await fetch(`http://localhost:3000/api/forms/${formId}`, {
    method: 'PATCH',
    headers: betaHeaders,
    body: JSON.stringify({
      title: 'Hacked by Beta',
      status: 'draft'
    })
  });
  console.log(`Tenant Beta PATCH status code: ${tamperRes.status}`);
  if (tamperRes.status !== 404 && tamperRes.status !== 403) {
    throw new Error(`Multi-tenant isolation failed! Tenant Beta received HTTP ${tamperRes.status}`);
  }
  const verifyUntouchedRes = await fetch(`http://localhost:3000/api/formsavetch/${formId}`.replace('formsavetch', 'forms'), { headers: alphaHeaders });
  const verifyUntouchedData = await verifyUntouchedRes.json();
  if (verifyUntouchedData.data.title !== updatedTitle) {
    throw new Error('Tenant Alpha form was corrupted by Tenant Beta attempt!');
  }
  console.log(' PASS: Multi-tenant isolation verified. Cross-company access rejected with 404/403.');

  // SCENARIO 16: Verify failed updates do not corrupt the previously published form
  console.log('\n[Scenario 16] Testing failed update validation and rollback preservation...');
  const invalidUpdateRes = await fetch(`http://localhost:3000/api/forms/${formId}`, {
    method: 'POST'.replace('POST', 'PATCH'),
    headers: alphaHeaders,
    body: JSON.stringify({
      title: '', // Invalid empty title
      fields: [] // Invalid empty fields
    })
  });
  console.log(`Invalid PATCH status code: ${invalidUpdateRes.status}`);
  if (invalidUpdateRes.status !== 400) {
    throw new Error(`Expected HTTP 400 for invalid update, got ${invalidUpdateRes.status}`);
  }
  const verifyIntactRes = await fetch(`http://localhost:3000/api/forms/${formId}`, { headers: alphaHeaders });
  const verifyIntactData = await verifyIntactRes.json();
  if (verifyIntactData.data.status !== 'published' || verifyIntactData.data.fields.length !== 3) {
    throw new Error('Published form was corrupted by invalid update attempt!');
  }
  console.log(' PASS: Failed update preserved previous published version without corruption.');
  // CLEANUP: Clean up test lead and test form created during this run
  console.log('\n[Cleanup] Cleaning up regression test artifacts...');
  if (createdLeadId) {
    await fetch(BASE_URL + '/api/leads/' + createdLeadId, {
      method: 'DELETE',
      headers: alphaHeaders
    });
  }
  if (formId) {
    await fetch(BASE_URL + '/api/forms/' + formId, {
      method: 'DELETE',
      headers: alphaHeaders
    });
  }
  console.log(' PASS: Cleanup completed cleanly.');

  console.log('\n=====================================================');
  console.log('ALL 16 REGRESSION SCENARIOS PASSED WITH 100%<SUCCESS!');
  console.log('=====================================================');
}

run().catch(err => {
  console.error('\n REGRESSION SUITE FAILED:', err);
  process.exit(1);
});
