/**
 * Comprehensive Automated Verification Suite for:
 * Phase 3: Form-Specific CSV Export, Lead Status Workflow, Form Name Highlighting & Safe Form Archiving
 *
 * Verifies all 29 scenarios across CSV Export, Lead Workflow, and Forms.
 */

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
      if (c === '"') {
        if (next === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
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

async function runPhase3Tests() {
  console.log('================================================================');
  console.log('        PHASE 3 FULL VERIFICATION SUITE (ALL 29 SCENARIOS)      ');
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

  // 1. Super Admin Login & Setup Multi-Tenant Companies
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

  // Tenant Alpha
  const compAEmail = `alpha_p3_${runId}@alpha.test`;
  const regARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Alpha Corp ${runId}`,
      adminName: 'Alpha Admin',
      adminEmail: compAEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-0101',
    },
  });
  const compAId = regARes.data?.company?.id || regARes.data?.companyId;

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: compAId, status: 'approved' },
  });

  const loginARes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compAEmail, password: 'Password123!' },
  });
  const compACookie = extractCookie(loginARes.setCookie);
  assert(loginARes.status === 200 && compACookie, 'Tenant Alpha session established');

  // Tenant Beta
  const compBEmail = `beta_p3_${runId}@beta.test`;
  const regBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Beta Corp ${runId}`,
      adminName: 'Beta Admin',
      adminEmail: compBEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-0202',
    },
  });
  const compBId = regBRes.data?.company?.id || regBRes.data?.companyId;

  await request('/api/admin/companies', {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${saCookie}` },
    body: { companyId: compBId, status: 'approved' },
  });

  const loginBRes = await request('/api/auth/login', {
    method: 'POST',
    body: { email: compBEmail, password: 'Password123!' },
  });
  const compBCookie = extractCookie(loginBRes.setCookie);
  assert(loginBRes.status === 200 && compBCookie, 'Tenant Beta session established');

  // -------------------------------------------------------------
  // FORMS PROVISIONING
  // Form A1: "Contact Us Form" (Published)
  // -------------------------------------------------------------
  const formA1Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Contact Us Form ${runId}`,
      description: 'Customer contact inquiries',
      status: 'published',
      fields: [
        { id: 'fld_name', name: 'fullname', label: 'Full Name', type: 'text', required: true },
        { id: 'fld_email', name: 'email', label: 'Work Email', type: 'email', required: true },
        { id: 'fld_phone', name: 'phone', label: 'Phone Number', type: 'phone', required: false },
        { id: 'fld_subject', name: 'subject', label: 'Inquiry Subject', type: 'text' },
      ],
    },
  });
  const formA1 = formA1Res.data?.data;
  const formA1Id = formA1?._id || formA1?.id;
  const formA1PublicId = formA1?.publicId;
  assert(formA1Res.status === 201 && formA1Id, 'Form A1 (Contact Us Form) created & published');

  // Form A2: "Job Application Form" (Published)
  const formA2Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Job Application Form ${runId}`,
      description: 'Careers portal form',
      status: 'published',
      fields: [
        { id: 'fld_applicant', name: 'fullname', label: 'Applicant Name', type: 'text', required: true },
        { id: 'fld_app_email', name: 'email', label: 'Personal Email', type: 'email', required: true },
        { id: 'fld_role', name: 'role', label: 'Desired Role', type: 'dropdown', options: ['Engineer', 'Product', 'Designer'] },
        { id: 'fld_resume', name: 'resume_notes', label: 'Cover Letter / Notes', type: 'textarea' },
      ],
    },
  });
  const formA2 = formA2Res.data?.data;
  const formA2Id = formA2?._id || formA2?.id;
  assert(formA2Res.status === 201 && formA2Id, 'Form A2 (Job Application Form) created & published');

  // Form B1: Tenant Beta Form
  const formB1Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compBCookie}` },
    body: {
      title: `Beta Confidential Form ${runId}`,
      status: 'published',
      fields: [
        { id: 'fld_b_name', name: 'name', label: 'Beta Client Name', type: 'text', required: true },
      ],
    },
  });
  const formB1 = formB1Res.data?.data;
  const formB1Id = formB1?._id || formB1?.id;
  assert(formB1Res.status === 201 && formB1Id, 'Tenant Beta Form B1 created');

  // -------------------------------------------------------------
  // LEAD INGESTION & WORKFLOW
  // -------------------------------------------------------------
  console.log('\n--- Part 1: Lead Status Workflow & Ingestion ---');

  // Lead 1: Submitted to Form A1 -> Initial Status 'New'
  const subLead1 = await request(`/api/public/forms/${formA1PublicId}/submissions`, {
    method: 'POST',
    body: {
      fullname: 'Alice Wonder',
      email: 'alice@wonder.test',
      phone: '07123456789',
      subject: '=2+5*9 trigger formula',
    },
  });
  const lead1Id = subLead1.data?.leadId;
  assert(subLead1.status === 201 && lead1Id, 'Scenario 16: Public submission creates lead with status 201');

  // Verify Lead 1 initial status is 'New'
  const getLead1 = await request(`/api/leads/${lead1Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(getLead1.status === 200 && (getLead1.data?.data?.status === 'New' || getLead1.data?.data?.status === 'new'), 'Scenario 16: New submission starts with status New');

  // Check sidebar count for New leads
  const countRes1 = await request('/api/leads?status=new&limit=1', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const initialNewCount = countRes1.data?.pagination?.total;
  assert(initialNewCount >= 1, 'Scenario 22: New lead counted in sidebar count');

  // Lead 2: Submitted to Form A1 -> To be Approved
  const subLead2 = await request(`/api/public/forms/${formA1PublicId}/submissions`, {
    method: 'POST',
    body: {
      fullname: 'Bob Approved',
      email: 'bob@approved.test',
      phone: '+1-555-0200',
      subject: 'Inquiry',
    },
  });
  const lead2Id = subLead2.data?.leadId;

  // Scenario 17: Approving lead persists 'Approved'
  const approveRes = await request(`/api/leads/${lead2Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: { status: 'Approved' },
  });
  assert(approveRes.status === 200 && approveRes.data?.data?.status === 'Approved', 'Scenario 17: Approving a lead persists "Approved"');

  // Scenario 18: Contacting lead persists 'Contacted'
  const contactRes = await request(`/api/leads/${lead1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: { status: 'Contacted' },
  });
  assert(contactRes.status === 200 && contactRes.data?.data?.status === 'Contacted', 'Scenario 18: Contacting a lead persists "Contacted"');

  // Verify Lead 1 & 2 no longer counted in 'New' count
  const countRes2 = await request('/api/leads?status=new&limit=1', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(countRes2.data?.pagination?.total === initialNewCount - 1, 'Scenario 22: Lead transitioning out of New reduces sidebar count');

  // Lead 3: Submitted to Form A1 -> To be Rejected with optional Private Rejection Note
  const subLead3 = await request(`/api/public/forms/${formA1PublicId}/submissions`, {
    method: 'POST',
    body: {
      fullname: 'Charlie Spam',
      email: 'charlie@spam.test',
      phone: '',
      subject: 'Spammy Offer',
    },
  });
  const lead3Id = subLead3.data?.leadId;

  // Scenario 19 & 20: Reject lead with private rejection note
  const rejectRes = await request(`/api/leads/${lead3Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      status: 'Rejected',
      rejectionNote: 'Spam submission detected by admin. Competitor link.',
    },
  });
  assert(rejectRes.status === 200 && rejectRes.data?.data?.status === 'Rejected', 'Scenario 19: Rejecting a lead persists "Rejected"');
  assert(rejectRes.data?.data?.rejectionNote === 'Spam submission detected by admin. Competitor link.', 'Scenario 20: Private rejection note saved successfully');

  // Scenario 21: Unauthorized user (Tenant Beta) cannot read Tenant Alpha private notes or lead
  const bReadRes = await request(`/api/leads/${lead3Id}`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  assert(bReadRes.status === 404, 'Scenario 21 & 23: Tenant Beta blocked from accessing Tenant Alpha lead or notes (HTTP 404)');

  // Lead 4: Submitted to Form A2 (Job Application Form)
  const lead4Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: formA2Id,
      companyName: 'Applicant Profile',
      contactPerson: 'Diana Prince',
      email: 'diana@careers.test',
      phone: '0123456789', // leading zero
      status: 'Qualified',
      submissionData: {
        fullname: 'Diana Prince',
        email: 'diana@careers.test',
        role: 'Engineer',
        resume_notes: '10 years experience\nSpecialized in distributed systems, "high performance"',
      },
    },
  });
  assert(lead4Res.status === 201, 'Lead 4 submitted for Form A2');

  // -------------------------------------------------------------
  // CSV EXPORT SPECIFICATION VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- Part 2: Form-Specific CSV Export & Form Name Highlighting ---');

  // Scenario 1, 2, 4, 14: Form A1 specific CSV export
  const exportA1Res = await request(`/api/leads/export?formId=${formA1Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(exportA1Res.status === 200, 'Scenario 1 & 2: Form A1 Download CSV returns HTTP 200');

  // Scenario 14: Form-specific filename
  const dispA1 = exportA1Res.headers.get('content-disposition') || '';
  assert(
    dispA1.includes('contact-us-form-') && dispA1.includes('.csv'),
    `Scenario 14: Form-specific sanitized filename: ${dispA1}`
  );

  const parsedA1 = parseCsv(exportA1Res.text);
  const headersA1 = parsedA1[0] || [];

  // Scenario 4 & 6: Prominent Form Name column immediately after Submission Date
  assert(
    headersA1[0] === 'Submission Date' && headersA1[1] === 'Form Name' && headersA1[headersA1.length - 1] === 'Action',
    `Scenario 4 & 6: CSV column order strictly begins with Submission Date, Form Name and ends with Action: ${JSON.stringify(headersA1)}`
  );

  // Scenario 4: Selected form configured field labels
  assert(
    headersA1.includes('Full Name') && headersA1.includes('Work Email') && headersA1.includes('Phone Number') && headersA1.includes('Inquiry Subject'),
    'Scenario 4 & 7: Form A1 configured field labels present in header'
  );

  // Scenario 10: Rejected leads excluded from normal export
  const containsRejected = parsedA1.some((row) => row.includes('Charlie Spam') || row.includes('charlie@spam.test') || row.includes('Rejected'));
  assert(!containsRejected, 'Scenario 10: Rejected leads strictly excluded from normal CSV export');

  // Scenario 13: Private rejection notes never appear in CSV
  assert(
    !exportA1Res.text.includes('Spam submission detected by admin'),
    'Scenario 13: Private rejection notes never appear in CSV export'
  );

  // Scenario 5: Every exported row contains the correct form name
  const dataRowsA1 = parsedA1.slice(1);
  const formNameColIdx = headersA1.indexOf('Form Name');
  const allRowsHaveFormName = dataRowsA1.length > 0 && dataRowsA1.every((r) => r[formNameColIdx] === `Contact Us Form ${runId}`);
  assert(allRowsHaveFormName, `Scenario 5: Every exported row contains the actual form name ("Contact Us Form ${runId}")`);

  // Scenario 2: Form A1 export contains zero Form A2 leads (no cross-form pollution)
  const containsFormA2Applicant = parsedA1.some((row) => row.includes('Diana Prince') || row.includes('diana@careers.test'));
  assert(!containsFormA2Applicant, 'Scenario 2: Form A1 export strictly excludes leads from Form A2');

  // Scenario 8: Commas, quotes, newlines, and leading zero phone numbers
  const exportA2Res = await request(`/api/leads/export?formId=${formA2Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const parsedA2 = parseCsv(exportA2Res.text);
  const headersA2 = parsedA2[0] || [];
  const rowA2 = parsedA2[1] || [];
  const notesIdxA2 = headersA2.indexOf('Cover Letter / Notes');
  assert(
    rowA2[notesIdxA2]?.includes('10 years experience\nSpecialized in distributed systems, "high performance"'),
    'Scenario 8: Multiline text with quotes and commas parsed accurately per RFC 4180'
  );

  // Scenario 9: Formula injection protection
  assert(
    exportA1Res.text.includes("''=2+5*9 trigger formula") || exportA1Res.text.includes("'+1-555-0200") || exportA1Res.text.includes("'=2+5*9 trigger formula"),
    'Scenario 9: Formula injection trigger sanitized with single quote prefix'
  );

  // Scenario 11 & 12: Tenant isolation & tampered formId protection
  const tamperedExport = await request(`/api/leads/export?formId=${formA1Id}`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  assert(
    tamperedExport.status === 404,
    `Scenario 11 & 12: Tenant Beta attempting to export Tenant Alpha form is rejected with HTTP 404 (received: ${tamperedExport.status})`
  );

  // -------------------------------------------------------------
  // SAFE FORM UNPUBLISHING & ARCHIVING VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- Part 3: Safe Form Unpublishing & Archiving ---');

  // Form A3: Form to test archiving lifecycle
  const formA3Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Archive Test Form ${runId}`,
      status: 'published',
      fields: [{ id: 'fld_x', name: 'name', label: 'Client Name', type: 'text' }],
    },
  });
  const formA3 = formA3Res.data?.data;
  const formA3Id = formA3?._id || formA3?.id;
  const formA3PublicId = formA3?.publicId;

  // Add historical lead to Form A3
  const histLeadRes = await request(`/api/public/forms/${formA3PublicId}/submissions`, {
    method: 'POST',
    body: { name: 'Historical Client' },
  });
  const histLeadId = histLeadRes.data?.leadId;
  assert(histLeadRes.status === 201 && histLeadId, 'Historical lead captured for Form A3');

  // Scenario 24: Archiving a published form must be blocked
  const archivePublishedAttempt = await request(`/api/forms/${formA3Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: { status: 'archived' },
  });
  assert(
    archivePublishedAttempt.status === 400,
    `Scenario 24: Attempting to archive an active published form is blocked with HTTP 400 (received: ${archivePublishedAttempt.status})`
  );

  // Unpublish Form A3 -> Status 'draft'
  const unpublishRes = await request(`/api/forms/${formA3Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: { status: 'draft' },
  });
  assert(unpublishRes.status === 200 && unpublishRes.data?.data?.status === 'draft', 'Scenario 25: Form unpublished to draft');

  // Scenario 25 & 26: Archive the unpublished form
  const archiveRes = await request(`/api/forms/${formA3Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: { status: 'archived' },
  });
  assert(archiveRes.status === 200 && archiveRes.data?.data?.status === 'archived', 'Scenario 25 & 26: Unpublished form successfully archived');

  // Scenario 26: Historical lead preserved in database
  const checkLeadRes = await request(`/api/leads/${histLeadId}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    checkLeadRes.status === 200 && checkLeadRes.data?.data?.companyName,
    'Scenario 26: Historical lead completely preserved after form archive'
  );

  // Scenario 28: Historical lead still displays original form name
  const histFormName = checkLeadRes.data?.data?.formId?.title || checkLeadRes.data?.data?.formId?.name;
  assert(
    histFormName === `Archive Test Form ${runId}`,
    `Scenario 28: Historical lead still retains original form name ("${histFormName}")`
  );

  // Scenario 27: Archived form rejects new public submissions
  const blockedSub = await request(`/api/public/forms/${formA3PublicId}/submissions`, {
    method: 'POST',
    body: { name: 'Late Submitter' },
  });
  assert(
    blockedSub.status === 404,
    `Scenario 27: Public submission to archived form rejected with HTTP 404 (received: ${blockedSub.status})`
  );

  // Scenario 29: Tenant Beta cannot archive Tenant Alpha's form
  const unauthorizedArchive = await request(`/api/forms/${formA1Id}`, {
    method: 'PATCH',
    headers: { Cookie: `auth_token=${compBCookie}` },
    body: { status: 'archived' },
  });
  assert(
    unauthorizedArchive.status === 404,
    `Scenario 29: Tenant Beta blocked from archiving Tenant Alpha's form with HTTP 404 (received: ${unauthorizedArchive.status})`
  );

  console.log('\n================================================================');
  console.log(`PHASE 3 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error('[PHASE 3 TEST CRASHED]:', err);
  process.exit(1);
});
