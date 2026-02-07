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

// GET - Récupérer les prompts via RPC
export async function GET() {
  try {
    const supabase = getSupabase();
    
    const { data: prompts, error } = await supabase.rpc('get_all_prompts');
    
    if (error) {
      throw new Error(error.message);
    }
    
    // Calculer les stats à partir des données
    const total = prompts?.length || 0;
    const pending = prompts?.filter((p: any) => p.status === 'pending').length || 0;
    const generated = prompts?.filter((p: any) => p.status === 'generated').length || 0;
    
    return NextResponse.json({
      success: true,
      prompts: prompts || [],
      stats: { total, pending, generated }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}

// PATCH - Mettre à jour un prompt
export async function PATCH(request: Request) {
  try {
    const supabase = getSupabase();
    const body = await request.json();
    const { id, ...updates } = body;
    
    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'ID du prompt requis'
      }, { status: 400 });
    }
    
    const { data, error } = await supabase
      .from('prompts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      throw new Error(error.message);
    }
    
    return NextResponse.json({
      success: true,
      prompt: data
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}

// DELETE - Supprimer un prompt
export async function DELETE(request: Request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'ID du prompt requis'
      }, { status: 400 });
    }
    
    const { error } = await supabase
      .from('prompts')
      .delete()
      .eq('id', id);
    
    if (error) {
      throw new Error(error.message);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Prompt supprimé'
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}
