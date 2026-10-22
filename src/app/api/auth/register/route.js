import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Company from '@/models/Company';
import { hashPassword } from '@/lib/auth';
import {
  getClientIp,
  checkRateLimit,
  recordFailedAttempt,
  createRateLimitHeaders,
} from '@/lib/rateLimit';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// Registration Rate Limit: Max 5 registration attempts per IP per hour
const REGISTER_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_SECONDS = 3600; // 1 hour

// Maximum request body size to prevent memory exhaustion (16 KB)
const MAX_PAYLOAD_BYTES = 16384;

export async function POST(request) {
  try {
    const clientIp = getClientIp(request);
    const regLimitKey = `register:ip:${clientIp}`;

    // 1. IP-level rate limit check
    const regLimit = checkRateLimit(regLimitKey, {
      maxAttempts: REGISTER_MAX_ATTEMPTS,
      windowSeconds: REGISTER_WINDOW_SECONDS,
    });

    if (!regLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many registration attempts from this network. Please try again in ${Math.ceil(regLimit.retryAfter / 60)} minute(s).`,
          retryAfter: regLimit.retryAfter,
        },
        {
          status: 429,
          headers: {
            ...NO_CACHE_HEADERS,
            ...createRateLimitHeaders(regLimit),
          },
        }
      );
    }

    // 2. Request size validation before expensive parsing
    let rawText;
    try {
      rawText = await request.text();
      if (rawText.length > MAX_PAYLOAD_BYTES) {
        recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
        return NextResponse.json(
          { success: false, error: 'Registration payload exceeds maximum allowed size.' },
          { status: 413, headers: NO_CACHE_HEADERS }
        );
      }
    } catch {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Failed to read request body.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    let body;
    try {
      body = JSON.parse(rawText);
    } catch {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    const {
      companyName,
      adminName,
      adminEmail,
      contactPhone,
      password,
      confirmPassword,
      termsAccepted,
    } = body || {};

    // 3. Strict server-side input validation
    // Abusive malformed attempts decrement the rate limit quota to prevent probe attacks
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Company name is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (companyName.trim().length > 120) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Company name cannot exceed 120 characters.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (!adminName || typeof adminName !== 'string' || !adminName.trim()) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Administrator name is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (adminName.trim().length > 100) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Administrator name cannot exceed 100 characters.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (!adminEmail || typeof adminEmail !== 'string' || !adminEmail.trim()) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Work email address is required.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedAdminEmail = adminEmail.trim().toLowerCase();
    if (!emailRegex.test(normalizedAdminEmail)) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Please provide a valid work email address.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (contactPhone && (typeof contactPhone !== 'string' || contactPhone.trim().length > 30)) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Contact phone cannot exceed 30 characters.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters long.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (confirmPassword && confirmPassword !== password) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'Passwords do not match.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    if (termsAccepted !== true) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'You must agree to the Terms of Service to register.' },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    await connectToDatabase();

    // Prevent duplicate company name (case-insensitive)
    const normalizedCompanyName = companyName.trim();
    const existingCompany = await Company.findOne({
      name: { $regex: new RegExp(`^${normalizedCompanyName.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    }).lean();

    if (existingCompany) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'A company with this name already exists. Please choose another name or sign in.' },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }

    // Prevent duplicate user email
    const existingUser = await User.findOne({ email: normalizedAdminEmail }).lean();
    if (existingUser) {
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });
      return NextResponse.json(
        { success: false, error: 'An account with this email address already exists. Please sign in.' },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }

    // Security Enforcement:
    // Status is ALWAYS 'pending', role is ALWAYS 'company_admin'.
    let createdCompany = null;
    try {
      createdCompany = await Company.create({
        name: normalizedCompanyName,
        status: 'pending', // Enforced server-side: must be approved by Super Admin
        contactName: adminName.trim(),
        contactEmail: normalizedAdminEmail,
        contactPhone: contactPhone ? contactPhone.trim() : '',
      });

      const passwordHash = await hashPassword(password);

      const createdUser = await User.create({
        name: adminName.trim(),
        email: normalizedAdminEmail,
        passwordHash,
        role: 'company_admin', // Enforced server-side: public users can NEVER become super_admin
        companyId: createdCompany._id,
        status: 'active',
      });

      // Record successful registration against rate limit quota
      recordFailedAttempt(regLimitKey, { windowSeconds: REGISTER_WINDOW_SECONDS });

      return NextResponse.json(
        {
          success: true,
          message: 'Company registration submitted successfully. Your account is pending Super Admin review.',
          company: {
            id: createdCompany._id.toString(),
            name: createdCompany.name,
            status: createdCompany.status,
            contactName: createdCompany.contactName,
            contactEmail: createdCompany.contactEmail,
            contactPhone: createdCompany.contactPhone,
            createdAt: createdCompany.createdAt,
          },
          user: {
            id: createdUser._id.toString(),
            name: createdUser.name,
            email: createdUser.email,
            role: createdUser.role,
          },
        },
        {
          status: 201,
          headers: NO_CACHE_HEADERS,
        }
      );
    } catch (creationError) {
      if (createdCompany && createdCompany._id) {
        try {
          await Company.findByIdAndDelete(createdCompany._id);
        } catch {
          // Silent rollback failure
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: creationError.message || 'Registration could not be completed. Please try again.',
        },
        { status: 500, headers: NO_CACHE_HEADERS }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during registration.' },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
