/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const globalSecurityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];

    if (isProd) {
      // HTTP Strict Transport Security enabled in production HTTPS environments
      globalSecurityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      });
    }

    return [
      // 1. Global security headers across all routes
      {
        source: '/(.*)',
        headers: globalSecurityHeaders,
      },
      // 2. Sensitive dashboard routes - strictly deny framing & protect against clickjacking
      {
        source: '/dashboard/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
        ],
      },
      // 3. Sensitive authentication routes - deny framing
      {
        source: '/login',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
        ],
      },
      {
        source: '/register',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
        ],
      },
      {
        source: '/super-admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
        ],
      },
      // 4. API routes - deny framing
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      // 5. Public embed route - MUST allow customer websites to embed published forms
      // Explicitly sets Content-Security-Policy: frame-ancestors *; and does NOT set X-Frame-Options
      {
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
        ],
      },
    ];
  },
};

export default nextConfig;
