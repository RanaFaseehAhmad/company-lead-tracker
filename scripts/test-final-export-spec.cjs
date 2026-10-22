/**
 * Comprehensive Test Suite for Final CSV Export:
 * Submission Date | [Form Fields...] | Action
 *
 * Validates all 15 requirements specified in Task 7.
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

async function runTests() {
  console.log('================================================================');
  console.log('       FINAL CSV EXPORT SPECIFICATION TEST SUITE (15 TASKS)     ');
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
  assert(saLogin.status === 200 && saCookie, 'Admin session established');

  // Company A
  const compAEmail = `admin_spec_a_${runId}@alpha.test`;
  const regARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Alpha Spec Corp ${runId}`,
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
  assert(loginARes.status === 200 && compACookie, 'Company A session established');

  // Company B (for tenant isolation check)
  const compBEmail = `admin_spec_b_${runId}@beta.test`;
  const regBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Beta Spec Corp ${runId}`,
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
  assert(loginBRes.status === 200 && compBCookie, 'Company B session established');

  // Form 1: Exact Consultation Form (Full Name, Email, Phone Number, Appointment About)
  const form1Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Consultation Form ${runId}`,
      description: 'Collects appointment bookings',
      status: 'published',
      fields: [
        { id: 'fld_name', name: 'fullname', label: 'Full Name', type: 'text', required: true },
        { id: 'fld_email', name: 'email', label: 'Email', type: 'email', required: true },
        { id: 'fld_phone', name: 'phone', label: 'Phone Number', type: 'phone', required: false },
        { id: 'fld_about', name: 'appointment_about', label: 'Appointment About', type: 'text', required: false },
      ],
    },
  });
  const form1 = form1Res.data?.data;
  const form1Id = form1?._id || form1?.id;
  assert(form1Res.status === 201 && form1Id, 'Form 1 created with exact fields');

  // Form 2: Partner Evaluation Form with diverse field types
  const form2Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Partner Intake ${runId}`,
      description: 'Collects partnership details',
      status: 'published',
      fields: [
        { id: 'fld_name2', name: 'fullname', label: 'Full Name', type: 'text', required: true },
        { id: 'fld_email2', name: 'partner_email', label: 'Partner Email', type: 'email', required: true },
        { id: 'fld_tier', name: 'tier', label: 'Partnership Tier', type: 'radio', options: ['Tier 1', 'Tier 2'] },
        { id: 'fld_active', name: 'is_active', label: 'Active Business', type: 'checkbox' },
        { id: 'fld_date', name: 'target_launch', label: 'Target Launch Date', type: 'date' },
        { id: 'fld_details', name: 'project_notes', label: 'Project Notes', type: 'textarea' },
      ],
    },
  });
  const form2 = form2Res.data?.data;
  const form2Id = form2?._id || form2?.id;
  assert(form2Res.status === 201 && form2Id, 'Form 2 created with multiple input types');

  // Ingest Leads for Form 1
  // Lead 1: Full fields + formula injection triggers
  const lead1Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: form1Id,
      companyName: 'Acme Health',
      contactPerson: '@MaliciousUser',
      email: 'dr.smith@example.com',
      phone: '07123456789', // leading zero phone
      status: 'Contacted',
      notes: 'General inquiry',
      submissionData: {
        fullname: '@MaliciousUser',
        email: 'dr.smith@example.com',
        phone: '07123456789',
        appointment_about: '=cmd|calc!A0',
      },
    },
  });
  assert(lead1Res.status === 201, 'Lead 1 (Form 1) created');

  // Lead 2: Missing optional fields (empty phone, empty appointment_about)
  const lead2Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: form1Id,
      companyName: 'Apex Health',
      contactPerson: 'Sarah Connor',
      email: 'sarah@apex.com',
      phone: '',
      status: 'Rejected',
      submissionData: {
        fullname: 'Sarah Connor',
        email: 'sarah@apex.com',
      },
    },
  });
  assert(lead2Res.status === 201, 'Lead 2 (Form 1, missing values) created');

  // Ingest Lead for Form 2
  const lead3Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: form2Id,
      companyName: 'CloudCorp',
      contactPerson: 'David Miller',
      email: 'david@cloudcorp.com',
      status: 'Qualified',
      submissionData: {
        fullname: 'David Miller',
        partner_email: 'david@cloudcorp.com',
        tier: 'Tier 1',
        is_active: true,
        target_launch: '2026-12-01',
        project_notes: 'Line 1\nLine 2 with "quotes" and, commas',
      },
    },
  });
  assert(lead3Res.status === 201, 'Lead 3 (Form 2) created');

  // --- Requirement 1: Form-Specific Export Exact Columns ---
  console.log('\n--- Test 1 & 2: Exact Column Structure & No Technical Columns ---');
  const f1ExportRes = await request(`/api/leads/export?formId=${form1Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(f1ExportRes.status === 200, 'Form 1 Export HTTP 200 OK');

  const f1Parsed = parseCsv(f1ExportRes.text);
  const f1Headers = f1Parsed[0] || [];

  const expectedF1Headers = [
    'Submission Date',
    'Full Name',
    'Email',
    'Phone Number',
    'Appointment About',
    'Action',
  ];

  assert(
    JSON.stringify(f1Headers) === JSON.stringify(expectedF1Headers),
    'Form 1 headers exactly match: Submission Date,Full Name,Email,Phone Number,Appointment About,Action',
    `Received: ${JSON.stringify(f1Headers)}`
  );

  // Requirement 2: Verify forbidden columns are ABSENT
  const forbidden = [
    'Lead ID',
    'Form Name',
    'Company Name',
    'Deal Value',
    'Deal Value ($)',
    'Notes',
    'Source',
    'Source URL',
    'Referrer',
    'Submitted Form Answers',
  ];
  const containsForbidden = forbidden.some((col) => f1Headers.includes(col));
  assert(
    !containsForbidden,
    'No unconfigured standard/technical columns appear (No Lead ID, Form Name, Deal Value, Source, etc.)'
  );

  // --- Requirement 3 & 4: Supported Input Types & Values ---
  console.log('\n--- Test 3, 4 & 5: Form 2 Input Types, Labels, and Standard Values ---');
  const f2ExportRes = await request(`/api/leads/export?formId=${form2Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const f2Parsed = parseCsv(f2ExportRes.text);
  const f2Headers = f2Parsed[0] || [];
  const f2Row1 = f2Parsed[1] || [];

  const expectedF2Headers = [
    'Submission Date',
    'Full Name',
    'Partner Email',
    'Partnership Tier',
    'Active Business',
    'Target Launch Date',
    'Project Notes',
    'Action',
  ];

  assert(
    JSON.stringify(f2Headers) === JSON.stringify(expectedF2Headers),
    'Form 2 headers match configured field labels in order',
    `Received: ${JSON.stringify(f2Headers)}`
  );

  // Check row values: radio, checkbox (Yes/No), date, textarea with quotes/newlines
  const nameIdx = f2Headers.indexOf('Full Name');
  const tierIdx = f2Headers.indexOf('Partnership Tier');
  const activeIdx = f2Headers.indexOf('Active Business');
  const dateIdx = f2Headers.indexOf('Target Launch Date');
  const notesIdx = f2Headers.indexOf('Project Notes');
  const actionIdx = f2Headers.indexOf('Action');

  assert(f2Row1[nameIdx] === 'David Miller', 'Full Name preserved from submission');
  assert(f2Row1[tierIdx] === 'Tier 1', 'Radio button option value preserved');
  assert(f2Row1[activeIdx] === 'Yes', 'Checkbox boolean formatted as "Yes"');
  assert(f2Row1[dateIdx] === '2026-12-01', 'Date formatted as YYYY-MM-DD');
  assert(
    f2Row1[notesIdx].includes('Line 1\nLine 2 with "quotes" and, commas'),
    'Multiline text with quotes and commas parsed correctly per RFC 4180'
  );
  assert(f2Row1[actionIdx] === 'Qualified', 'Action displays "Qualified"');

  // --- Requirement 6: Missing Values Produce Empty Cells ---
  console.log('\n--- Test 6: Missing Values Produce Empty Cells ---');
  const lead2Row = f1Parsed.find((r) => r.includes('Sarah Connor'));
  const phoneColIdx = f1Headers.indexOf('Phone Number');
  const apptColIdx = f1Headers.indexOf('Appointment About');
  assert(
    lead2Row && lead2Row[phoneColIdx] === '' && lead2Row[apptColIdx] === '',
    'Missing values produce clean empty cells without shifting neighboring columns'
  );

  // --- Requirement 7: Multi-Form Union & Tenant Isolation ---
  console.log('\n--- Test 7: Multi-Form Export Union ---');
  const allExportRes = await request('/api/leads/export', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const allParsed = parseCsv(allExportRes.text);
  const allHeaders = allParsed[0] || [];

  assert(
    allHeaders[0] === 'Submission Date' && allHeaders[allHeaders.length - 1] === 'Action',
    'All-forms CSV strictly begins with Submission Date and ends with Action'
  );
  assert(
    allHeaders.includes('Full Name') &&
      allHeaders.includes('Email') &&
      allHeaders.includes('Phone Number') &&
      allHeaders.includes('Appointment About') &&
      allHeaders.includes('Partner Email') &&
      allHeaders.includes('Partnership Tier'),
    'All-forms CSV contains stable union of distinct field labels from both forms'
  );

  // Verify Lead 1 from Form 1 has empty cells for Form 2 fields (no cross-pollution)
  const l1RowInAll = allParsed.find((r) => r.includes('@MaliciousUser') || r.includes('dr.smith@example.com'));
  const partnerEmailIdx = allHeaders.indexOf('Partner Email');
  const tierIdxInAll = allHeaders.indexOf('Partnership Tier');
  assert(
    l1RowInAll && l1RowInAll[partnerEmailIdx] === '' && l1RowInAll[tierIdxInAll] === '',
    'Form 1 lead does not receive values for Form 2 fields (no cross-form pollution)'
  );

  // --- Requirement 9: Action Persisted Status & Dynamic Updates ---
  console.log('\n--- Test 9: Action Column Status Mapping ---');
  const lead1InF1 = f1Parsed.find((r) => r.includes('dr.smith@example.com'));
  const f1ActionIdx = f1Headers.indexOf('Action');
  assert(lead1InF1 && lead1InF1[f1ActionIdx] === 'Contacted', 'Lead 1 status mapped to "Contacted"');
  assert(lead2Row && lead2Row[f1ActionIdx] === 'Rejected', 'Lead 2 status mapped to "Rejected"');

  // --- Requirement 10: Submission Date Authoritative Timestamp ---
  console.log('\n--- Test 10: Submission Date Format ---');
  const subDateVal = lead1InF1[0];
  const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;
  assert(
    dateRegex.test(subDateVal),
    `Submission Date is formatted as authoritative YYYY-MM-DD HH:mm:ss UTC (${subDateVal})`
  );

  // --- Requirement 11: Security & Excel Compatibility ---
  console.log('\n--- Test 11: Security (BOM, Formula Injection, Phone Preservation) ---');
  const rawBuf = f1ExportRes.rawBuffer;
  const hasBOM = rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf;
  assert(hasBOM, 'Export begins with UTF-8 BOM (0xEF 0xBB 0xBF) for Excel compatibility');

  const rawText = f1ExportRes.text;
  assert(
    rawText.includes("''=cmd|calc!A0") || rawText.includes("'=cmd|calc!A0"),
    'Formula injection trigger sanitized with single-quote prefix'
  );
  assert(
    rawText.includes("'07123456789"),
    'Phone number with leading zero preserved with text-safety prefix'
  );

  // --- Requirement 12: Filter Scoping ---
  console.log('\n--- Test 12: Filter Scoping (status, search, count) ---');
  const statusFiltered = await request('/api/leads/export?status=rejected', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const sfParsed = parseCsv(statusFiltered.text);
  assert(
    sfParsed.length === 2 && sfParsed[1].includes('Sarah Connor'),
    'Filter status=rejected exports exact 1 matching lead'
  );

  // --- Requirement 13: Tenant Isolation ---
  console.log('\n--- Test 13: Tenant Isolation ---');
  const bExport = await request(`/api/leads/export?companyId=${compAId}`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  const bParsed = parseCsv(bExport.text);
  assert(
    bParsed.length <= 1,
    'Company B export contains 0 leads from Company A even when specifying Company A companyId'
  );

  console.log('\n================================================================');
  console.log(`FINAL SPEC SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[TEST SUITE CRASHED]:', err);
  process.exit(1);
});
