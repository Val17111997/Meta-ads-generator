import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function getClientId() {
  const id = process.env.CLIENT_ID;
  if (!id) throw new Error('CLIENT_ID non configuré');
  return id;
}

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

// ── GET: Load gallery ──
export async function GET() {
  try {
    const clientId = getClientId();
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('gallery')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.message?.includes('does not exist')) {
        return NextResponse.json({ success: true, images: [] });
      }
      return NextResponse.json({ success: false, error: error.message });
    }

    const images = (data || []).map(row => ({
      url: row.url,
      prompt: row.prompt || '',
      mediaType: row.media_type || 'image',
      timestamp: new Date(row.created_at).getTime(),
      fileName: row.file_name || null,
    }));

    return NextResponse.json({ success: true, images });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── POST: Save gallery item (now receives URL, not base64) ──
export async function POST(req: Request) {
  try {
    const clientId = getClientId();
    const supabase = getSupabase();
    const body = await req.json();
    
    // Support both old format (dataUrl) and new format (url)
    const imageUrl = body.url || body.dataUrl;
    const { prompt, mediaType = 'image' } = body;

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: 'URL manquante' }, { status: 400 });
    }

    // If it's a base64 dataUrl (legacy/edited images), upload to storage first
    let finalUrl = imageUrl;
    let fileName = null;

    if (imageUrl.startsWith('data:')) {
      const isVideo = mediaType === 'video' || imageUrl.startsWith('data:video');
      const ext = isVideo ? 'mp4' : 'png';
      const mimeType = isVideo ? 'video/mp4' : 'image/png';
      fileName = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const base64Raw = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Raw, 'base64');

      const { error: uploadError } = await supabase.storage
        .from('gallery')
        .upload(fileName, buffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        console.error('⚠️ Gallery upload error:', uploadError.message);
        return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
      }

      const { data: publicData } = supabase.storage.from('gallery').getPublicUrl(fileName);
      finalUrl = publicData.publicUrl;
    } else {
      // Extract fileName from URL if it's a Supabase storage URL
      const match = imageUrl.match(/\/gallery\/(.+)$/);
      if (match) fileName = match[1];
    }

    // Save metadata to gallery table
    const { error: insertError } = await supabase
      .from('gallery')
      .insert({
        client_id: clientId,
        url: finalUrl,
        prompt: prompt || '',
        media_type: mediaType,
        file_name: fileName,
      });

    if (insertError) {
      console.error('⚠️ Gallery insert error:', insertError.message);
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: finalUrl });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── DELETE: Remove gallery item ──
export async function DELETE(req: Request) {
  try {
    const clientId = getClientId();
    const supabase = getSupabase();
    const { fileName } = await req.json();

    if (fileName) {
      await supabase.storage.from('gallery').remove([fileName]);
      await supabase
        .from('gallery')
        .delete()
        .eq('client_id', clientId)
        .eq('file_name', fileName);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
