import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Form from '@/models/Form';
import { getAuthSession } from '@/lib/auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const VALID_STATUSES = [
  'new',
  'approved',
  'contacted',
  'qualified',
  'proposal sent',
  'proposal_sent',
  'won',
  'lost',
  'converted',
  'rejected',
  'pending',
  'new / pending',
];

/**
 * Escapes a cell value for RFC 4180 compliant CSV output.
 * Neutralizes CSV formula injection (CWE-1236) by prepending a single quote
 * if the text begins with dangerous formula triggers (=, +, -, @, \t, \r).
 * Preserves phone numbers and text with leading zeros.
 */
function escapeCsvCell(val, { isPhone = false } = {}) {
  if (val === null || val === undefined) return '""';

  let str;
  if (typeof val === 'boolean') {
    str = val ? 'Yes' : 'No';
  } else if (Array.isArray(val)) {
    str = val
      .map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)))
      .join(', ');
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

  // Neutralize spreadsheet formula execution triggers (CWE-1236)
  if (/^[=+\-@\t\r]/.test(str) && !str.startsWith("'")) {
    str = `'${str}`;
  }

  // RFC 4180 quoting
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Formats submission date as authoritative YYYY-MM-DD HH:mm:ss UTC.
 */
function formatSubmissionDate(dateVal) {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Formats lead status consistently for CSV exports.
 */
function formatLeadStatus(st) {
  if (!st) return 'New / Pending';
  const lower = String(st).trim().toLowerCase();
  if (lower === 'new' || lower === 'pending' || lower === 'new / pending') {
    return 'New / Pending';
  }
  if (lower === 'approved') return 'Approved';
  if (lower === 'contacted') return 'Contacted';
  if (lower === 'rejected') return 'Rejected';
  if (lower === 'qualified') return 'Qualified';
  if (lower === 'converted') return 'Converted';
  if (lower === 'proposal sent' || lower === 'proposal_sent') return 'Proposal Sent';
  if (lower === 'won') return 'Won';
  if (lower === 'lost') return 'Lost';
  return st.charAt(0).toUpperCase() + st.slice(1);
}

/**
 * Serializes raw custom field values cleanly into text.
 */
function formatFieldValue(val, fieldType) {
  if (val === null || val === undefined) return '';

  if (typeof val === 'boolean') {
    return val ? 'Yes' : 'No';
  }

  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)))
      .filter((s) => s.trim() !== '')
      .join(', ');
  }

  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }

  const str = String(val).trim();

  if (fieldType === 'date' && /^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  return str;
}

/**
 * Helper to derive field definition array from a form document.
 */
function extractFormFields(form) {
  if (!form) return [];
  const fields = [];

  if (Array.isArray(form.fields) && form.fields.length > 0) {
    const sorted = [...form.fields].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const f of sorted) {
      fields.push({
        id: f.id || f.name,
        name: f.name || f.id,
        label: (f.label || f.name || 'Field').trim(),
        type: (f.type || 'text').toLowerCase(),
      });
    }
    return fields;
  }

  if (form.formioSchema && Array.isArray(form.formioSchema.components)) {
    for (const c of form.formioSchema.components) {
      if (['button', 'submit', 'content', 'htmlelement'].includes((c.type || '').toLowerCase())) {
        continue;
      }
      fields.push({
        id: c.key || c.id || c.name,
        name: c.key || c.name || c.id,
        label: (c.label || c.key || 'Field').trim(),
        type: (c.type || 'text').toLowerCase(),
      });
    }
  }
  return fields;
}

/**
 * Checks if two fields represent standard equivalent concepts across forms.
 */
function isStandardEquivalent(f1, f2) {
  const norm1 = (f1.name || f1.label || '').toLowerCase();
  const norm2 = (f2.name || f2.label || '').toLowerCase();
  if (norm1 === norm2) return true;

  const isName1 = norm1.includes('name') || norm1.includes('contact') || norm1.includes('person');
  const isName2 = norm2.includes('name') || norm2.includes('contact') || norm2.includes('person');
  if (isName1 && isName2 && !norm1.includes('company') && !norm2.includes('company')) return true;

  const isEmail1 = f1.type === 'email' || norm1.includes('email');
  const isEmail2 = f2.type === 'email' || norm2.includes('email');
  if (isEmail1 && isEmail2) return true;

  const isPhone1 = f1.type === 'phone' || f1.type === 'tel' || norm1.includes('phone') || norm1.includes('tel');
  const isPhone2 = f2.type === 'phone' || f2.type === 'tel' || norm2.includes('phone') || norm2.includes('tel');
  if (isPhone1 && isPhone2) return true;

  const isComp1 = norm1.includes('company') || norm1.includes('org');
  const isComp2 = norm2.includes('company') || norm2.includes('org');
  if (isComp1 && isComp2) return true;

  return false;
}

/**
 * Extracts a field's value for a given lead, checking submissionData and standard properties.
 */
function extractFieldValue(lead, fieldDef) {
  const subData =
    lead.submissionData instanceof Map
      ? Object.fromEntries(lead.submissionData)
      : typeof lead.submissionData === 'object' && lead.submissionData !== null
      ? lead.submissionData
      : {};

  // 1. Direct candidate keys in submissionData
  const candidateKeys = [fieldDef.name, fieldDef.id, fieldDef.label];
  for (const k of candidateKeys) {
    if (k && subData[k] !== undefined && subData[k] !== null && String(subData[k]).trim() !== '') {
      return formatFieldValue(subData[k], fieldDef.type);
    }
  }

  // 2. Case-insensitive key match in submissionData
  const normName = (fieldDef.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normLabel = (fieldDef.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normId = (fieldDef.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const [k, v] of Object.entries(subData)) {
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normK && (normK === normName || normK === normLabel || normK === normId)) {
      return formatFieldValue(v, fieldDef.type);
    }
  }

  // 3. Fallback to standard Lead properties if fieldDef matches standard concepts
  const lLabel = fieldDef.label.toLowerCase();
  const lName = (fieldDef.name || '').toLowerCase();

  // Contact Person / Full Name
  if (
    !lLabel.includes('company') &&
    (lLabel.includes('name') ||
      lLabel.includes('contact') ||
      lLabel.includes('person') ||
      lName.includes('name') ||
      lName.includes('contact') ||
      lName.includes('person'))
  ) {
    if (lead.contactPerson && String(lead.contactPerson).trim() !== '') {
      return formatFieldValue(lead.contactPerson, 'text');
    }
  }

  // Email
  if (fieldDef.type === 'email' || lLabel.includes('email') || lName.includes('email')) {
    if (lead.email && String(lead.email).trim() !== '') {
      return formatFieldValue(lead.email, 'email');
    }
  }

  // Phone
  if (
    fieldDef.type === 'phone' ||
    fieldDef.type === 'tel' ||
    lLabel.includes('phone') ||
    lLabel.includes('mobile') ||
    lLabel.includes('tel') ||
    lName.includes('phone') ||
    lName.includes('mobile') ||
    lName.includes('tel')
  ) {
    if (lead.phone && String(lead.phone).trim() !== '') {
      return formatFieldValue(lead.phone, 'phone');
    }
  }

  // Company Name
  if (
    lLabel.includes('company') ||
    lLabel.includes('org') ||
    lName.includes('company') ||
    lName.includes('org')
  ) {
    if (lead.companyName && String(lead.companyName).trim() !== '') {
      return formatFieldValue(lead.companyName, 'text');
    }
  }

  // Notes / Message / Inquiry
  if (
    fieldDef.type === 'textarea' ||
    lLabel.includes('note') ||
    lLabel.includes('message') ||
    lLabel.includes('inquiry') ||
    lName.includes('note') ||
    lName.includes('message') ||
    lName.includes('inquiry')
  ) {
    if (lead.notes && String(lead.notes).trim() !== '') {
      return formatFieldValue(lead.notes, 'textarea');
    }
  }

  return '';
}

/**
 * GET /api/leads/export
 * Downloads an Excel-friendly CSV with strict structure:
 * Submission Date | Form Name | [Configured Form Fields...] | Status | Contact Note | Rejection Note
 *
 * Supports:
 * - leadId: Exports a single authorized lead
 * - formId: Exports all leads for a specific form (including all statuses: New/Pending, Approved, Contacted, Rejected)
 * - all forms: Exports all authorized company leads
 *
 * Strictly verifies company tenant isolation.
 */
export async function GET(request) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401, headers: NO_CACHE_HEADERS }
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database service unavailable.' },
      { status: 503, headers: NO_CACHE_HEADERS }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const leadIdParam = searchParams.get('leadId');
    const companyIdParam = searchParams.get('companyId');
    const formIdParam = searchParams.get('formId');
    const statusParam = searchParams.get('status');
    const searchParam = searchParams.get('search');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const query = {};

    // Enforce role-based tenant isolation
    if (session.user.role === 'company_admin') {
      if (!session.user.companyId || !mongoose.Types.ObjectId.isValid(session.user.companyId)) {
        return NextResponse.json(
          { success: false, error: 'Valid company association is required.' },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }
      const compId = new mongoose.Types.ObjectId(session.user.companyId);
      query.companyId = { $in: [compId, session.user.companyId] };
    } else if (session.user.role === 'super_admin') {
      if (companyIdParam && companyIdParam.trim() && companyIdParam !== 'all') {
        const cleanId = companyIdParam.trim();
        if (mongoose.Types.ObjectId.isValid(cleanId)) {
          const compId = new mongoose.Types.ObjectId(cleanId);
          query.companyId = { $in: [compId, cleanId] };
        } else {
          query.companyId = cleanId;
        }
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Unauthorized to export leads.' },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    // 1. Single Lead Export Mode
    if (leadIdParam && leadIdParam.trim()) {
      const cleanLeadId = leadIdParam.trim();
      if (!mongoose.Types.ObjectId.isValid(cleanLeadId)) {
        return NextResponse.json(
          { success: false, error: 'Invalid leadId parameter.' },
          { status: 400, headers: NO_CACHE_HEADERS }
        );
      }

      query._id = cleanLeadId;
      const singleLead = await Lead.findOne(query).populate('formId').lean();
      if (!singleLead) {
        return NextResponse.json(
          { success: false, error: 'Lead not found or unauthorized.' },
          { status: 404, headers: NO_CACHE_HEADERS }
        );
      }

      let formDef = null;
      if (singleLead.formId && typeof singleLead.formId === 'object') {
        formDef = singleLead.formId;
      } else if (singleLead.formId) {
        formDef = await Form.findById(singleLead.formId).lean();
      }

      const formFields = extractFormFields(formDef);
      const formNameVal =
        formDef?.title ||
        formDef?.name ||
        singleLead.formName ||
        'Unknown Form';

      // Header structure strictly: Submission Date | Form Name | [Form Fields...] | Status | Contact Note | Rejection Note
      const headerRow = [
        escapeCsvCell('Submission Date'),
        escapeCsvCell('Form Name'),
        ...formFields.map((f) => escapeCsvCell(f.label)),
        escapeCsvCell('Status'),
        escapeCsvCell('Contact Note'),
        escapeCsvCell('Rejection Note'),
      ];

      const fieldCells = formFields.map((f) => {
        const val = extractFieldValue(singleLead, f);
        const isPhone = f.type === 'phone' || f.type === 'tel' || f.label.toLowerCase().includes('phone');
        return escapeCsvCell(val, { isPhone });
      });

      const contactNoteVal = singleLead.contactNote || singleLead.notes || '';
      const rejectionNoteVal = singleLead.rejectionNote || '';

      const dataRow = [
        escapeCsvCell(formatSubmissionDate(singleLead.createdAt)),
        escapeCsvCell(formNameVal),
        ...fieldCells,
        escapeCsvCell(formatLeadStatus(singleLead.status)),
        escapeCsvCell(contactNoteVal),
        escapeCsvCell(rejectionNoteVal),
      ];

      const csvContent = '\uFEFF' + [headerRow.join(','), dataRow.join(',')].join('\r\n') + '\r\n';

      const formSlug = formNameVal
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'form';

      const leadPerson = (singleLead.contactPerson || singleLead.companyName || 'lead')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'lead';

      const filename = `${formSlug}-${leadPerson}.csv`;

      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Total-Count': '1',
          ...NO_CACHE_HEADERS,
        },
      });
    }

    // 2. Form-Specific or All-Leads Export Mode
    let cleanFormId = null;
    let targetForm = null;
    if (formIdParam && formIdParam.trim() && formIdParam !== 'all') {
      cleanFormId = formIdParam.trim();
      if (!mongoose.Types.ObjectId.isValid(cleanFormId)) {
        return NextResponse.json(
          { success: false, error: 'Invalid formId parameter.' },
          { status: 400, headers: NO_CACHE_HEADERS }
        );
      }

      // Security check: verify the requested form belongs to the authenticated company
      const formQuery = { _id: cleanFormId };
      if (session.user.role === 'company_admin') {
        const compId = new mongoose.Types.ObjectId(session.user.companyId);
        formQuery.companyId = { $in: [compId, session.user.companyId] };
      }
      targetForm = await Form.findOne(formQuery).lean();
      if (!targetForm) {
        return NextResponse.json(
          { success: false, error: 'Form not found or unauthorized.' },
          { status: 404, headers: NO_CACHE_HEADERS }
        );
      }

      const fObjId = new mongoose.Types.ObjectId(cleanFormId);
      query.formId = { $in: [fObjId, cleanFormId] };
    }

    // Filter by status if specified.
    // Note: If no status filter is provided, include ALL statuses (including Rejected) per Phase 3 & 4.
    if (statusParam && statusParam.trim() && statusParam !== 'all') {
      const cleanStatus = statusParam.trim().toLowerCase();
      if (cleanStatus === 'new' || cleanStatus === 'pending' || cleanStatus === 'new / pending') {
        query.status = { $in: [/^new$/i, /^pending$/i, /^new \/ pending$/i] };
      } else {
        const valid = VALID_STATUSES.some((v) => v.toLowerCase() === cleanStatus);
        if (!valid) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid status parameter. Allowed values: ${VALID_STATUSES.join(', ')}`,
            },
            { status: 400, headers: NO_CACHE_HEADERS }
          );
        }
        query.status = { $regex: new RegExp(`^${cleanStatus}$`, 'i') };
      }
    }

    // Filter by search query
    if (searchParam && searchParam.trim()) {
      const term = searchParam.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { companyName: { $regex: term, $options: 'i' } },
        { contactPerson: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { notes: { $regex: term, $options: 'i' } },
        { contactNote: { $regex: term, $options: 'i' } },
        { rejectionNote: { $regex: term, $options: 'i' } },
      ];
    }

    // Filter by submission date range
    if (startDateParam || endDateParam) {
      query.createdAt = {};
      if (startDateParam && startDateParam.trim()) {
        const start = new Date(startDateParam.trim());
        if (isNaN(start.getTime())) {
          return NextResponse.json(
            { success: false, error: 'Invalid startDate parameter.' },
            { status: 400, headers: NO_CACHE_HEADERS }
          );
        }
        query.createdAt.$gte = start;
      }
      if (endDateParam && endDateParam.trim()) {
        const end = new Date(endDateParam.trim());
        if (isNaN(end.getTime())) {
          return NextResponse.json(
            { success: false, error: 'Invalid endDate parameter.' },
            { status: 400, headers: NO_CACHE_HEADERS }
          );
        }
        if (endDateParam.trim().length <= 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        query.createdAt.$lte = end;
      }
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    // Query all matching leads (without limit or skip)
    const leads = await Lead.find(query)
      .populate('formId')
      .sort({ createdAt: -1 })
      .lean();

    // Determine relevant forms for field resolution
    let formsToUse = [];

    if (cleanFormId) {
      formsToUse = targetForm ? [targetForm] : [];
    } else {
      // All-forms export: fetch forms representing matching leads
      if (leads.length > 0) {
        const formIdsMap = new Map();
        for (const lead of leads) {
          if (lead.formId) {
            const fid = (lead.formId._id || lead.formId).toString();
            if (!formIdsMap.has(fid)) {
              if (typeof lead.formId === 'object' && (lead.formId.title || lead.formId.name)) {
                formIdsMap.set(fid, lead.formId);
              } else {
                formIdsMap.set(fid, null);
              }
            }
          }
        }

        const missingIds = Array.from(formIdsMap.entries())
          .filter(([_, v]) => v === null)
          .map(([k]) => k);

        if (missingIds.length > 0) {
          const fetched = await Form.find({ _id: { $in: missingIds } }).lean();
          for (const f of fetched) {
            formIdsMap.set(f._id.toString(), f);
          }
        }
        formsToUse = Array.from(formIdsMap.values()).filter(Boolean);
      } else {
        // If 0 leads, fetch active company forms to extract field headers
        const compFilter = query.companyId ? { companyId: query.companyId } : {};
        formsToUse = await Form.find(compFilter).lean();
      }
    }

    // Analyze label usage across forms to detect genuine collisions
    const labelUsage = new Map();
    for (const form of formsToUse) {
      const flds = extractFormFields(form);
      for (const fld of flds) {
        if (!labelUsage.has(fld.label)) {
          labelUsage.set(fld.label, []);
        }
        labelUsage.get(fld.label).push({
          formId: form._id.toString(),
          formTitle: form.title || form.name || 'Form',
          field: fld,
        });
      }
    }

    // Build the ordered union of distinct configured form field columns
    const orderedColumns = [];

    for (const form of formsToUse) {
      const formIdStr = form._id.toString();
      const formTitle = form.title || form.name || 'Form';
      const fields = extractFormFields(form);

      for (const fld of fields) {
        const usages = labelUsage.get(fld.label) || [];
        const isCollision =
          usages.length > 1 &&
          usages.some((u) => {
            if (u.formId === formIdStr) return false;
            const typeDiff = u.field.type !== fld.type;
            const keyDiff = u.field.name !== fld.name && !isStandardEquivalent(u.field, fld);
            return typeDiff || keyDiff;
          });

        const finalHeader = isCollision ? `${fld.label} (${formTitle})` : fld.label;

        let existingCol = orderedColumns.find((c) => c.header === finalHeader);
        if (!existingCol) {
          existingCol = {
            header: finalHeader,
            forms: new Map(),
          };
          orderedColumns.push(existingCol);
        }
        existingCol.forms.set(formIdStr, fld);
      }
    }

    // Header structure strictly: Submission Date | Form Name | [Form Fields...] | Status | Contact Note | Rejection Note
    const headerRow = [
      escapeCsvCell('Submission Date'),
      escapeCsvCell('Form Name'),
      ...orderedColumns.map((col) => escapeCsvCell(col.header)),
      escapeCsvCell('Status'),
      escapeCsvCell('Contact Note'),
      escapeCsvCell('Rejection Note'),
    ];

    // Data rows
    const dataRows = leads.map((lead) => {
      const leadFormId = (lead.formId?._id || lead.formId)?.toString();

      const formNameVal =
        (lead.formId && typeof lead.formId === 'object'
          ? lead.formId.title || lead.formId.name
          : null) ||
        (cleanFormId && targetForm ? targetForm.title || targetForm.name : null) ||
        lead.formName ||
        'Unknown Form';

      const fieldCells = orderedColumns.map((col) => {
        // A lead must not receive values from another form's fields
        if (leadFormId && !col.forms.has(leadFormId)) {
          return escapeCsvCell('');
        }
        const fieldDef = (leadFormId && col.forms.get(leadFormId)) || Array.from(col.forms.values())[0];
        const val = extractFieldValue(lead, fieldDef);
        const isPhone =
          fieldDef.type === 'phone' ||
          fieldDef.type === 'tel' ||
          col.header.toLowerCase().includes('phone');
        return escapeCsvCell(val, { isPhone });
      });

      const contactNoteVal = lead.contactNote || lead.notes || '';
      const rejectionNoteVal = lead.rejectionNote || '';

      return [
        escapeCsvCell(formatSubmissionDate(lead.createdAt)),
        escapeCsvCell(formNameVal),
        ...fieldCells,
        escapeCsvCell(formatLeadStatus(lead.status)),
        escapeCsvCell(contactNoteVal),
        escapeCsvCell(rejectionNoteVal),
      ].join(',');
    });

    const csvLines = [headerRow.join(','), ...dataRows];
    // UTF-8 BOM (\uFEFF) for Microsoft Excel compatibility
    const csvContent = '\uFEFF' + csvLines.join('\r\n') + '\r\n';

    // Form-specific sanitized filename
    let filename;
    if (targetForm) {
      const formRawName = targetForm.title || targetForm.name || 'form';
      const sanitizedName =
        formRawName
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'form';
      filename = `${sanitizedName}-leads.csv`;
    } else {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      filename = `company-leads-${dateStr}.csv`;
    }

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Count': leads.length.toString(),
        ...NO_CACHE_HEADERS,
      },
    });
  } catch (error) {
    console.error('[CSV Export Error]:', error.message || error);
    return NextResponse.json(
      { success: false, error: 'Internal server error generating CSV export.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
