import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Form from '@/models/Form';
import { getAuthSession } from '@/lib/auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

const VALID_STATUSES = [
  'New',
  'Approved',
  'Contacted',
  'Qualified',
  'Proposal Sent',
  'Won',
  'Lost',
  'Converted',
  'Rejected',
  'new',
  'contacted',
  'qualified',
  'converted',
  'rejected',
  'lost',
  'approved',
  'pending',
  'New / Pending',
];

/**
 * GET /api/leads
 * Retrieves leads with pagination and status filter.
 * Role-authorized: Company Admin only sees their company leads; Super Admin can view all or filter by company.
 */
export async function GET(request) {
  // Authenticate session via HTTP-only cookie or Bearer token
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      {
        success: false,
        error: session.error || 'Unauthorized. Authentication is required to access lead data.',
      },
      { status: session.statusCode || 401 }
    );
  }

  // Database-dependent operation: connect to MongoDB
  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Database is unavailable. Could not establish connection to MongoDB.',
      },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit')) || 10));
    const status = searchParams.get('status');
    const searchParam = searchParams.get('search');
    const formIdParam = searchParams.get('formId');
    const companyIdParam = searchParams.get('companyId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const query = {};

    // Role-based scoping
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
      if (companyIdParam && companyIdParam !== 'all') {
        if (mongoose.Types.ObjectId.isValid(companyIdParam)) {
          const compId = new mongoose.Types.ObjectId(companyIdParam);
          query.companyId = { $in: [compId, companyIdParam] };
        } else {
          query.companyId = companyIdParam;
        }
      }
    }

    if (formIdParam && formIdParam.trim() && formIdParam !== 'all') {
      const cleanFormId = formIdParam.trim();
      if (mongoose.Types.ObjectId.isValid(cleanFormId)) {
        query.formId = { $in: [new mongoose.Types.ObjectId(cleanFormId), cleanFormId] };
      } else {
        query.formId = cleanFormId;
      }
    }

    if (status && status !== 'all') {
      const lower = status.toLowerCase();
      if (lower === 'new' || lower === 'pending' || lower === 'new / pending') {
        query.status = { $in: [/^new$/i, /^pending$/i, /^new \/ pending$/i] };
      } else {
        const valid = VALID_STATUSES.some((v) => v.toLowerCase() === lower);
        if (!valid) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid status parameter. Allowed values: ${VALID_STATUSES.join(', ')}`,
            },
            { status: 400 }
          );
        }
        query.status = new RegExp(`^${status}$`, 'i');
      }
    }

    if (searchParam && searchParam.trim()) {
      const escaped = searchParam.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { companyName: regex },
        { contactPerson: regex },
        { email: regex },
        { phone: regex },
        { notes: regex },
        { contactNote: regex },
        { rejectionNote: regex },
      ];
    }

    if (startDateParam || endDateParam) {
      query.createdAt = {};
      if (startDateParam) {
        const start = new Date(startDateParam);
        if (!isNaN(start.getTime())) {
          query.createdAt.$gte = start;
        }
      }
      if (endDateParam) {
        const end = new Date(endDateParam);
        if (!isNaN(end.getTime())) {
          if (endDateParam.length <= 10) {
            end.setUTCHours(23, 59, 59, 999);
          }
          query.createdAt.$lte = end;
        }
      }
      if (Object.keys(query.createdAt).length === 0) {
        delete query.createdAt;
      }
    }

    // Execute query with pagination and populate form details
    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate('formId', 'name title status publicId')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Lead.countDocuments(query),
    ]);

    const formattedLeads = leads.map((lead) => {
      const populatedForm = lead.formId && typeof lead.formId === 'object' ? lead.formId : null;
      const formIdStr = populatedForm ? populatedForm._id.toString() : lead.formId ? lead.formId.toString() : null;
      const companyIdStr = lead.companyId ? lead.companyId.toString() : null;
      const formName =
        populatedForm?.title ||
        populatedForm?.name ||
        lead.formName ||
        null;

      return {
        ...lead,
        companyId: companyIdStr,
        formId: formIdStr,
        form: populatedForm,
        formName: formName,
        contactNote: lead.contactNote || lead.notes || '',
        rejectionNote: lead.rejectionNote || '',
      };
    });

    return NextResponse.json(
      {
        success: true,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
        data: formattedLeads,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred while fetching leads.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leads
 * Manually creates a new lead under the company scope.
 */
export async function POST(request) {
  // Authenticate session to associate lead with company
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      {
        success: false,
        error: session.error || 'Unauthorized. Authentication is required to submit lead records.',
      },
      { status: session.statusCode || 401 }
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Database is unavailable. Could not establish connection to MongoDB.',
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  if (!body.companyName || typeof body.companyName !== 'string' || body.companyName.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'Company name is required.' },
      { status: 400 }
    );
  }

  if (body.status !== undefined) {
    const lower = String(body.status).toLowerCase();
    const match = VALID_STATUSES.find((v) => v.toLowerCase() === lower);
    if (!match) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid status. Allowed values: ${VALID_STATUSES.join(', ')}`,
        },
        { status: 400 }
      );
    }
  }

  // Derive target company ID
  let targetCompanyId = session.user.companyId;
  if (session.user.role === 'super_admin' && body.companyId) {
    targetCompanyId = body.companyId;
  }

  if (!targetCompanyId || !mongoose.Types.ObjectId.isValid(targetCompanyId)) {
    return NextResponse.json(
      { success: false, error: 'A valid company association is required to create a lead.' },
      { status: 400 }
    );
  }

  try {
    let formName = body.formName || '';
    if (body.formId && mongoose.Types.ObjectId.isValid(body.formId)) {
      const associatedForm = await Form.findById(body.formId).lean();
      if (associatedForm) {
        formName = associatedForm.title || associatedForm.name || formName;
      }
    }

    const leadData = {
      companyId: targetCompanyId,
      companyName: body.companyName.trim(),
      contactPerson: body.contactPerson ? body.contactPerson.trim() : '',
      email: body.email ? body.email.trim().toLowerCase() : undefined,
      phone: body.phone ? body.phone.trim() : undefined,
      status: body.status || 'New',
      source: body.source ? body.source.trim() : 'manual',
      dealValue: body.dealValue !== undefined ? Number(body.dealValue) : 0,
      notes: body.contactNote || body.notes ? String(body.contactNote || body.notes).trim() : '',
      contactNote: body.contactNote ? String(body.contactNote).trim() : (body.notes ? String(body.notes).trim() : ''),
      rejectionNote: body.rejectionNote ? String(body.rejectionNote).trim() : '',
      formId: body.formId && mongoose.Types.ObjectId.isValid(body.formId) ? body.formId : null,
      formName: formName,
      submissionData: body.submissionData || {},
    };

    const newLead = await Lead.create(leadData);

    return NextResponse.json(
      {
        success: true,
        message: 'Lead created successfully.',
        data: newLead,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return NextResponse.json(
        { success: false, error: messages.join(' ') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred while creating the lead.',
      },
      { status: 500 }
    );
  }
}
