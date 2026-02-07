import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    total: 999,
    remaining: 888,
    generated: 777,
  });
}
