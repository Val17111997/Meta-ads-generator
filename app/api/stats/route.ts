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

export async function POST(request: Request) {
  try {
    const supabase = getSupabase();
    const body = await request.json();
    const { brand, prompt, format, type, angle, concept, product_group } = body;
    
    if (!brand || !prompt) {
      return NextResponse.json({
        success: false,
        error: 'Marque et prompt requis'
      }, { status: 400 });
    }
    
    const { data, error } = await supabase
      .from('prompts')
      .insert({
        brand,
        prompt,
        format: format || '9:16',
        type: type || 'photo',
        angle: angle || null,
        concept: concept || null,
        product_group: product_group || null,
        status: 'pending',
        image_url: null,
      })
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
