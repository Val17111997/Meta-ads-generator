import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(url, key);

  const { data } = await supabase.from('prompts').select('id, status');
  
  return NextResponse.json({
    total: data?.length || 0,
    remaining: data?.filter(p => p.status === 'pending').length || 0,
    generated: data?.filter(p => p.status === 'generated').length || 0,
  });
}
