import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Form from '@/models/Form';
import Company from '@/models/Company';
import Lead from '@/models/Lead';
import { getAuthSession } from '@/lib/auth';
import { validateFields, fieldsToSchema, labelToKey } from '@/lib/forms';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

/**
 * GET /api/forms
 * Retrieves forms with company tenant scoping and live submission counts.
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
      { success: false, error: 'Database is unavailable.' },
      { status: 503, headers: NO_CACHE_HEADERS }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const companyIdParam = searchParams.get('companyId');
    const statusParam = searchParams.get('status');

    const query = {};

    if (session.user.role === 'company_admin') {
      if (!session.user.companyId || !mongoose.Types.ObjectId.isValid(session.user.companyId)) {
        return NextResponse.json(
          { success: false, error: 'Valid company association is required.' },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }
      const compId = new mongoose.Types.ObjectId(session.user.companyId);
      query.$or = [{ companyId: compId }, { companyId: session.user.companyId }];
    } else if (session.user.role === 'super_admin') {
      if (companyIdParam && companyIdParam !== 'all') {
        if (mongoose.Types.ObjectId.isValid(companyIdParam)) {
          const compId = new mongoose.Types.ObjectId(companyIdParam);
          query.$or = [{ companyId: compId }, { companyId: companyIdParam }];
        } else {
          query.companyId = companyIdParam;
        }
      }
    }

    if (statusParam && ['draft', 'published', 'archived'].includes(statusParam)) {
      query.status = statusParam;
    }

    const forms = await Form.find(query)
      .populate('companyId', 'name status')
      .sort({ createdAt: -1 })
      .lean();

    // Aggregate lead submission counts per form
    const formIds = forms.map((f) => f._id);
    let countsMap = {};
    if (formIds.length > 0) {
      const matchFormIds = [
        ...formIds,
        ...formIds.map((id) => id.toString()),
        ...formIds.map((id) => {
          try {
            return new mongoose.Types.ObjectId(id);
          } catch {
            return id;
          }
        }),
      ];
      const counts = await Lead.aggregate([
        { $match: { formId: { $in: matchFormIds } } },
        { $group: { _id: '$formId', count: { $sum: 1 } } },
      ]);
      counts.forEach((item) => {
        countsMap[item._id.toString()] = item.count;
      });
    }

    const enrichedForms = forms.map((f) => {
      const title = f.title || f.name;
      const schema = fieldsToSchema(title, f.fields);

      return {
        ...f,
        title,
        name: f.name || title,
        schema,
        submissionsCount: countsMap[f._id.toString()] || 0,
      };
    });

    return NextResponse.json(
      {
        success: true,
        count: enrichedForms.length,
        data: enrichedForms,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve forms.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

/**
 * POST /api/forms
 * Creates a new form using the native custom form engine.
 */
export async function POST(request) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
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

  let targetCompanyId = null;

  if (session.user.role === 'company_admin') {
    targetCompanyId = session.user.companyId;
  } else if (session.user.role === 'super_admin') {
    targetCompanyId = body.companyId;
    if (!targetCompanyId) {
      return NextResponse.json(
        { success: false, error: 'companyId is required when creating a form as Super Admin.' },
        { status: 400 }
      );
    }
  }

  const company = await Company.findById(targetCompanyId).lean();
  if (!company) {
    return NextResponse.json(
      { success: false, error: 'Associated company does not exist.' },
      { status: 404 }
    );
  }

  if (session.user.role === 'company_admin' && company.status !== 'approved') {
    return NextResponse.json(
      { success: false, error: `Company is currently ${company.status} and cannot manage forms.` },
      { status: 403 }
    );
  }

  const formName = (body.title || body.name || '').trim();
  if (!formName) {
    return NextResponse.json(
      { success: false, error: 'Form name is required.' },
      { status: 400 }
    );
  }

  const requestedStatus = body.status === 'published' ? 'published' : 'draft';
  const isPublishing = requestedStatus === 'published';

  const usedKeys = new Set();
  let rawFields = Array.isArray(body.fields) ? body.fields : [];
  if (rawFields.length === 0 && (Array.isArray(body.formioSchema?.components) || Array.isArray(body.schema?.components))) {
    const comps = Array.isArray(body.formioSchema?.components) ? body.formioSchema.components : body.schema.components;
    rawFields = comps
      .filter((c) => c && c.type !== 'button')
      .map((c, idx) => {
        let fieldType = c.type;
        if (fieldType === 'textfield') fieldType = 'text';
        else if (fieldType === 'select') fieldType = 'dropdown';
        else if (fieldType === 'datetime') fieldType = 'date';
        else if (fieldType === 'number') fieldType = 'number';
        else if (fieldType === 'radio') fieldType = 'radio';
        else if (fieldType === 'checkbox') fieldType = 'checkbox';
        else if (fieldType === 'textarea') fieldType = 'textarea';
        else if (fieldType === 'email') fieldType = 'email';
        else if (fieldType === 'phoneNumber' || fieldType === 'tel') fieldType = 'phone';

        let opts = Array.isArray(c.values)
          ? c.values.map((v) => (typeof v === 'object' ? v.value || v.label : String(v)).trim())
          : (Array.isArray(c.data?.values)
             ? c.data.values.map((v) => (typeof v === 'object' ? v.value || v.label : String(v)).trim())
             : undefined);
        if ((fieldType === 'dropdown' || fieldType === 'select' || fieldType === 'radio') && (!opts || opts.filter(Boolean).length === 0)) {
          opts = ['Option 1', 'Option 2'];
        }

        return {
          id: (c.id || c.key || ield_).trim(),
          type: fieldType || 'text',
          label: (c.label || c.key || Field ).trim(),
          name: (c.key || ield_).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          required: Boolean(c.validate?.required || c.required),
          placeholder: c.placeholder?.trim() || '',
          options: opts,
        };
      });
  }
  const finalFields = rawFields.map((f, idx) => {
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

  const fieldValidation = validateFields(finalFields, isPublishing);
  if (!fieldValidation.valid) {
    return NextResponse.json(
      { success: false, error: fieldValidation.error },
      { status: 400 }
    );
  }

  const finalSchema = fieldsToSchema(formName, finalFields);
  const publicId = crypto.randomBytes(12).toString('hex');

  try {
    const companyObjectId = new mongoose.Types.ObjectId(targetCompanyId);
    const form = await Form.create({
      name: formName,
      title: formName,
      description: body.description?.trim() || '',
      companyId: companyObjectId,
      fields: finalFields,
      status: requestedStatus,
      publicId,
      createdBy: session.user.id,
      formioSchema: body.formioSchema || body.schema || null,
    });

    const formObj = form.toObject ? form.toObject() : form;
    formObj.title = formName;
    formObj.name = formName;
    formObj.schema = finalSchema;

    return NextResponse.json(
      {
        success: true,
        message: 'Form created successfully.',
        data: formObj,
      },
      { status: 201, headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return NextResponse.json(
        { success: false, error: messages.join(' ') },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create form.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
