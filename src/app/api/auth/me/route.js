import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET(request) {
  try {
    const session = await getAuthSession(request);

    if (session.error || !session.user) {
      return NextResponse.json(
        {
          success: false,
          error: session.error || 'Authentication required.',
          companyStatus: session.companyStatus || null,
        },
        {
          status: session.statusCode || 401,
          headers: NO_CACHE_HEADERS,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        user: session.user,
        company: session.company,
      },
      {
        status: 200,
        headers: NO_CACHE_HEADERS,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve user profile.' },
      {
        status: 500,
        headers: NO_CACHE_HEADERS,
      }
    );
  }
}
