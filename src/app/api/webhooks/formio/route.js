import { NextResponse } from 'next/server';

/**
 * POST /api/webhooks/formio
 * Retired Form.io webhook endpoint.
 * Legacy Form.io integration has been replaced by the native custom form engine.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: 'Form.io webhook integration has been retired in favor of native form engine.',
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      message: 'Form.io webhook integration has been retired.',
    },
    { status: 410 }
  );
}
