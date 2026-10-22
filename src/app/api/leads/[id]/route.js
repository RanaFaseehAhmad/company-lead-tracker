import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Form from '@/models/Form';
import { getAuthSession } from '@/lib/auth';

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
  'approved',
  'contacted',
  'qualified',
  'converted',
  'rejected',
  'lost',
  'pending',
  'New / Pending',
];

/**
 * GET /api/leads/[id]
 * Retrieves single lead details with form and company populated.
 */
export async function GET(request, { params }) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
    );
  }

  const { id } = await params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Lead not found.' },
      { status: 404 }
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database is unavailable.' },
      { status: 503 }
    );
  }

  try {
    const lead = await Lead.findById(id)
      .populate('formId', 'name title status publicId formioSchema fields')
      .populate('companyId', 'name status')
      .lean();

    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Tenant isolation check
    if (
      session.user.role === 'company_admin' &&
      lead.companyId?._id?.toString() !== session.user.companyId &&
      lead.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
      );
    }

    const formName =
      (lead.formId && typeof lead.formId === 'object' ? lead.formId.title || lead.formId.name : null) ||
      lead.formName ||
      'Unknown Form';

    return NextResponse.json({
      success: true,
      data: {
        ...lead,
        formName,
        contactNote: lead.contactNote || lead.notes || '',
        rejectionNote: lead.rejectionNote || '',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve lead.' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/leads/[id]
 * Updates lead status or notes with tenant authorization.
 */
export async function PATCH(request, { params }) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
    );
  }

  const { id } = await params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Lead not found.' },
      { status: 404 }
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

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database is unavailable.' },
      { status: 503 }
    );
  }

  try {
    const lead = await Lead.findById(id);
    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Tenant isolation check
    if (
      session.user.role === 'company_admin' &&
      lead.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
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
      if (lower === 'new / pending' || lower === 'new' || lower === 'pending') {
        lead.status = 'New';
      } else {
        lead.status = body.status;
      }
    }

    if (body.contactNote !== undefined) {
      const cNote = typeof body.contactNote === 'string' ? body.contactNote.trim().slice(0, 1000) : '';
      lead.contactNote = cNote;
      lead.notes = cNote;
    }

    if (body.rejectionNote !== undefined) {
      lead.rejectionNote = typeof body.rejectionNote === 'string' ? body.rejectionNote.trim().slice(0, 1000) : '';
    }

    if (body.notes !== undefined && body.contactNote === undefined) {
      lead.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : '';
      lead.contactNote = lead.notes;
    }

    if (body.dealValue !== undefined) {
      const val = Number(body.dealValue);
      if (!isNaN(val) && val >= 0) {
        lead.dealValue = val;
      }
    }

    if (body.contactPerson !== undefined && typeof body.contactPerson === 'string') {
      lead.contactPerson = body.contactPerson.trim().slice(0, 100);
    }

    if (body.phone !== undefined && typeof body.phone === 'string') {
      lead.phone = body.phone.trim().slice(0, 30);
    }

    await lead.save();

    return NextResponse.json({
      success: true,
      message: 'Lead updated successfully.',
      data: lead,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update lead.' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leads/[id]
 * Deletes a lead record with tenant authorization.
 */
export async function DELETE(request, { params }) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
    );
  }

  const { id } = await params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Lead not found.' },
      { status: 404 }
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database is unavailable.' },
      { status: 503 }
    );
  }

  try {
    const lead = await Lead.findById(id);
    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
      );
    }

    if (
      session.user.role === 'company_admin' &&
      lead.companyId?.toString() !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Lead not found.' },
        { status: 404 }
      );
    }

    await Lead.findByIdAndDelete(id);

    return NextResponse.json({
      success: true,
      message: 'Lead deleted successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete lead.' },
      { status: 500 }
    );
  }
}
