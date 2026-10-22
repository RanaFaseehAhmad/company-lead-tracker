import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Company from '@/models/Company';
import { getAuthSession } from '@/lib/auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/company/settings
 * Retrieves the authenticated company's profile information.
 * Scoped strictly to the authenticated Company Admin session.
 */
export async function GET(request) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
    );
  }

  if (session.user.role !== 'company_admin' || !session.user.companyId) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized to access company settings.' },
      { status: 403 }
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
    const company = await Company.findById(session.user.companyId).lean();
    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Company not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      company: {
        id: company._id.toString(),
        name: company.name || '',
        contactName: company.contactName || '',
        contactEmail: company.contactEmail || '',
        contactPhone: company.contactPhone || '',
        website: company.website || '',
        address: company.address || '',
        status: company.status || 'pending',
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      },
    });
  } catch (error) {
    console.error('[GET Company Settings Error]:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve company settings.' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/company/settings
 * Updates editable profile fields for the authenticated company.
 * Strictly derives companyId from the session; ignores client-supplied companyId.
 * Prevents modifications to privileged fields (status, role, subscription).
 */
export async function PATCH(request) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401 }
    );
  }

  if (session.user.role !== 'company_admin' || !session.user.companyId) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized to modify company settings.' },
      { status: 403 }
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

  // Reject attempt to modify privileged fields
  if (
    body.status !== undefined ||
    body.role !== undefined ||
    body.subscription !== undefined ||
    body.isSuperAdmin !== undefined
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'Modifying privileged fields (status, role, subscription) is strictly forbidden.',
      },
      { status: 403 }
    );
  }

  const company = await Company.findById(session.user.companyId);
  if (!company) {
    return NextResponse.json(
      { success: false, error: 'Company not found.' },
      { status: 404 }
    );
  }

  // Validate Company Name
  if (body.name !== undefined) {
    const trimmedName = String(body.name).trim();
    if (!trimmedName) {
      return NextResponse.json(
        { success: false, error: 'Company name cannot be empty.' },
        { status: 400 }
      );
    }
    if (trimmedName.length > 120) {
      return NextResponse.json(
        { success: false, error: 'Company name cannot exceed 120 characters.' },
        { status: 400 }
      );
    }

    // Check duplicate name if changed
    if (trimmedName.toLowerCase() !== company.name.toLowerCase()) {
      const duplicate = await Company.findOne({
        _id: { $ne: company._id },
        name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      });
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: 'A company with this name already exists. Please choose a different name.' },
          { status: 409 }
        );
      }
    }
    company.name = trimmedName;
  }

  // Validate Contact Person Name
  if (body.contactName !== undefined) {
    const trimmed = String(body.contactName).trim();
    if (trimmed.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Contact person name cannot exceed 100 characters.' },
        { status: 400 }
      );
    }
    company.contactName = trimmed;
  }

  // Validate Contact Email
  if (body.contactEmail !== undefined) {
    const trimmed = String(body.contactEmail).trim().toLowerCase();
    if (trimmed && !EMAIL_REGEX.test(trimmed)) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid contact email address.' },
        { status: 400 }
      );
    }
    company.contactEmail = trimmed;
  }

  // Validate Contact Phone
  if (body.contactPhone !== undefined) {
    const trimmed = String(body.contactPhone).trim();
    if (trimmed.length > 30) {
      return NextResponse.json(
        { success: false, error: 'Contact phone cannot exceed 30 characters.' },
        { status: 400 }
      );
    }
    company.contactPhone = trimmed;
  }

  // Validate Website
  if (body.website !== undefined) {
    const trimmed = String(body.website).trim();
    if (trimmed.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Website URL cannot exceed 200 characters.' },
        { status: 400 }
      );
    }
    company.website = trimmed;
  }

  // Validate Address
  if (body.address !== undefined) {
    const trimmed = String(body.address).trim();
    if (trimmed.length > 300) {
      return NextResponse.json(
        { success: false, error: 'Business address cannot exceed 300 characters.' },
        { status: 400 }
      );
    }
    company.address = trimmed;
  }

  try {
    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Company profile updated successfully.',
      company: {
        id: company._id.toString(),
        name: company.name,
        contactName: company.contactName || '',
        contactEmail: company.contactEmail || '',
        contactPhone: company.contactPhone || '',
        website: company.website || '',
        address: company.address || '',
        status: company.status,
        updatedAt: company.updatedAt,
      },
    });
  } catch (error) {
    console.error('[PATCH Company Settings Error]:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update company settings.' },
      { status: 500 }
    );
  }
}
