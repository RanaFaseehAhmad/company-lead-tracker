import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Company from '@/models/Company';
import { verifyPassword, signToken, getCookieOptions } from '@/lib/auth';
import {
  getClientIp,
  reserveAttempt,
  commitReservation,
  releaseReservation,
  cancelReservation,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createRateLimitHeaders,
} from '@/lib/rateLimit';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// Rate Limit Configuration
// IP-level credential limit: Max 10 failed login attempts per source IP per 10 minutes
const IP_MAX_ATTEMPTS = 10;
const IP_WINDOW_SECONDS = 600; // 10 minutes

// Lightweight malformed-request limit to prevent probe abuse without burning credential attempts:
// Max 25 malformed requests per IP per 10 minutes
const MALFORMED_MAX_ATTEMPTS = 25;
const MALFORMED_WINDOW_SECONDS = 600;

// Account failure tracking window
const ACCOUNT_WINDOW_SECONDS = 600; // 10 minutes

export async function POST(request) {
  const clientIp = getClientIp(request);
  const ipLimitKey = `login:ip:${clientIp}`;
  const malformedLimitKey = `login:malformed:ip:${clientIp}`;

  // 1. Check malformed abuse limit first
  const malformedCheck = checkRateLimit(malformedLimitKey, {
    maxAttempts: MALFORMED_MAX_ATTEMPTS,
    windowSeconds: MALFORMED_WINDOW_SECONDS,
  });

  if (!malformedCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many invalid requests from this network. Please try again in ${Math.ceil(malformedCheck.retryAfter / 60)} minute(s).`,
        retryAfter: malformedCheck.retryAfter,
      },
      {
        status: 429,
        headers: {
          ...NO_CACHE_HEADERS,
          ...createRateLimitHeaders(malformedCheck),
        },
      }
    );
  }

  // 2. Race-Safe Synchronous Atomic Attempt Reservation BEFORE ANY asynchronous operation
  const reservation = reserveAttempt(ipLimitKey, {
    maxAttempts: IP_MAX_ATTEMPTS,
    windowSeconds: IP_WINDOW_SECONDS,
  });

  if (!reservation.allowed) {
    const errorMsg = reservation.capacityExhausted
      ? 'Service is temporarily experiencing high authentication traffic. Please try again shortly.'
      : `Too many failed login attempts from this network. Please try again in ${Math.ceil(reservation.retryAfter / 60)} minute(s).`;

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        retryAfter: reservation.retryAfter,
      },
      {
        status: 429,
        headers: {
          ...NO_CACHE_HEADERS,
          ...createRateLimitHeaders(reservation),
        },
      }
    );
  }

  let reservationSettled = false;

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      cancelReservation(ipLimitKey, reservation.reservationId);
      recordFailedAttempt(malformedLimitKey, {
        windowSeconds: MALFORMED_WINDOW_SECONDS,
        maxAttempts: MALFORMED_MAX_ATTEMPTS,
      });
      reservationSettled = true;
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    const { email, password, requiredRole } = body || {};

    // Validate presence
    if (!email || typeof email !== 'string' || !email.trim()) {
      cancelReservation(ipLimitKey, reservation.reservationId);
      recordFailedAttempt(malformedLimitKey, {
        windowSeconds: MALFORMED_WINDOW_SECONDS,
        maxAttempts: MALFORMED_MAX_ATTEMPTS,
      });
      reservationSettled = true;
      return NextResponse.json(
        { success: false, error: 'Email is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (!password || typeof password !== 'string') {
      cancelReservation(ipLimitKey, reservation.reservationId);
      recordFailedAttempt(malformedLimitKey, {
        windowSeconds: MALFORMED_WINDOW_SECONDS,
        maxAttempts: MALFORMED_MAX_ATTEMPTS,
      });
      reservationSettled = true;
      return NextResponse.json(
        { success: false, error: 'Password is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const accountLimitKey = `login:account:${normalizedEmail}`;

    await connectToDatabase();

    // Query user and explicitly select passwordHash
    const user = await User.findOne({ email: normalizedEmail })
      .select('+passwordHash')
      .lean();

    // If user does not exist: commit failure reservation, record account attempt, and return generic 401
    if (!user) {
      commitReservation(ipLimitKey, reservation.reservationId, { windowSeconds: IP_WINDOW_SECONDS });
      recordFailedAttempt(accountLimitKey, { windowSeconds: ACCOUNT_WINDOW_SECONDS });
      reservationSettled = true;

      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // Check account status
    if (user.status !== 'active') {
      commitReservation(ipLimitKey, reservation.reservationId, { windowSeconds: IP_WINDOW_SECONDS });
      reservationSettled = true;
      return NextResponse.json(
        { success: false, error: 'Your account is deactivated. Please contact support.' },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    // Verify password hash
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      commitReservation(ipLimitKey, reservation.reservationId, { windowSeconds: IP_WINDOW_SECONDS });
      recordFailedAttempt(accountLimitKey, { windowSeconds: ACCOUNT_WINDOW_SECONDS });
      reservationSettled = true;

      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // Server-side role enforcement for dedicated login portals
    if (requiredRole && user.role !== requiredRole) {
      commitReservation(ipLimitKey, reservation.reservationId, { windowSeconds: IP_WINDOW_SECONDS });
      recordFailedAttempt(accountLimitKey, { windowSeconds: ACCOUNT_WINDOW_SECONDS });
      reservationSettled = true;

      return NextResponse.json(
        { success: false, error: 'Invalid email or password.' },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // If company admin, verify company status
    let companyData = null;
    if (user.role === 'company_admin') {
      if (!user.companyId) {
        cancelReservation(ipLimitKey, reservation.reservationId);
        reservationSettled = true;
        return NextResponse.json(
          { success: false, error: 'Associated company account not found.' },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }

      const company = await Company.findById(user.companyId).lean();
      if (!company) {
        cancelReservation(ipLimitKey, reservation.reservationId);
        reservationSettled = true;
        return NextResponse.json(
          { success: false, error: 'Associated company account not found.' },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }

      if (company.status === 'pending') {
        cancelReservation(ipLimitKey, reservation.reservationId);
        reservationSettled = true;
        return NextResponse.json(
          {
            success: false,
            error: 'Your company account is currently pending approval by the Super Admin.',
            companyStatus: 'pending',
          },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }

      if (company.status === 'blocked') {
        cancelReservation(ipLimitKey, reservation.reservationId);
        reservationSettled = true;
        return NextResponse.json(
          {
            success: false,
            error: 'Your company account has been suspended. Please contact support.',
            companyStatus: 'blocked',
          },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }

      companyData = {
        id: company._id.toString(),
        name: company.name,
        status: company.status,
      };
    }

    // Successful Authentication:
    // Safely release ONLY this request's reservation token.
    // Does NOT alter or remove any other concurrent request's reservation state.
    releaseReservation(ipLimitKey, reservation.reservationId);
    resetRateLimit(accountLimitKey);
    reservationSettled = true;

    // Sign JWT
    const token = await signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      companyId: user.companyId ? user.companyId.toString() : null,
    });

    const destination =
      user.role === 'super_admin'
        ? '/dashboard/super-admin'
        : '/dashboard/company-admin';

    const safeUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId ? user.companyId.toString() : null,
      company: companyData,
    };

    const cookieOpts = getCookieOptions();
    const response = NextResponse.json(
      {
        success: true,
        message: 'Signed in successfully.',
        user: safeUser,
        redirectTo: destination,
        destination,
      },
      {
        headers: NO_CACHE_HEADERS,
      }
    );

    response.cookies.set(cookieOpts.name, token, {
      httpOnly: cookieOpts.httpOnly,
      secure: cookieOpts.secure,
      sameSite: cookieOpts.sameSite,
      path: cookieOpts.path,
      maxAge: cookieOpts.maxAge,
    });

    return response;
  } catch (error) {
    if (!reservationSettled && reservation?.reservationId) {
      cancelReservation(ipLimitKey, reservation.reservationId);
    }

    const sanitizedMsg = (error?.message || '')
      .replace(/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, 'mongodb+srv://[REDACTED]')
      .replace(/:([^@\s/:?]+)@/g, ':[REDACTED]@');
    console.error(`[Auth Login Error] ${error?.name || 'Error'}: ${sanitizedMsg}`);

    return NextResponse.json(
      { success: false, error: 'An unexpected authentication error occurred.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
