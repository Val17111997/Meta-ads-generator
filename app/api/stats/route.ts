import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(url, key);

  // Total
  const { data: allData } = await supabase.from('prompts').select('id, status');
  
  const total = allData?.length || 0;
  const remaining = allData?.filter(p => p.status === 'pending').length || 0;
  const generated = allData?.filter(p => p.status === 'generated').length || 0;

  return NextResponse.json({
    total,
    remaining,
    generated,
  });
}
