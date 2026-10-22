import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectToDatabase from '@/lib/mongodb';

/**
 * GET /api/health
 * Checks server and database connectivity status without exposing sensitive credentials.
 */
export async function GET() {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.trim() === '') {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'disconnected',
        message: 'MONGODB_URI is not configured in environment variables.',
      },
      { status: 503 }
    );
  }

  try {
    await connectToDatabase();
    if (mongoose.connection.readyState === 2) {
      await mongoose.connection.asPromise();
    }
    const isConnected = mongoose.connection.readyState === 1;

    if (isConnected) {
      return NextResponse.json({
        status: 'healthy',
        database: 'connected',
      });
    }

    return NextResponse.json(
      {
        status: 'degraded',
        database: 'connecting',
      },
      { status: 503 }
    );
  } catch (error) {
    // Safe sanitization: remove any URI, credentials, or secrets
    const sanitize = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str
        .replace(/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, 'mongodb+srv://[REDACTED]')
        .replace(/:([^@\s/:?]+)@/g, ':[REDACTED]@');
    };

    const diagnostics = {
      name: error?.name || 'UnknownError',
      code: error?.code || error?.cause?.code || null,
      message: sanitize(error?.message),
      causeName: error?.cause?.name || null,
      causeCode: error?.cause?.code || null,
      hostname: error?.hostname || null,
      syscall: error?.syscall || null,
    };

    console.error('[MongoDB Diagnostic]', JSON.stringify(diagnostics));

    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'unavailable',
        error: 'Failed to establish connection to MongoDB.',
        diagnostics,
      },
      { status: 503 }
    );
  }
}
