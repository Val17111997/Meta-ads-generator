import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { global: { fetch: (url: any, options: any = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
  );
}

function getClientId() {
  return process.env.CLIENT_ID || 'default';
}

// Ensure table exists (run once)
async function ensureTable() {
  const supabase = getSupabase();
  // Try a simple query — if table doesn't exist, create it
  const { error } = await supabase.from('favorites').select('id').limit(1);
  if (error?.message?.includes('does not exist') || error?.code === '42P01') {
    // Create table via SQL
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `CREATE TABLE IF NOT EXISTS favorites (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        client_id TEXT NOT NULL,
        url TEXT NOT NULL,
        prompt TEXT,
        media_type TEXT DEFAULT 'image',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`
    });
    if (createError) {
      console.warn('⚠️ Could not auto-create favorites table. Please create it manually in Supabase.');
      console.warn('SQL: CREATE TABLE favorites (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, client_id TEXT NOT NULL, url TEXT NOT NULL, prompt TEXT, media_type TEXT DEFAULT \'image\', created_at TIMESTAMPTZ DEFAULT NOW());');
    }
  }
}

// ── GET: List all favorites for this client ──
export async function GET() {
  try {
    const clientId = getClientId();
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('favorites')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet
      if (error.message?.includes('does not exist')) {
        return NextResponse.json({ success: true, favorites: [] });
      }
      return NextResponse.json({ success: false, error: error.message });
    }

    const favorites = (data || []).map(row => ({
      id: row.id,
      url: row.url,
      prompt: row.prompt || '',
      mediaType: row.media_type || 'image',
      timestamp: new Date(row.created_at).getTime(),
    }));

    return NextResponse.json({ success: true, favorites });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── POST: Add a favorite ──
export async function POST(req: Request) {
  try {
    const { url, prompt, mediaType = 'image' } = await req.json();

    if (!url) {
      return NextResponse.json({ success: false, error: 'url requis' }, { status: 400 });
    }

    const clientId = getClientId();
    const supabase = getSupabase();

    // Check for duplicates (same prompt for same client)
    const { data: existing } = await supabase
      .from('favorites')
      .select('id')
      .eq('client_id', clientId)
      .eq('prompt', prompt || '')
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, id: existing[0].id, duplicate: true });
    }

    const { data, error } = await supabase
      .from('favorites')
      .insert({
        client_id: clientId,
        url,
        prompt: prompt || '',
        media_type: mediaType,
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message });
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── DELETE: Remove a favorite ──
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'id requis' }, { status: 400 });
    }

    const clientId = getClientId();
    const supabase = getSupabase();

    // id can be 'all' to clear everything
    if (id === 'all') {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('client_id', clientId);

      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
