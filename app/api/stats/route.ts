import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  const supabase = createClient(url, key);

  const result = await supabase.from('prompts').select('id, status');
  
  // Retourne TOUT ce que Supabase renvoie
  return NextResponse.json({
    raw: result,
    dataType: typeof result.data,
    isArray: Array.isArray(result.data),
    dataLength: result.data?.length,
    firstRow: result.data?.[0],
  });
}
