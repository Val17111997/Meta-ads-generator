import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(url, key);

  // Test simple : récupère toutes les lignes
  const { data, error } = await supabase
    .from('prompts')
    .select('id');

  return NextResponse.json({
    total: data?.length || 0,
    remaining: 0,
    generated: 0,
    debug: {
      dataLength: data?.length,
      error: error?.message,
      firstItem: data?.[0],
    }
  });
}
