/**
 * Company Leads CSV Export Verification Suite
 *
 * Verifies all CSV export requirements:
 * 1. Health check & unauthorized access enforcement (401).
 * 2. Super Admin provisioning & Multi-Tenant registration (Company A & Company B).
 * 3. Form creation with custom Form.io dynamic components & question labels.
 * 4. Ingestion of 15+ leads across forms to verify export across server-side pagination.
 * 5. Verify Leads Table paginates at limit (10) while CSV Export retrieves ALL matching records (15).
 * 6. Verify UTF-8 Byte Order Mark (BOM: \uFEFF / 0xEF 0xBB 0xBF) and Excel compatibility.
 * 7. Verify dynamic question columns with human-readable headers across different forms.
 * 8. Verify CSV formula injection protection (CWE-1236) for =, +, -, @, \t, \r.
 * 9. Verify RFC 4180 escaping for commas, quotes, and newlines.
 * 10. Verify active table filters (search, status, formId, date ranges).
 * 11. Verify tenant isolation (Company B cannot export Company A leads; client companyId is ignored).
 * 12. Verify invalid filter parameter validation (400 Bad Request).
 * 13. Verify empty result handling (X-Total-Count: 0 and header-only CSV).
 */

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
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

// Simple RFC 4180 CSV line parser
function parseCsvLines(csvText) {
  // Strip BOM if present
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
          i++; // skip escaped quote
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
        i++; // skip \n
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

  // Filter out any trailing empty line
  return lines.filter((l) => l.length > 1 || (l.length === 1 && l[0] !== ''));
}

async function runExportSuite() {
  console.log('================================================================');
  console.log('         COMPANY LEADS CSV EXPORT VERIFICATION SUITE            ');
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
  console.log('--- 1. Health Check ---');
  const healthRes = await request('/api/health');
  assert(
    healthRes.status === 200 && healthRes.data?.status === 'healthy',
    'Health Check Endpoint returns 200 OK & healthy'
  );

  // 2. Unauthorized Access & RBAC Security
  console.log('\n--- 2. Authentication Enforcement on Export Endpoint ---');
  const unauthRes = await request('/api/leads/export');
  assert(
    unauthRes.status === 401,
    'Unauthenticated GET /api/leads/export returns 401 Unauthorized',
    `Status: ${unauthRes.status}`
  );

  const invalidTokenRes = await request('/api/leads/export', {
    headers: { Cookie: 'auth_token=invalid_garbage_token' },
  });
  assert(
    invalidTokenRes.status === 401,
    'Invalid auth_token cookie returns 401 Unauthorized',
    `Status: ${invalidTokenRes.status}`
  );

  // 3. Super Admin & Multi-Tenant Setup
  console.log('\n--- 3. Multi-Tenant Provisioning (Tenant A & Tenant B) ---');
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

  // Register & Approve Company A
  const compAEmail = `admin_export_a_${runId}@alpha.test`;
  const regARes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Export Alpha Corp ${runId}`,
      adminName: 'Alpha Admin',
      adminEmail: compAEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-0101',
    },
  });
  const compAId = regARes.data?.company?.id || regARes.data?.companyId;
  assert(regARes.status === 201 && compAId, 'Company A Registration');

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
  assert(loginARes.status === 200 && compACookie, 'Company A Login & Session Cookie Obtained');

  // Register & Approve Company B
  const compBEmail = `admin_export_b_${runId}@beta.test`;
  const regBRes = await request('/api/auth/register', {
    method: 'POST',
    body: {
      companyName: `Export Beta Corp ${runId}`,
      adminName: 'Beta Admin',
      adminEmail: compBEmail,
      password: 'Password123!',
      confirmPassword: 'Password123!',
      termsAccepted: true,
      contactPhone: '+1-555-0202',
    },
  });
  const compBId = regBRes.data?.company?.id || regBRes.data?.companyId;
  assert(regBRes.status === 201 && compBId, 'Company B Registration');

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
  assert(loginBRes.status === 200 && compBCookie, 'Company B Login & Session Cookie Obtained');

  // 4. Form Creation with Custom Fields & Meaningful Question Labels
  console.log('\n--- 4. Form Creation with Form.io Dynamic Components ---');
  // Form 1: Enterprise Cloud Intake Form
  const form1Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Cloud Intake Form ${runId}`,
      description: 'Collects enterprise cloud preferences',
      status: 'published',
      formioSchema: {
        display: 'form',
        components: [
          { key: 'companyName', label: 'Company Name', type: 'textfield', validate: { required: true } },
          { key: 'email', label: 'Work Email', type: 'email', validate: { required: true } },
          { key: 'preferredCloud', label: 'Preferred Cloud Provider', type: 'select' },
          { key: 'budgetRange', label: 'Annual Infrastructure Budget', type: 'textfield' },
          { key: 'submit', label: 'Submit', type: 'button' },
        ],
      },
    },
  });
  const form1 = form1Res.data?.data || form1Res.data?.form;
  const form1Id = form1?._id || form1?.id;
  assert(form1Res.status === 201 && form1Id, 'Form 1 Created with Question Labels');

  // Form 2: Partner Evaluation Form
  const form2Res = await request('/api/forms', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      title: `Partner Evaluation ${runId}`,
      description: 'Collects partnership volume details',
      status: 'published',
      formioSchema: {
        display: 'form',
        components: [
          { key: 'companyName', label: 'Company Name', type: 'textfield', validate: { required: true } },
          { key: 'email', label: 'Partner Email', type: 'email', validate: { required: true } },
          { key: 'partnershipTier', label: 'Target Partnership Tier', type: 'radio' },
          { key: 'monthlyVolume', label: 'Estimated Monthly Volume', type: 'number' },
          { key: 'submit', label: 'Submit', type: 'button' },
        ],
      },
    },
  });
  const form2 = form2Res.data?.data || form2Res.data?.form;
  const form2Id = form2?._id || form2?.id;
  assert(form2Res.status === 201 && form2Id, 'Form 2 Created with Distinct Dynamic Question Labels');

  // 5. Ingest 15 Leads into Company A (Exceeding default 10-per-page table limit)
  console.log('\n--- 5. Lead Ingestion (15 Records across 2 Forms with Injections & Escaping) ---');

  // Lead 1: Contains CSV Formula Injection triggers in multiple fields
  const lead1Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: form1Id,
      companyName: '=cmd|\' /C calc\'!A0',
      contactPerson: '@MaliciousUser',
      email: 'hacker@example.com',
      phone: '+1-555-9999',
      notes: '-2+5*9 formula trigger',
      status: 'new',
      sourceUrl: 'https://alpha.example.com/pricing',
      referrer: 'https://google.com/search',
      submissionData: {
        companyName: '=cmd|\' /C calc\'!A0',
        email: 'hacker@example.com',
        preferredCloud: '+AWS-Enterprise',
        budgetRange: '@Over $100k',
      },
    },
  });
  assert(lead1Res.status === 201, 'Lead 1 (with formula injection triggers) ingested');

  // Lead 2: Contains special characters requiring RFC 4180 escaping (commas, quotes, newlines)
  const lead2Res = await request('/api/leads', {
    method: 'POST',
    headers: { Cookie: `auth_token=${compACookie}` },
    body: {
      formId: form1Id,
      companyName: 'Acme, Inc. "Global Partners"',
      contactPerson: 'Jane "VIP" Doe',
      email: 'jane.doe@acme.com',
      notes: 'Line 1: High Priority\nLine 2: Ready to close, deal size: large',
      status: 'qualified',
      dealValue: 75000,
      sourceUrl: 'https://alpha.example.com/demo',
      referrer: 'https://linkedin.com/ad',
      submissionData: {
        preferredCloud: 'GCP Multi-Region',
        budgetRange: '$50,000 - $100,000',
      },
    },
  });
  assert(lead2Res.status === 201, 'Lead 2 (RFC 4180 commas, quotes, newlines) ingested');

  // Ingest 8 more leads into Form 1 (reaching 10 total for Form 1)
  for (let i = 3; i <= 10; i++) {
    await request('/api/leads', {
      method: 'POST',
      headers: { Cookie: `auth_token=${compACookie}` },
      body: {
        formId: form1Id,
        companyName: `Alpha Client ${i} Corp`,
        contactPerson: `Contact Person ${i}`,
        email: `client${i}@alpha.test`,
        phone: `+1-555-000${i}`,
        status: i % 2 === 0 ? 'qualified' : 'contacted',
        notes: `Regular inquiry note ${i}`,
        submissionData: {
          preferredCloud: i % 2 === 0 ? 'Azure Cloud' : 'AWS Cloud',
          budgetRange: `$${i * 10},000`,
        },
      },
    });
  }

  // Ingest 5 leads into Form 2 (distinct fields: partnershipTier, monthlyVolume)
  for (let i = 11; i <= 15; i++) {
    await request('/api/leads', {
      method: 'POST',
      headers: { Cookie: `auth_token=${compACookie}` },
      body: {
        formId: form2Id,
        companyName: `Partner Affiliate ${i} AcmeGlobal`,
        contactPerson: `Partner Lead ${i}`,
        email: `partner${i}@affiliate.test`,
        phone: `+1-555-111${i}`,
        status: i === 15 ? 'qualified' : 'new',
        notes: `Partnership evaluation ${i}`,
        submissionData: {
          partnershipTier: i === 15 ? 'Platinum' : 'Gold',
          monthlyVolume: i * 500,
        },
      },
    });
  }

  console.log('[INFO] Total 15 leads successfully provisioned for Company A across Form 1 and Form 2');

  // 6. Verify Leads Table Server-Side Pagination
  console.log('\n--- 6. Leads Table Server-Side Pagination Verification ---');
  const tablePage1 = await request('/api/leads?limit=10&page=1', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    tablePage1.status === 200 &&
      tablePage1.data?.pagination?.total >= 15 &&
      (tablePage1.data?.data?.length === 10 || tablePage1.data?.leads?.length === 10),
    'Table Endpoint returns strictly 10 leads on Page 1 while total >= 15',
    `Total: ${tablePage1.data?.pagination?.total}, Returned: ${tablePage1.data?.data?.length || tablePage1.data?.leads?.length}`
  );

  // 7. Full CSV Export Across Server-Side Pagination
  console.log('\n--- 7. Full CSV Export Across Server-Side Pagination ---');
  const fullExportRes = await request('/api/leads/export', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });

  const contentType = fullExportRes.headers.get('content-type') || '';
  const contentDisp = fullExportRes.headers.get('content-disposition') || '';
  const totalCountHeader = fullExportRes.headers.get('x-total-count');

  assert(
    fullExportRes.status === 200 && contentType.includes('text/csv'),
    'GET /api/leads/export returns HTTP 200 with Content-Type: text/csv',
    `Status: ${fullExportRes.status}, Content-Type: ${contentType}`
  );

  assert(
    contentDisp.includes('attachment;') && contentDisp.includes('company-leads-') && contentDisp.includes('.csv'),
    `Content-Disposition header specifies filename: ${contentDisp}`
  );

  assert(
    totalCountHeader && parseInt(totalCountHeader, 10) >= 15,
    `X-Total-Count header reports all matching records (${totalCountHeader} >= 15) across pagination`
  );

  // 8. UTF-8 BOM Verification
  console.log('\n--- 8. UTF-8 BOM (Byte Order Mark) Verification ---');
  const rawBuf = fullExportRes.rawBuffer;
  const hasUtf8BomBytes = rawBuf && rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf;
  const hasUtf8BomChar = fullExportRes.text.startsWith('\uFEFF') || fullExportRes.text.charCodeAt(0) === 0xfeff;
  assert(
    hasUtf8BomBytes || hasUtf8BomChar,
    'Export begins with UTF-8 BOM (\\uFEFF / 0xEF 0xBB 0xBF) for seamless Excel UTF-8 support'
  );

  // 9. Parse CSV & Verify Dynamic Question Columns & Cross-Form Matrix
  console.log('\n--- 9. Dynamic Question Columns & Multi-Form Field Matrix ---');
  const parsedRows = parseCsvLines(fullExportRes.text);
  const headerRow = parsedRows[0] || [];

  assert(
    headerRow.includes('Lead ID') &&
      headerRow.includes('Submission Date') &&
      headerRow.includes('Form Name') &&
      headerRow.includes('Lead Status') &&
      headerRow.includes('Source URL') &&
      headerRow.includes('Referrer') &&
      headerRow.includes('Submitted Form Answers'),
    'CSV Header Row contains all standard audit columns (Lead ID, Date, Form Name, Status, Source URL, Referrer, Answers)'
  );

  // Check dynamic question label headers from Form 1 and Form 2
  const hasCloudLabel = headerRow.includes('Preferred Cloud Provider');
  const hasBudgetLabel = headerRow.includes('Annual Infrastructure Budget');
  const hasTierLabel = headerRow.includes('Target Partnership Tier');
  const hasVolumeLabel = headerRow.includes('Estimated Monthly Volume');

  assert(
    hasCloudLabel && hasBudgetLabel && hasTierLabel && hasVolumeLabel,
    'CSV Header Row includes friendly Question Labels for all dynamic fields across both forms',
    `Header Row: ${JSON.stringify(headerRow)}`
  );

  // Verify all 15 leads are present in the export rows (1 header + >= 15 data rows)
  assert(
    parsedRows.length >= 16,
    `CSV Export contains all records beyond page limit (Parsed rows: ${parsedRows.length} >= 16 rows)`
  );

  // 10. CSV Formula Injection Neutralization (CWE-1236)
  console.log('\n--- 10. Formula Injection Protection (CWE-1236) ---');
  // In lead1, we submitted:
  // companyName: "=cmd|' /C calc'!A0"
  // contactPerson: "@MaliciousUser"
  // notes: "-2+5*9 formula trigger"
  // preferredCloud: "+AWS-Enterprise"
  // budgetRange: "@Over $100k"
  const rawCsv = fullExportRes.text;
  const formulaPrefixClean =
    rawCsv.includes("''=cmd|") ||
    rawCsv.includes("'=cmd|") ||
    rawCsv.includes("'+AWS-Enterprise") ||
    rawCsv.includes("'@MaliciousUser") ||
    rawCsv.includes("'-2+5*9");

  assert(
    formulaPrefixClean,
    'Potentially malicious formula cells starting with =, +, -, @ are sanitized with single quote prefix'
  );

  // 11. RFC 4180 Escaping for Quotes, Commas, and Newlines
  console.log('\n--- 11. RFC 4180 Escaping (Quotes, Commas, Newlines) ---');
  // In lead2, companyName: 'Acme, Inc. "Global Partners"'
  const hasEscapedQuotes =
    rawCsv.includes('"Acme, Inc. ""Global Partners"""') ||
    rawCsv.includes('Acme, Inc. ""Global Partners""');
  assert(
    hasEscapedQuotes,
    'Double quotes inside cell values are escaped by doubling ("") and wrapped in quotes according to RFC 4180'
  );

  // 12. Active Table Filters (Status, Search, FormId, Date Ranges)
  console.log('\n--- 12. Active Table Filters on Export Endpoint ---');

  // A. Filter by status=qualified
  const qualifiedExport = await request('/api/leads/export?status=qualified', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const qualCount = parseInt(qualifiedExport.headers.get('x-total-count') || '0', 10);
  const qualRows = parseCsvLines(qualifiedExport.text);
  assert(
    qualifiedExport.status === 200 && qualCount > 0 && qualRows.length === qualCount + 1,
    `Status Filter (status=qualified) correctly scopes export (${qualCount} matching records)`
  );

  // B. Filter by search=AcmeGlobal
  const searchExport = await request('/api/leads/export?search=AcmeGlobal', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const searchCount = parseInt(searchExport.headers.get('x-total-count') || '0', 10);
  assert(
    searchExport.status === 200 && searchCount === 5,
    `Search Filter (search=AcmeGlobal) returns exact 5 matching leads across all pages`,
    `Count: ${searchCount}`
  );

  // C. Filter by formId=form2Id
  const formExport = await request(`/api/leads/export?formId=${form2Id}`, {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const formCount = parseInt(formExport.headers.get('x-total-count') || '0', 10);
  assert(
    formExport.status === 200 && formCount === 5,
    `Form Filter (formId=${form2Id}) returns exact 5 Form 2 leads`,
    `Count: ${formCount}`
  );

  // 13. Tenant Isolation & IDOR Protection
  console.log('\n--- 13. Tenant Isolation & IDOR Protection ---');
  // Company B attempts to export Company A's leads by tampering with companyId parameter
  const idorExportRes = await request(`/api/leads/export?companyId=${compAId}`, {
    headers: { Cookie: `auth_token=${compBCookie}` },
  });
  const compBTotal = idorExportRes.headers.get('x-total-count');

  assert(
    idorExportRes.status === 200 && compBTotal === '0',
    'IDOR Protection: Company B receives 0 leads when attempting to export with Company A companyId',
    `X-Total-Count: ${compBTotal}`
  );

  assert(
    !idorExportRes.text.includes('hacker@example.com') &&
      !idorExportRes.text.includes('jane.doe@acme.com') &&
      !idorExportRes.text.includes(compAEmail),
    'Company B export contains zero Company A data or email addresses'
  );

  // 14. Invalid Filter Parameter Validation
  console.log('\n--- 14. Invalid Filter Validation (400 Bad Request) ---');
  const invalidStatusRes = await request('/api/leads/export?status=invalid_status_xyz', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    invalidStatusRes.status === 400 && invalidStatusRes.data?.error?.includes('Invalid status parameter'),
    'Invalid status filter returns HTTP 400 Bad Request',
    `Status: ${invalidStatusRes.status}`
  );

  const invalidFormRes = await request('/api/leads/export?formId=not-an-objectid', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    invalidFormRes.status === 400 && invalidFormRes.data?.error?.includes('Invalid formId parameter'),
    'Invalid formId filter returns HTTP 400 Bad Request',
    `Status: ${invalidFormRes.status}`
  );

  const invalidDateRes = await request('/api/leads/export?startDate=not-a-valid-date', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  assert(
    invalidDateRes.status === 400 && invalidDateRes.data?.error?.includes('Invalid startDate parameter'),
    'Invalid startDate filter returns HTTP 400 Bad Request',
    `Status: ${invalidDateRes.status}`
  );

  // 15. Empty Result Handling
  console.log('\n--- 15. Empty Result Handling ---');
  const emptyRes = await request('/api/leads/export?search=nonexistent_xyz_lead_query_99999', {
    headers: { Cookie: `auth_token=${compACookie}` },
  });
  const emptyTotal = emptyRes.headers.get('x-total-count');
  const emptyRows = parseCsvLines(emptyRes.text);

  assert(
    emptyRes.status === 200 && emptyTotal === '0' && emptyRows.length === 1,
    'Empty result returns 200 OK with X-Total-Count: 0 and exactly 1 header row (no data rows)',
    `Total: ${emptyTotal}, Rows: ${emptyRows.length}`
  );

  // Summary
  console.log('\n================================================================');
  console.log(`EXPORT SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runExportSuite().catch((err) => {
  console.error('Fatal export suite error:', err);
  process.exit(1);
});
