const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { ...options, headers });
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
  return { status: res.status, headers: res.headers, data, text, rawBuffer, setCookie };
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

// RFC 4180 CSV Parser
function parseCsv(csvText) {
  const clean = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  const lines = [];
  let currentField = '';
  let inQuotes = false;
  let currentLine = [];

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        currentField += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        currentLine.push(currentField);
        currentField = '';
      } else if (c === '\r' && next === '\n') {
        currentLine.push(currentField);
        currentField = '';
        lines.push(currentLine);
        currentLine = [];
        i++;
      } else if (c === '\n' || c === '\r') {
        currentLine.push(currentField);
        currentField = '';
        lines.push(currentLine);
        currentLine = [];
      } else {
        currentField += c;
      }
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField);
    lines.push(currentLine);
  }

  return lines.filter((l) => l.length > 1 || (l.length === 1 && l[0] !== ''));
}

async function run() {
  console.log('================================================================');
  console.log('   FULL VERIFICATION SUITE: LEAD MANAGEMENT, CSV, STATUS, FORMS  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  const testId = Date.now().toString().slice(-6);

  // 1. Super Admin Login
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@companytracker.test',
      password: 'SuperAdminTest123!',
      requiredRole: 'super_admin',
    },
  });
  const saCookie = extractCookie(saLogin.setCookie);
  assert(saLogin.status === 200 && saCookie, 'Admin authenticated');

  // Tenant Alpha Company Admin (created as approved via Super Admin)
  const compAEmail = `alpha_${testId}@companylead.com`;
  const createARes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: {
      companyName: `Alpha Corp ${testId}`,
      contactName: `Alpha Admin ${testId}`,
      contactEmail: compAEmail,
      status: 'approved',
      adminName: `Alpha Admin ${testId}`,
      adminEmail: compAEmail,
      adminPassword: 'AlphaPassword123!',
    },
  });
  assert(createARes.status === 201, 'Tenant Alpha created as approved');

  // Login as Tenant Alpha
  const loginA = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAEmail, password: 'AlphaPassword123!' },
  });
  const alphaCookie = extractCookie(loginA.setCookie);
  assert(loginA.status === 200 && alphaCookie, 'Tenant Alpha session established');

  // Tenant Beta Company Admin (for cross-tenant checks)
  const compBEmail = `beta_${testId}@companylead.com`;
  const createBRes = await request('/api/admin/companies', {
    method: 'POST',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: {
      companyName: `Beta Corp ${testId}`,
      contactName: `Beta Admin ${testId}`,
      contactEmail: compBEmail,
      status: 'approved',
      adminName: `Beta Admin ${testId}`,
      adminEmail: compBEmail,
      adminPassword: 'BetaPassword123!',
    },
  });
  assert(createBRes.status === 201, 'Tenant Beta created as approved');

  // Login as Tenant Beta
  const loginB = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compBEmail, password: 'BetaPassword123!' },
  });
  const betaCookie = extractCookie(loginB.setCookie);
  assert(loginB.status === 200 && betaCookie, 'Tenant Beta session established');

  // 2. Create and Publish Form A1
  const formA1Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: {
      name: `Contact Form ${testId}`,
      description: 'Main inquiry form',
      status: 'published',
      fields: [
        { label: 'Full Name', type: 'text', required: true },
        { label: 'Work Email', type: 'email', required: true },
        { label: 'Phone Number', type: 'phone', required: false },
        { label: 'Message', type: 'textarea', required: false },
      ],
    },
  });
  assert(formA1Res.status === 201 && formA1Res.data.data.publicId, 'Form A1 created and published');
  const formA1 = formA1Res.data.data;

  // 3. Submit 4 Leads to Form A1
  console.log('\n--- Phase 1: Form Name & Submission Logic ---');
  // Lead 1: Ali Ahmed
  const sub1 = await request(`/api/public/forms/${formA1.publicId}/submissions`, {
    method: 'POST',
    body: {
      full_name: 'Ali Ahmed',
      work_email: 'ali@example.com',
      phone_number: '03001234567',
      message: 'Hello, I want a product demo.',
    },
  });
  assert(sub1.status === 201, 'Lead 1 submitted successfully');
  const lead1Id = sub1.data.leadId;

  // Lead 2: Sarah Khan
  const sub2 = await request(`/api/public/forms/${formA1.publicId}/submissions`, {
    method: 'POST',
    body: {
      full_name: 'Sarah Khan',
      work_email: 'sarah@example.com',
      phone_number: '03119876543',
      message: 'Pricing information requested.',
    },
  });
  assert(sub2.status === 201, 'Lead 2 submitted successfully');
  const lead2Id = sub2.data.leadId;

  // Lead 3: John Doe
  const sub3 = await request(`/api/public/forms/${formA1.publicId}/submissions`, {
    method: 'POST',
    body: {
      full_name: 'John Doe',
      work_email: 'john@example.com',
      phone_number: '03225555555',
      message: 'Feature inquiry.',
    },
  });
  assert(sub3.status === 201, 'Lead 3 submitted successfully');
  const lead3Id = sub3.data.leadId;

  // Lead 4: Ineligible Visitor
  const sub4 = await request(`/api/public/forms/${formA1.publicId}/submissions`, {
    method: 'POST',
    body: {
      full_name: 'Spam User',
      work_email: 'spam@bot.com',
      phone_number: '0000000000',
      message: '=cmd|"/C calc"!A0',
    },
  });
  assert(sub4.status === 201, 'Lead 4 submitted successfully');
  const lead4Id = sub4.data.leadId;

  // Verify Leads API returns Form Name
  const leadsApiRes = await request('/api/leads', {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  assert(leadsApiRes.status === 200, 'Leads API returns 200');
  const leadList = leadsApiRes.data?.data || [];
  const fetchedLead1 = leadList.find((l) => l._id === lead1Id);
  assert(
    fetchedLead1 && (fetchedLead1.formName === `Contact Form ${testId}` || fetchedLead1.form?.name === `Contact Form ${testId}`),
    `Lead 1 Form Name accurately resolved: "${fetchedLead1?.formName || fetchedLead1?.form?.name}"`
  );
  assert(
    fetchedLead1.status === 'New',
    `Lead 1 initial status is canonical New (displays as New / Pending)`
  );

  // 4. Status Workflow & Notes
  console.log('\n--- Phase 5 & 6: Status Workflow & Notes ---');
  // Update Lead 1 -> Approved
  const patch1 = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'Approved' },
  });
  assert(patch1.status === 200 && patch1.data.data.status === 'Approved', 'Lead 1 status updated to Approved');

  // Update Lead 2 -> Contacted with Contact Note
  const patch2 = await request(`/api/leads/${lead2Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'Contacted', contactNote: 'Called customer; requested callback tomorrow.' },
  });
  assert(
    patch2.status === 200 &&
      patch2.data.data.status === 'Contacted' &&
      patch2.data.data.contactNote === 'Called customer; requested callback tomorrow.',
    'Lead 2 status updated to Contacted with Contact Note'
  );

  // Update Lead 4 -> Rejected with Rejection Note
  const patch4 = await request(`/api/leads/${lead4Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'Rejected', rejectionNote: 'Spam submission with invalid phone.' },
  });
  assert(
    patch4.status === 200 &&
      patch4.data.data.status === 'Rejected' &&
      patch4.data.data.rejectionNote === 'Spam submission with invalid phone.',
    'Lead 4 status updated to Rejected with Rejection Note'
  );

  // Verify status update can happen again (not permanently locked)
  const patch1Again = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'Contacted', contactNote: 'Second contact attempt' },
  });
  assert(patch1Again.status === 200 && patch1Again.data.data.status === 'Contacted', 'Lead 1 can be updated again at any time');

  // Move Lead 1 back to New / Pending
  const patch1Reset = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'New / Pending' },
  });
  assert(patch1Reset.status === 200 && (patch1Reset.data.data.status === 'New' || patch1Reset.data.data.status === 'New / Pending'), 'Lead 1 can be moved back to New / Pending');

  // Verify existing notes are preserved when status changes
  const checkLead2 = await request(`/api/leads/${lead2Id}`, {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  assert(
    checkLead2.data.data.contactNote === 'Called customer; requested callback tomorrow.',
    'Lead 2 contact note persists accurately'
  );

  // 5. Sidebar New Leads Count
  console.log('\n--- Phase 7: Sidebar Count ---');
  const sidebarCountRes = await request('/api/leads?status=new&limit=1', {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  assert(sidebarCountRes.status === 200, 'Sidebar query returns 200');
  // Lead 1 is back to New, Lead 3 is New -> count should be 2
  assert(sidebarCountRes.data.pagination.total === 2, `Sidebar count matches New / Pending leads (expected 2, got ${sidebarCountRes.data.pagination.total})`);

  // 6. Individual Lead CSV Export
  console.log('\n--- Phase 2 & 4: Individual Lead CSV Export ---');
  const singleCsvRes = await request(`/api/leads/export?leadId=${lead2Id}`, {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  assert(singleCsvRes.status === 200, 'Individual lead export returns 200 OK');
  const singleDisposition = singleCsvRes.headers.get('content-disposition') || '';
  assert(
    singleDisposition.includes('.csv'),
    `Individual filename sanitized: ${singleDisposition}`
  );
  const parsedSingle = parseCsv(singleCsvRes.text);
  assert(parsedSingle.length === 2, `Individual export contains exactly header + 1 row (got ${parsedSingle.length} rows)`);
  const singleHeaderRow = parsedSingle[0];
  assert(
    singleHeaderRow[0] === 'Submission Date' &&
      singleHeaderRow[1] === 'Form Name' &&
      singleHeaderRow.includes('Status') &&
      singleHeaderRow.includes('Contact Note') &&
      singleHeaderRow.includes('Rejection Note'),
    `Individual CSV header matches schema: ${JSON.stringify(singleHeaderRow)}`
  );
  assert(
    parsedSingle[1].includes('Sarah Khan') && parsedSingle[1].includes('Called customer; requested callback tomorrow.'),
    'Individual CSV contains correct lead details and contact note'
  );

  // Cross-tenant protection on individual lead export
  const crossLeadRes = await request(`/api/leads/export?leadId=${lead2Id}`, {
    method: 'GET',
    headers: { Cookie: `auth_token=${betaCookie}` },
  });
  assert(crossLeadRes.status === 404, `Tenant Beta blocked from exporting Tenant Alpha lead (got ${crossLeadRes.status})`);

  // 7. Form-Level CSV Export (Includes all statuses including rejected)
  console.log('\n--- Phase 3 & 4: Form-Level CSV Export ---');
  const formCsvRes = await request(`/api/leads/export?formId=${formA1._id}`, {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  assert(formCsvRes.status === 200, 'Form-level export returns 200 OK');
  const formDisposition = formCsvRes.headers.get('content-disposition') || '';
  assert(
    formDisposition.includes('contact-form-'),
    `Form-level filename formatted correctly: ${formDisposition}`
  );
  const parsedFormCsv = parseCsv(formCsvRes.text);
  // Header + 4 leads = 5 rows
  assert(parsedFormCsv.length === 5, `Form-level CSV contains all 4 leads including rejected (got ${parsedFormCsv.length} rows)`);
  assert(formCsvRes.text.includes('"Rejected"'), 'Form-level CSV includes Rejected status lead');
  assert(formCsvRes.text.includes('"Spam submission with invalid phone."'), 'Form-level CSV includes Rejection Note');
  assert(formCsvRes.text.includes("'03001234567"), 'Leading zeros preserved for phone numbers');
  assert(formCsvRes.text.includes("'=cmd|"), 'Formula injection neutralized with single quote');

  // Cross-tenant protection on form-level export
  const crossFormRes = await request(`/api/leads/export?formId=${formA1._id}`, {
    method: 'GET',
    headers: { Cookie: `auth_token=${betaCookie}` },
  });
  assert(crossFormRes.status === 404, `Tenant Beta blocked from exporting Tenant Alpha form (got ${crossFormRes.status})`);

  // 8. Safe Form Archiving
  console.log('\n--- Phase 8: Safe Form Archiving ---');
  // Cannot archive published form
  const archivePub = await request(`/api/forms/${formA1._id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'archived' },
  });
  assert(archivePub.status === 400, `Cannot archive active published form (HTTP ${archivePub.status})`);

  // Unpublish first
  const unpub = await request(`/api/forms/${formA1._id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'draft' },
  });
  assert(unpub.status === 200, 'Form successfully unpublished to draft');

  // Now archive
  const archiveRes = await request(`/api/forms/${formA1._id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${alphaCookie}` },
    body: { status: 'archived' },
  });
  assert(archiveRes.status === 200, 'Unpublished form successfully archived');

  // Historical leads still display original form name
  const postArchiveLeads = await request('/api/leads', {
    method: 'GET',
    headers: { Cookie: `auth_token=${alphaCookie}` },
  });
  const archivedLead = (postArchiveLeads.data?.data || []).find((l) => l._id === lead1Id);
  assert(
    archivedLead && (archivedLead.formName === `Contact Form ${testId}` || archivedLead.form?.name === `Contact Form ${testId}`),
    `Historical lead retains original form name after archive: "${archivedLead?.formName || archivedLead?.form?.name}"`
  );

  // Public submissions to archived form rejected
  const archivedSub = await request(`/api/public/forms/${formA1.publicId}/submissions`, {
    method: 'POST',
    body: { full_name: 'Late Visitor' },
  });
  assert(archivedSub.status === 404, `Public submissions to archived form blocked with HTTP 404 (got ${archivedSub.status})`);

  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
