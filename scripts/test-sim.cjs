const fs = require('fs');
const { SignJWT } = require('jose');

function escapeCsvCell(val, { isIdentifier = false, isPhone = false } = {}) {
  if (val === null || val === undefined) return '""';

  let str;
  if (typeof val === 'boolean') {
    str = val ? 'Yes' : 'No';
  } else if (Array.isArray(val)) {
    str = val.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  } else if (typeof val === 'object') {
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  } else {
    str = String(val);
  }

  // Preserve leading zeros for phone numbers in Excel
  if (isPhone && /^0\d+/.test(str)) {
    str = `'${str}`;
  }

  // Preserve IDs as text in Excel so scientific notation is avoided
  if (isIdentifier && (/^\d+$/.test(str) || /^\d+[eE]\d+$/.test(str))) {
    str = `'${str}`;
  }

  // Neutralize spreadsheet formula execution triggers (CWE-1236)
  if (/^[=+\-@\t\r]/.test(str) && !str.startsWith("'")) {
    str = `'${str}`;
  }

  // RFC 4180
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function formatFieldLabel(key) {
  if (!key || typeof key !== 'string') return '';
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

async function testSimulate() {
  const env = fs.readFileSync('.env.local', 'utf8');
  let secret = '';
  for (const line of env.split('\n')) {
    if (line.startsWith('JWT_SECRET=')) secret = line.slice('JWT_SECRET='.length).trim();
  }
  const secretKey = new TextEncoder().encode(secret);

  const ALPHA_COMPANY_ID = '6ace5de5a51c5c2473fbd3ce';
  const ALPHA_USER_ID = '6ace5de6a51c5c2473fbd3cf';

  const token = await new SignJWT({ userId: ALPHA_USER_ID, role: 'company_admin', companyId: ALPHA_COMPANY_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secretKey);

  // Fetch company forms
  const formsRes = await fetch('http://localhost:3000/api/forms', {
    headers: { Cookie: 'auth_token=' + token }
  });
  const formsData = await formsRes.json();
  const forms = formsData.data || [];

  const formFieldMap = new Map(); // keyNorm -> { label, type }
  for (const f of forms) {
    if (Array.isArray(f.fields)) {
      for (const fld of f.fields) {
        const key = (fld.name || fld.key || fld.id || '').trim().toLowerCase();
        const label = (fld.label || fld.name).trim();
        if (key && !formFieldMap.has(key)) {
          formFieldMap.set(key, { label, type: fld.type });
        }
      }
    }
  }

  // Fetch leads
  const leadsRes = await fetch('http://localhost:3000/api/leads?limit=100', {
    headers: { Cookie: 'auth_token=' + token }
  });
  const leadsData = await leadsRes.json();
  const leads = leadsData.data || [];

  const STANDARD_NAME_KEYS = new Set(['full_name', 'fullname', 'name', 'contact_person', 'contactperson', 'client_name', 'contact']);
  const STANDARD_EMAIL_KEYS = new Set(['email', 'work_email', 'workemail', 'email_address', 'emailaddress']);
  const STANDARD_PHONE_KEYS = new Set(['phone', 'phone_number', 'phonenumber', 'telephone', 'mobile', 'tel']);
  const STANDARD_COMPANY_KEYS = new Set(['company_name', 'companyname', 'company', 'organization', 'org']);
  const STANDARD_NOTES_KEYS = new Set(['notes', 'comments', 'inquiry_details', 'message']);
  const SYSTEM_KEYS = new Set(['submit', 'formid', 'companyid', 'publicid', 'page', 'source', 'referrer', '_source', '_referrer']);

  // Collect dynamic columns
  const dynamicColsMap = new Map(); // colHeader -> { keys: Set, type }

  for (const lead of leads) {
    const dataObj = lead.submissionData || {};
    for (const [k, v] of Object.entries(dataObj)) {
      if (v === undefined || v === null || v === '') continue;
      const kNorm = k.trim().toLowerCase();
      if (k.startsWith('_') || SYSTEM_KEYS.has(kNorm)) continue;

      // Check if duplicate of standard fields
      const vStr = String(v).trim().toLowerCase();
      if (STANDARD_NAME_KEYS.has(kNorm) && (vStr === String(lead.contactPerson || '').trim().toLowerCase() || vStr === String(lead.companyName || '').trim().toLowerCase())) {
        continue;
      }
      if (STANDARD_EMAIL_KEYS.has(kNorm) && vStr === String(lead.email || '').trim().toLowerCase()) {
        continue;
      }
      if (STANDARD_PHONE_KEYS.has(kNorm) && vStr === String(lead.phone || '').trim().toLowerCase()) {
        continue;
      }
      if (STANDARD_COMPANY_KEYS.has(kNorm) && vStr === String(lead.companyName || '').trim().toLowerCase()) {
        continue;
      }
      if (STANDARD_NOTES_KEYS.has(kNorm) && vStr === String(lead.notes || '').trim().toLowerCase()) {
        continue;
      }

      // It's a custom dynamic field
      const fieldDef = formFieldMap.get(kNorm);
      const colHeader = fieldDef?.label || formatFieldLabel(k);

      if (!dynamicColsMap.has(colHeader)) {
        dynamicColsMap.set(colHeader, { keys: new Set([kNorm, k]), type: fieldDef?.type || 'text' });
      } else {
        dynamicColsMap.get(colHeader).keys.add(kNorm);
        dynamicColsMap.get(colHeader).keys.add(k);
      }
    }
  }

  const dynamicCols = Array.from(dynamicColsMap.entries()).map(([header, meta]) => ({
    header,
    keys: Array.from(meta.keys),
    type: meta.type,
  }));

  const standardHeaders = [
    'Lead ID',
    'Submission Date',
    'Lead Name',
    'Email',
    'Phone',
    'Company Name',
    'Form Name',
    'Lead Status',
    'Deal Value ($)',
    'Notes',
  ];

  const headers = [
    ...standardHeaders,
    ...dynamicCols.map(c => c.header),
    'Source',
    'Source URL',
    'Referrer',
    'Submitted Form Answers',
  ];

  console.log('GENERATED HEADERS:');
  console.log(JSON.stringify(headers, null, 2));

  const rows = [headers.map(h => escapeCsvCell(h)).join(',')];

  for (const lead of leads) {
    const createdStr = lead.createdAt
      ? new Date(lead.createdAt).toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
      : '';
    const formName = lead.form?.title || lead.form?.name || (lead.formId ? 'Lead Form' : 'Manual / Direct');
    const leadName = lead.contactPerson || lead.companyName || '';
    const dataObj = lead.submissionData || {};

    const dynamicCells = dynamicCols.map(col => {
      let val = undefined;
      for (const k of col.keys) {
        if (dataObj[k] !== undefined && dataObj[k] !== null && dataObj[k] !== '') {
          val = dataObj[k];
          break;
        }
      }
      // Format by type
      if (col.type === 'checkbox' && (val === true || val === 'true' || val === 1)) val = 'Yes';
      if (col.type === 'checkbox' && (val === false || val === 'false' || val === 0)) val = 'No';
      return escapeCsvCell(val);
    });

    // Check for any unmapped answers
    const mappedKeys = new Set();
    for (const col of dynamicCols) {
      for (const k of col.keys) mappedKeys.add(k);
    }
    for (const k of STANDARD_NAME_KEYS) mappedKeys.add(k);
    for (const k of STANDARD_EMAIL_KEYS) mappedKeys.add(k);
    for (const k of STANDARD_PHONE_KEYS) mappedKeys.add(k);
    for (const k of STANDARD_COMPANY_KEYS) mappedKeys.add(k);
    for (const k of STANDARD_NOTES_KEYS) mappedKeys.add(k);
    for (const k of SYSTEM_KEYS) mappedKeys.add(k);

    const unmappedParts = [];
    for (const [k, v] of Object.entries(dataObj)) {
      if (!k.startsWith('_') && !mappedKeys.has(k.toLowerCase()) && v !== undefined && v !== null && v !== '') {
        unmappedParts.push(`${formatFieldLabel(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
    const unmappedAnswers = unmappedParts.join(' | ');

    const row = [
      escapeCsvCell(lead._id.toString(), { isIdentifier: true }),
      escapeCsvCell(createdStr),
      escapeCsvCell(leadName),
      escapeCsvCell(lead.email || ''),
      escapeCsvCell(lead.phone || '', { isPhone: true }),
      escapeCsvCell(lead.companyName || ''),
      escapeCsvCell(formName),
      escapeCsvCell(lead.status || 'New'),
      escapeCsvCell(lead.dealValue !== undefined ? lead.dealValue : 0),
      escapeCsvCell(lead.notes || ''),
      ...dynamicCells,
      escapeCsvCell(lead.source || 'manual'),
      escapeCsvCell(lead.sourceUrl || ''),
      escapeCsvCell(lead.referrer || ''),
      escapeCsvCell(unmappedAnswers),
    ];

    rows.push(row.join(','));
  }

  console.log('\nSAMPLE ROW 1:');
  console.log(rows[1]);
  console.log('\nSAMPLE ROW 4:');
  console.log(rows[4]);
}

testSimulate();
