import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';
import Form from '@/models/Form';
import Lead from '@/models/Lead';
import { getAuthSession } from '@/lib/auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

/**
 * GET /api/forms/[id]/analytics
 * Provides real-time aggregated form analytics:
 * - Total submissions
 * - Today's submissions (using UTC midnight policy)
 * - Date-wise submission timeline
 * - Source-wise statistics
 * - Status distribution
 */
export async function GET(request, { params }) {
  const session = await getAuthSession(request);
  if (session.error || !session.user) {
    return NextResponse.json(
      { success: false, error: session.error || 'Authentication required.' },
      { status: session.statusCode || 401, headers: NO_CACHE_HEADERS }
    );
  }

  const { id } = await params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, error: 'Form not found.' },
      { status: 404, headers: NO_CACHE_HEADERS }
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
    const form = await Form.findById(id).lean();
    if (!form) {
      return NextResponse.json(
        { success: false, error: 'Form not found.' },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    // Tenant isolation verification
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

    const formObjectId = new mongoose.Types.ObjectId(id);
    const formIdMatchers = [formObjectId, id.toString()];

    // Documented timezone policy: UTC Start of Day
    const startOfTodayUTC = new Date();
    startOfTodayUTC.setUTCHours(0, 0, 0, 0);

    // Parallel aggregation execution
    const [totalSubmissions, todaySubmissions, dateWise, sourceWise, statusWise] =
      await Promise.all([
        Lead.countDocuments({ formId: { $in: formIdMatchers } }),
        Lead.countDocuments({
          formId: { $in: formIdMatchers },
          createdAt: { $gte: startOfTodayUTC },
        }),
        Lead.aggregate([
          { $match: { formId: { $in: formIdMatchers } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Lead.aggregate([
          { $match: { formId: { $in: formIdMatchers } } },
          {
            $group: {
              _id: { $ifNull: ['$source', 'public_form'] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        Lead.aggregate([
          { $match: { formId: { $in: formIdMatchers } } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
      ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          form: {
            id: form._id.toString(),
            name: form.name,
            title: form.title || form.name,
            publicId: form.publicId,
            status: form.status,
            createdAt: form.createdAt,
          },
          metrics: {
            totalSubmissions,
            todaySubmissions,
            timezonePolicy: 'UTC (00:00:00 midnight)',
          },
          summary: {
            totalSubmissions,
            todaySubmissions,
            timezonePolicy: 'UTC (00:00:00 midnight)',
          },
          dateWise: dateWise.map((d) => ({ date: d._id, count: d.count })),
          timeline: dateWise.map((d) => ({ date: d._id, count: d.count })),
          sourceWise: sourceWise.map((s) => ({ source: s._id, count: s.count })),
          sources: sourceWise.map((s) => ({ source: s._id, count: s.count })),
          statusWise: statusWise.map((st) => ({ status: st._id, count: st.count })),
          statusBreakdown: statusWise.reduce((acc, curr) => {
            acc[String(curr._id).toLowerCase()] = curr.count;
            acc[String(curr._id)] = curr.count;
            return acc;
          }, {}),
        },
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve form analytics.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
