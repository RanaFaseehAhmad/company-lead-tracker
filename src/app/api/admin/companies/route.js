import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Company from '@/models/Company';
import Form from '@/models/Form';
import Lead from '@/models/Lead';
import { getAuthSession, hashPassword } from '@/lib/auth';

const VALID_COMPANY_STATUSES = ['pending', 'approved', 'blocked'];

export async function POST(request) {
  try {
    // 1. Authorize: Super Admin only
    const session = await getAuthSession(request);
    if (session.error || !session.user) {
      return NextResponse.json(
        { success: false, error: session.error || 'Authentication required.' },
        { status: session.statusCode || 401 }
      );
    }

    if (session.user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
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

    const {
      companyName,
      contactName,
      contactEmail,
      contactPhone,
      status,
      adminName,
      adminEmail,
      adminPassword,
    } = body;

    // 2. Validate input fields
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return NextResponse.json(
        { success: false, error: 'Company name is required.' },
        { status: 400 }
      );
    }

    if (!adminName || typeof adminName !== 'string' || !adminName.trim()) {
      return NextResponse.json(
        { success: false, error: 'Company admin name is required.' },
        { status: 400 }
      );
    }

    if (!adminEmail || typeof adminEmail !== 'string' || !adminEmail.trim()) {
      return NextResponse.json(
        { success: false, error: 'Company admin email is required.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedAdminEmail = adminEmail.trim().toLowerCase();
    if (!emailRegex.test(normalizedAdminEmail)) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid company admin email address.' },
        { status: 400 }
      );
    }

    if (!adminPassword || typeof adminPassword !== 'string' || adminPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Company admin password must be at least 8 characters long.' },
        { status: 400 }
      );
    }

    const companyStatus = status && VALID_COMPANY_STATUSES.includes(status) ? status : 'pending';

    await connectToDatabase();

    // 3. Prevent duplicate company name
    const normalizedCompanyName = companyName.trim();
    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${normalizedCompanyName}$`, 'i') },
    }).lean();

    if (existingCompany) {
      return NextResponse.json(
        { success: false, error: 'A company with this name already exists.' },
        { status: 409 }
      );
    }

    // 4. Prevent duplicate user email
    const existingUser = await User.findOne({ email: normalizedAdminEmail }).lean();
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'A user with this email address already exists.' },
        { status: 409 }
      );
    }

    // 5. Creation with safe cleanup compensation
    let createdCompany = null;
    try {
      createdCompany = await Company.create({
        name: normalizedCompanyName,
        status: companyStatus,
        contactName: contactName?.trim() || adminName.trim(),
        contactEmail: contactEmail?.trim()?.toLowerCase() || normalizedAdminEmail,
        contactPhone: contactPhone?.trim() || '',
      });

      const passwordHash = await hashPassword(adminPassword);

      // Create company admin, strictly enforcing role = 'company_admin'
      const createdAdmin = await User.create({
        name: adminName.trim(),
        email: normalizedAdminEmail,
        passwordHash,
        role: 'company_admin', // Enforced server-side, never accepts client override
        companyId: createdCompany._id,
        status: 'active',
      });

      return NextResponse.json(
        {
          success: true,
          message: 'Company and initial Company Admin created successfully.',
          company: {
            id: createdCompany._id.toString(),
            name: createdCompany.name,
            status: createdCompany.status,
            contactName: createdCompany.contactName,
            contactEmail: createdCompany.contactEmail,
            contactPhone: createdCompany.contactPhone,
            createdAt: createdCompany.createdAt,
          },
          admin: {
            id: createdAdmin._id.toString(),
            name: createdAdmin.name,
            email: createdAdmin.email,
            role: createdAdmin.role,
            status: createdAdmin.status,
          },
        },
        { status: 201 }
      );
    } catch (creationError) {
      // Rollback company if admin user creation failed
      if (createdCompany && createdCompany._id) {
        try {
          await Company.findByIdAndDelete(createdCompany._id);
        } catch {
          // Log or handle rollback error
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: creationError.message || 'Failed to create company and admin account.',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request) {
  try {
    const session = await getAuthSession(request);
    if (session.error || !session.user) {
      return NextResponse.json(
        { success: false, error: session.error || 'Authentication required.' },
        { status: session.statusCode || 401 }
      );
    }

    if (session.user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status')?.toLowerCase()?.trim();
    const searchParam = searchParams.get('search')?.trim();
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');

    const ALLOWED_FILTERS = ['pending', 'approved', 'blocked', 'all'];
    if (statusParam && !ALLOWED_FILTERS.includes(statusParam)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid status filter. Allowed values: ${ALLOWED_FILTERS.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    let page = 1;
    if (pageParam !== null && pageParam !== undefined) {
      const parsedPage = parseInt(pageParam, 10);
      if (!/^\d+$/.test(pageParam.trim()) || isNaN(parsedPage) || parsedPage <= 0) {
        return NextResponse.json(
          { success: false, error: 'Page must be a positive integer.' },
          { status: 400 }
        );
      }
      page = parsedPage;
    }

    let limit = 10;
    const ALLOWED_LIMITS = [10, 25, 50];
    if (limitParam !== null && limitParam !== undefined) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!/^\d+$/.test(limitParam.trim()) || isNaN(parsedLimit) || !ALLOWED_LIMITS.includes(parsedLimit)) {
        return NextResponse.json(
          {
            success: false,
            error: `Limit must be one of: ${ALLOWED_LIMITS.join(', ')}.`,
          },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    await connectToDatabase();

    const query = {};
    if (statusParam && statusParam !== 'all') {
      query.status = statusParam;
    }

    if (searchParam) {
      const safeSearch = escapeRegex(searchParam);
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { contactEmail: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [totalMatching, companies, statusCountsRaw, totalForms, totalLeads] =
      await Promise.all([
        Company.countDocuments(query),
        Company.find(query)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Company.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Form.countDocuments(),
        Lead.countDocuments(),
      ]);

    const companyIds = companies.map((c) => c._id);
    const [formCounts, leadCounts] = companyIds.length > 0
      ? await Promise.all([
          Form.aggregate([
            { $match: { companyId: { $in: companyIds } } },
            { $group: { _id: '$companyId', count: { $sum: 1 } } },
          ]),
          Lead.aggregate([
            { $match: { companyId: { $in: companyIds } } },
            { $group: { _id: '$companyId', count: { $sum: 1 } } },
          ]),
        ])
      : [[], []];

    const formsMap = {};
    formCounts.forEach((f) => {
      if (f._id) formsMap[f._id.toString()] = f.count;
    });

    const leadsMap = {};
    leadCounts.forEach((l) => {
      if (l._id) leadsMap[l._id.toString()] = l.count;
    });

    const statusCounts = {
      pending: 0,
      approved: 0,
      blocked: 0,
      all: 0,
    };
    let totalCompanies = 0;
    statusCountsRaw.forEach((s) => {
      if (s._id && Object.prototype.hasOwnProperty.call(statusCounts, s._id)) {
        statusCounts[s._id] = s.count;
      }
      totalCompanies += s.count;
    });
    statusCounts.all = totalCompanies;

    const enriched = companies.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      status: c.status,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      createdAt: c.createdAt,
      formsCount: formsMap[c._id.toString()] || 0,
      leadsCount: leadsMap[c._id.toString()] || 0,
    }));

    const totalPages = Math.ceil(totalMatching / limit) || 1;

    const totals = {
      totalCompanies,
      approvedCompanies: statusCounts.approved,
      pendingCompanies: statusCounts.pending,
      blockedCompanies: statusCounts.blocked,
      totalForms,
      totalLeads,
    };

    return NextResponse.json({
      success: true,
      totals,
      statusCounts,
      pagination: {
        page,
        limit,
        totalRecords: totalMatching,
        totalPages,
      },
      data: enriched,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve companies.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const session = await getAuthSession(request);
    if (session.error || !session.user) {
      return NextResponse.json(
        { success: false, error: session.error || 'Authentication required.' },
        { status: session.statusCode || 401 }
      );
    }

    if (session.user.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
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

    const { companyId, status } = body || {};

    if (!companyId || typeof companyId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Company ID is required.' },
        { status: 400 }
      );
    }

    if (!status || !VALID_COMPANY_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Status must be one of: ${VALID_COMPANY_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const company = await Company.findByIdAndUpdate(
      companyId,
      { status },
      { new: true }
    ).lean();

    if (!company) {
      return NextResponse.json(
        { success: false, error: 'Company not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Company status updated to ${status}.`,
      company: {
        id: company._id.toString(),
        name: company.name,
        status: company.status,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update company status.' },
      { status: 500 }
    );
  }
}

