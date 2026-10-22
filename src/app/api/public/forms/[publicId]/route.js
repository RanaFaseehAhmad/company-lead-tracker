import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Form from '@/models/Form';
import Company from '@/models/Company';
import { fieldsToSchema } from '@/lib/forms';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/public/forms/[publicId]
 * Retrieves public form metadata for rendering standalone or within an iframe.
 * Unauthenticated. Only returns published forms belonging to approved companies.
 */
export async function GET(request, { params }) {
  const { publicId } = await params;

  if (!publicId || typeof publicId !== 'string' || publicId.trim().length < 8) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database service is temporarily unavailable.' },
      { status: 503 }
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

    // Verify company is active and approved
    const company = await Company.findById(form.companyId).lean();
    if (!company || company.status !== 'approved') {
      return NextResponse.json(
        { success: false, error: 'Form not found or is no longer accepting submissions.' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const title = form.title || form.name;
    const schema = form.schema || fieldsToSchema(title, form.fields);

    const publicFormData = {
      publicId: form.publicId,
      name: form.name || title,
      title,
      description: form.description || '',
      companyName: company.name,
      schema,
      fields: (form.fields || []).map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        name: f.name,
        key: f.name,
        required: Boolean(f.required),
        placeholder: f.placeholder || '',
        options: f.options || [],
        validation: f.validation || undefined,
        order: f.order,
      })),
    };

    return NextResponse.json(
      {
        success: true,
        data: publicFormData,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to load form.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
