import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Form from '@/models/Form';
import Company from '@/models/Company';
import Lead from '@/models/Lead';
import { validateSubmission, mapSubmissionToLead } from '@/lib/forms';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * POST /api/public/forms/[publicId]/submissions
 * Validates and records visitor submissions into the company tenant's Lead pool.
 */
export async function POST(request, { params }) {
  const { publicId } = await params;

  if (!publicId || typeof publicId !== 'string' || publicId.trim().length < 8) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  let body;
  try {
    const rawText = await request.text();
    if (rawText.length > 65536) {
      return NextResponse.json(
        { success: false, error: 'Payload exceeds maximum allowed size.' },
        { status: 413, headers: CORS_HEADERS }
      );
    }
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request format.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const rawValues =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data
      : body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? body.values
      : body;

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database service is temporarily unavailable.' },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const form = await Form.findOne({
      publicId: publicId.trim(),
      status: 'published',
    }).lean();

    if (!form) {
      return NextResponse.json(
        { success: false, error: 'Form not found or is no longer accepting submissions.' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const company = await Company.findById(form.companyId).lean();
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Form not found or is no longer accepting submissions.' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    if (company.status === 'blocked') {
      return NextResponse.json(
        { success: false, error: 'This company account is currently blocked and cannot accept submissions.' },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    if (company.status !== 'approved') {
      return NextResponse.json(
        { success: false, error: 'Form not found or is no longer accepting submissions.' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Native custom field submission validation
    const validation = validateSubmission(form, rawValues);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const sanitizedValues = validation.sanitizedValues;

    // Standard Lead model mapping
    const mappedLead = mapSubmissionToLead(form, sanitizedValues);

    const refererHeader =
      request.headers.get('referer') ||
      (typeof body?._referrer === 'string' ? body._referrer : '') ||
      '';
    const { searchParams } = new URL(request.url);
    const sourceParam =
      searchParams.get('source') ||
      searchParams.get('utm_source') ||
      (typeof body?._source === 'string' ? body._source : null) ||
      (typeof body?.source === 'string' ? body.source : null) ||
      (typeof rawValues?._source === 'string' ? rawValues._source : null) ||
      (typeof rawValues?.source === 'string' ? rawValues.source : null) ||
      'public_form';

    // Create Lead strictly tied to form's companyId
    const createdLead = await Lead.create({
      companyId: form.companyId,
      formId: form._id,
      formName: form.title || form.name || '',
      companyName: mappedLead.companyName,
      contactPerson: mappedLead.contactPerson,
      email: mappedLead.email,
      phone: mappedLead.phone,
      status: 'New',
      source: String(sourceParam).trim().slice(0, 50),
      referrer: refererHeader.trim().slice(0, 250),
      notes: mappedLead.notes,
      submissionData: sanitizedValues,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Thank you! Your information has been submitted successfully.',
        leadId: createdLead._id.toString(),
      },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('[Public Submission Error]:', error.message || error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while processing your submission.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
