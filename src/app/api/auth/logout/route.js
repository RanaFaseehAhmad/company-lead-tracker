import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getCookieOptions } from '@/lib/auth';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function POST() {
  const cookieOpts = getCookieOptions();
  const response = NextResponse.json(
    {
      success: true,
      message: 'Signed out successfully.',
    },
    {
      headers: NO_CACHE_HEADERS,
    }
  );

  // Clear authentication cookie
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: cookieOpts.httpOnly,
    secure: cookieOpts.secure,
    sameSite: cookieOpts.sameSite,
    path: cookieOpts.path,
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}

export async function GET(request) {
  const cookieOpts = getCookieOptions();
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirectTo');

  // Safe redirect target - only allow relative paths to /login or /login
  let destination = '/login';
  if (redirectTo === '/login' || redirectTo === '/super-admin') {
    destination = '/login';
  }

  const loginUrl = new URL(destination, request.url);
  const response = NextResponse.redirect(loginUrl);

  // Clear authentication cookie
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: cookieOpts.httpOnly,
    secure: cookieOpts.secure,
    sameSite: cookieOpts.sameSite,
    path: cookieOpts.path,
    maxAge: 0,
    expires: new Date(0),
  });

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  return response;
}
