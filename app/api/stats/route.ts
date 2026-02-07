import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' })
      }
    }
  );
}

// GET /api/stats
export async function GET() {
  try {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ total: 0, generated: 0, remaining: 0, error: 'CLIENT_ID non configuré' });
    }

    const { data, error } = await getSupabase()
      .from('prompts')
      .select('status')
      .eq('client_id', clientId);

    if (error) {
      console.error('Erreur stats:', error);
      return NextResponse.json({ total: 0, generated: 0, remaining: 0 });
    }

    const prompts = data || [];
    const total = prompts.length;
    const generated = prompts.filter(p => p.status === 'generated').length;
    const remaining = prompts.filter(p => p.status === 'pending').length;

    return NextResponse.json({ total, generated, remaining });
  } catch (error: any) {
    console.error('Erreur stats:', error);
    return NextResponse.json({ total: 0, generated: 0, remaining: 0 });
  }
}
