import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Form from '@/models/Form';
import Lead from '@/models/Lead';
import { getAuthSession } from '@/lib/auth';
import { validateFields, fieldsToSchema, labelToKey } from '@/lib/forms';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

/**
 * GET /api/forms/[id]
 * Retrieves single form configuration with tenant boundaries and submission count.
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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
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
    const form = await Form.findById(id).populate('companyId', 'name status').lean();

    if (!form) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404 }
      );
    }

    // Tenant boundary authorization check
    const formCompanyId = (form.companyId?._id || form.companyId)?.toString();
    if (
      session.user.role === 'company_admin' &&
      formCompanyId !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    const formObjId = mongoose.Types.ObjectId.isValid(form._id) ? new mongoose.Types.ObjectId(form._id) : form._id;
    const submissionsCount = await Lead.countDocuments({
      formId: { $in: [formObjId, form._id.toString()] },
    });

    const title = form.title || form.name;
    const schema = fieldsToSchema(title, form.fields);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...form,
          title,
          name: form.name || title,
          schema,
          submissionsCount,
        },
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve form.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

/**
 * PATCH /api/forms/[id]
 * Updates form settings, field configurations, or publication status.
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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
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
    const form = await Form.findById(id);
    if (!form) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404 }
      );
    }

    // Tenant boundary authorization check
    const formCompanyId = (form.companyId?._id || form.companyId)?.toString();
    if (
      session.user.role === 'company_admin' &&
      formCompanyId !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    // Apply title / name updates
    const newTitle = body.title !== undefined ? body.title : body.name;
    if (newTitle !== undefined) {
      if (typeof newTitle !== 'string' || !newTitle.trim()) {
        return NextResponse.json(
          { success: false, error: 'Form name cannot be empty.' },
          { status: 400 }
        );
      }
      form.name = newTitle.trim();
      form.title = newTitle.trim();
    }

    if (body.description !== undefined) {
      form.description = typeof body.description === 'string' ? body.description.trim() : '';
    }

    if (body.status !== undefined && !['draft', 'published', 'archived'].includes(body.status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status value.' },
        { status: 400 }
      );
    }

    if (body.status === 'archived' && form.status === 'published') {
      return NextResponse.json(
        { success: false, error: 'Cannot archive an active published form. Please unpublish it first.' },
        { status: 400 }
      );
    }

    if (form.status === 'archived' && body.status === 'published') {
      return NextResponse.json(
        { success: false, error: 'Cannot directly publish an archived form. Restore it to draft first.' },
        { status: 400 }
      );
    }

    const targetStatus = body.status !== undefined ? body.status : form.status;
    const isPublishing = targetStatus === 'published';

    if (body.fields !== undefined) {
      const usedKeys = new Set();
      const rawFields = Array.isArray(body.fields) ? body.fields : [];
      const targetFields = rawFields.map((f, idx) => {
        let name = (f.key || f.name || labelToKey(f.label, idx, usedKeys)).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!name) name = `field_${idx + 1}`;
        let uniqueName = name;
        let counter = 2;
        while (usedKeys.has(uniqueName)) {
          uniqueName = `${name}_${counter}`;
          counter++;
        }
        usedKeys.add(uniqueName);

        return {
          id: (f.id || `field_${idx}`).trim(),
          type: f.type || 'text',
          label: (f.label || f.name || 'Field').trim(),
          name: uniqueName,
          required: Boolean(f.required),
          placeholder: f.placeholder?.trim() || '',
          options: (f.type === 'dropdown' || f.type === 'select' || f.type === 'radio') && Array.isArray(f.options)
            ? f.options.map((o) => String(o).trim()).filter(Boolean)
            : undefined,
          validation: f.validation || undefined,
          order: typeof f.order === 'number' ? f.order : idx,
        };
      });

      const fieldValidation = validateFields(targetFields, isPublishing);
      if (!fieldValidation.valid) {
        return NextResponse.json(
          { success: false, error: fieldValidation.error },
          { status: 400 }
        );
      }

      form.fields = targetFields;
      form.markModified('fields');
    } else if (isPublishing) {
      const fieldValidation = validateFields(form.fields || [], true);
      if (!fieldValidation.valid) {
        return NextResponse.json(
          { success: false, error: fieldValidation.error },
          { status: 400 }
        );
      }
    }

    if (body.status !== undefined) {
      form.status = targetStatus;
    }

    await form.save();

    const formObj = form.toObject ? form.toObject() : form;
    formObj.schema = fieldsToSchema(form.title || form.name, form.fields);

    return NextResponse.json({
      success: true,
      message: 'Form updated successfully.',
      data: formObj,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return NextResponse.json(
        { success: false, error: messages.join(' ') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update form.' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/forms/[id]
 * Deletes form record with tenant scoping.
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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
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
    const form = await Form.findById(id);
    if (!form) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404 }
      );
    }

    const formCompanyId = (form.companyId?._id || form.companyId)?.toString();
    if (
      session.user.role === 'company_admin' &&
      formCompanyId !== session.user.companyId
    ) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404 }
      );
    }

    if (form.status === 'published') {
      return NextResponse.json(
        { success: false, error: 'Cannot archive an active published form. Please unpublish it first.' },
        { status: 400 }
      );
    }

    form.status = 'archived';
    await form.save();

    return NextResponse.json({
      success: true,
      message: 'Form archived successfully. Historical submissions and analytics remain intact.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete form.' },
      { status: 500 }
    );
  }
}
