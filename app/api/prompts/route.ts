import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET - Récupérer les prompts (avec filtres optionnels)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = searchParams.get('brand');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    let query = supabase
      .from('prompts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (brand) {
      query = query.eq('brand', brand);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(error.message);
    }
    
    // Stats calculées à partir des données
    const total = data?.length || 0;
    const pending = data?.filter(p => p.status === 'pending').length || 0;
    const generated = data?.filter(p => p.status === 'generated').length || 0;
    
    return NextResponse.json({
      success: true,
      prompts: data,
      stats: {
        total,
        pending,
        generated,
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

// PATCH - Mettre à jour un prompt (status, image_url, etc.)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, image_url } = body;
    
    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'ID du prompt requis'
      }, { status: 400 });
    }
    
    const updates: Record<string, string> = {};
    if (status) updates.status = status;
    if (image_url) updates.image_url = image_url;
    
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const brand = searchParams.get('brand');
    const deleteAll = searchParams.get('deleteAll') === 'true';
    
    if (deleteAll && brand) {
      // Supprimer tous les prompts d'une marque
      const { error } = await supabase
        .from('prompts')
        .delete()
        .eq('brand', brand);
      
      if (error) throw new Error(error.message);
      
      return NextResponse.json({
        success: true,
        message: 'Tous les prompts de ' + brand + ' supprimés'
      });
    }
    
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
