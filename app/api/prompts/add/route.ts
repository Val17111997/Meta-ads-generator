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

// POST /api/prompts/add — body: { prompt, format, type, brand, angle, concept, product_group }
export async function POST(request: Request) {
  try {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'CLIENT_ID non configuré' }, { status: 500 });
    }

    const body = await request.json();
    const { prompt, format = '9:16', type = 'photo', brand = '', angle = '', concept = '', product_group = null } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ success: false, error: 'Le prompt est requis' }, { status: 400 });
    }

    const { data, error } = await getSupabase()
      .from('prompts')
      .insert({
        client_id: clientId, // Toujours injecté côté serveur, jamais par le client
        prompt: prompt.trim(),
        format,
        type,
        brand,
        angle: angle || null,
        concept: concept || null,
        product_group: product_group || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur ajout prompt:', error);
      return NextResponse.json({ success: false, error: 'Erreur ajout en base' }, { status: 500 });
    }

    return NextResponse.json({ success: true, prompt: data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
