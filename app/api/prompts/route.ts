import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    
    // Si pas de marque spécifiée, retourner les stats globales
    let query = supabase.from('prompts').select('*', { count: 'exact', head: true });
    
    if (brand) {
      query = query.eq('brand', brand);
    }
    
    const { count: total } = await query;
    
    // Prompts en attente
    let pendingQuery = supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    if (brand) {
      pendingQuery = pendingQuery.eq('brand', brand);
    }
    
    const { count: remaining } = await pendingQuery;
    
    // Prompts générés
    let generatedQuery = supabase
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'generated');
    
    if (brand) {
      generatedQuery = generatedQuery.eq('brand', brand);
    }
    
    const { count: generated } = await generatedQuery;
    
    // Liste des marques
    const { data: brands } = await supabase
      .from('prompts')
      .select('brand')
      .order('brand');
    
    const uniqueBrands = [...new Set(brands?.map(b => b.brand) || [])];
    
    return NextResponse.json({
      total: total || 0,
      remaining: remaining || 0,
      generated: generated || 0,
      brands: uniqueBrands,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Erreur stats:', errorMessage);
    return NextResponse.json({
      total: 0,
      remaining: 0,
      generated: 0,
      brands: [],
      error: errorMessage
    });
  }
}