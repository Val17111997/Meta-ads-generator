import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { data, error } = await supabase.rpc('get_prompts_stats');

  if (error) {
    console.error('Erreur RPC stats:', error);
    return NextResponse.json({
      total: 0,
      remaining: 0,
      generated: 0,
      error: error.message
    });
  }

  return NextResponse.json({
    total: data?.total || 0,
    remaining: data?.remaining || 0,
    generated: data?.generated || 0,
  });
}
