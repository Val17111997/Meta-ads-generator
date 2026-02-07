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

function getClientId() {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) throw new Error('CLIENT_ID non configuré');
  return clientId;
}

// GET /api/prompts?limit=500&status=pending
export async function GET(request: Request) {
  try {
    const clientId = getClientId();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const status = searchParams.get('status');

    let query = getSupabase()
      .from('prompts')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erreur lecture prompts:', error);
      return NextResponse.json({ success: false, error: 'Erreur base de données' }, { status: 500 });
    }

    return NextResponse.json({ success: true, prompts: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PATCH /api/prompts — body: { id, ...fields }
export async function PATCH(request: Request) {
  try {
    const clientId = getClientId();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID requis' }, { status: 400 });
    }

    const { error } = await getSupabase()
      .from('prompts')
      .update(updates)
      .eq('id', id)
      .eq('client_id', clientId); // Sécurité : empêche de modifier les prompts d'un autre client

    if (error) {
      console.error('Erreur update prompt:', error);
      return NextResponse.json({ success: false, error: 'Erreur mise à jour' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE /api/prompts?id=xxx
export async function DELETE(request: Request) {
  try {
    const clientId = getClientId();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID requis' }, { status: 400 });
    }

    const { error } = await getSupabase()
      .from('prompts')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId); // Sécurité : empêche de supprimer les prompts d'un autre client

    if (error) {
      console.error('Erreur delete prompt:', error);
      return NextResponse.json({ success: false, error: 'Erreur suppression' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
