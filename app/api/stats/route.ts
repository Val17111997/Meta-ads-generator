import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { count: total } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true });

    const { count: remaining } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: generated } = await supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'generated');

    return NextResponse.json({
      total: total || 0,
      remaining: remaining || 0,
      generated: generated || 0,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Erreur stats:', errorMessage);
    return NextResponse.json({
      total: 0,
      remaining: 0,
      generated: 0,
    });
  }
}
