import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Debug: affiche les variables
  if (!url || !key) {
    return NextResponse.json({
      error: 'Missing env vars',
      hasUrl: !!url,
      hasKey: !!key,
    });
  }

  const supabase = createClient(url, key);

  try {
    const { count: total, error } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json({
        error: error.message,
        url: url.substring(0, 30),
      });
    }

    return NextResponse.json({
      total: total || 0,
      remaining: 0,
      generated: 0,
      debug: 'OK from Supabase',
      url: url.substring(0, 30),
    });

  } catch (e: any) {
    return NextResponse.json({
      error: e.message,
    });
  }
}
