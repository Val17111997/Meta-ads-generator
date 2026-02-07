import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  // Debug: vérifier les variables
  if (!url || !key) {
    return NextResponse.json({
      error: 'Missing env vars',
      hasUrl: !!url,
      hasKey: !!key,
      urlStart: url?.substring(0, 20),
    });
  }
  
  const supabase = createClient(url, key);

  // Test avec debug
  const { data, error } = await supabase.from('prompts').select('id, status');
  
  return NextResponse.json({
    total: data?.length || 0,
    remaining: data?.filter(p => p.status === 'pending').length || 0,
    generated: data?.filter(p => p.status === 'generated').length || 0,
    debug: {
      error: error?.message,
      dataExists: !!data,
      urlStart: url.substring(0, 30),
    }
  });
}
