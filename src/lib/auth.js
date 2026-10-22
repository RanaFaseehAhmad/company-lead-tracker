import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Company from '@/models/Company';

export const AUTH_COOKIE_NAME = 'auth_token';
const TOKEN_EXPIRATION = '24h';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

/**
 * Validates and retrieves the JWT secret key.
 * Throws a configuration error if missing or insecure.
 */
function getJwtSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error(
      'Server configuration error: JWT_SECRET environment variable is missing or less than 32 characters.'
    );
  }
  return new TextEncoder().encode(secret.trim());
}

/**
 * Hashes a plaintext password securely.
 */
export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  return bcrypt.hash(password, 10);
}

/**
 * Compares a plaintext password against a hash.
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Creates and signs a secure JWT.
 */
export async function signToken(payload) {
  const secretKey = getJwtSecretKey();
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    companyId: payload.companyId || null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRATION)
    .sign(secretKey);
}

/**
 * Verifies and decodes a JWT.
 */
export async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const secretKey = getJwtSecretKey();
    const { payload } = await jwtVerify(token, secretKey);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Standard HTTP-only cookie configuration.
 */
export function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    name: AUTH_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

/**
 * Extracts the JWT token from request cookies or Authorization header.
 */
export function extractTokenFromRequest(request) {
  // 1. Check HTTP-only cookie first
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const c of cookies) {
    if (c.startsWith(`${AUTH_COOKIE_NAME}=`)) {
      return decodeURIComponent(c.substring(AUTH_COOKIE_NAME.length + 1));
    }
  }

  // 2. Fallback to Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Authenticates the current request, loads the user and company,
 * and validates their status.
 *
 * @param {Request} request
 * @returns {Promise<{
 *   user: object|null,
 *   company: object|null,
 *   error: string|null,
 *   statusCode: number
 * }>}
 */
export async function getAuthSession(request) {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return {
      user: null,
      company: null,
      error: 'Authentication required. Please sign in.',
      statusCode: 401,
    };
  }

  const payload = await verifyToken(token);
  if (!payload || !payload.userId) {
    return {
      user: null,
      company: null,
      error: 'Session expired or invalid. Please sign in again.',
      statusCode: 401,
    };
  }

  await connectToDatabase();

  const user = await User.findById(payload.userId).lean();
  if (!user) {
    return {
      user: null,
      company: null,
      error: 'User account not found.',
      statusCode: 401,
    };
  }

  if (user.status !== 'active') {
    return {
      user: null,
      company: null,
      error: 'Your account is deactivated. Please contact support.',
      statusCode: 403,
    };
  }

  let company = null;

  if (user.role === 'company_admin') {
    if (!user.companyId) {
      return {
        user: null,
        company: null,
        error: 'No company associated with this account.',
        statusCode: 403,
      };
    }

    company = await Company.findById(user.companyId).lean();
    if (!company) {
      return {
        user: null,
        company: null,
        error: 'Associated company record not found.',
        statusCode: 403,
      };
    }

    if (company.status === 'pending') {
      return {
        user: null,
        company,
        error: 'Your company account is currently pending approval by the Super Admin.',
        statusCode: 403,
        companyStatus: 'pending',
      };
    }

    if (company.status === 'blocked') {
      return {
        user: null,
        company,
        error: 'Your company account has been suspended. Please contact support.',
        statusCode: 403,
        companyStatus: 'blocked',
      };
    }
  }

  // Return safe sanitized objects
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId ? user.companyId.toString() : null,
      status: user.status,
    },
    company: company
      ? {
          id: company._id.toString(),
          name: company.name,
          status: company.status,
          contactName: company.contactName,
          contactEmail: company.contactEmail,
          contactPhone: company.contactPhone,
        }
      : null,
    error: null,
    statusCode: 200,
  };
}
