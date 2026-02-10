import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'gallery';

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

// Ensure bucket exists
async function ensureBucket() {
  const supabase = getSupabase();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BUCKET, { public: true });
    console.log('✅ Bucket "gallery" créé');
  }
}

// ── GET: List all gallery images for this client ──
export async function GET() {
  try {
    const clientId = getClientId();
    const supabase = getSupabase();
    await ensureBucket();

    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list(clientId, { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) {
      console.error('❌ Gallery list error:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    const baseUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

    const images = (files || [])
      .filter(f => !f.name.startsWith('.'))
      .map(f => {
        // filename format: {timestamp}_{mediaType}.{ext} or {timestamp}_{mediaType}__{promptSlug}.{ext}
        const nameParts = f.name.replace(/\.[^.]+$/, ''); // remove extension
        const parts = nameParts.split('_');
        const timestamp = parseInt(parts[0]) || Date.now();
        const mediaType = parts[1] || 'image';
        // Extract prompt from metadata if stored, otherwise from filename
        const promptSlug = parts.slice(2).join('_').replace(/__/g, ' ') || '';

        return {
          url: `${baseUrl}/${clientId}/${f.name}`,
          prompt: promptSlug,
          timestamp,
          mediaType,
          fileName: f.name,
        };
      });

    return NextResponse.json({ success: true, images });
  } catch (error: any) {
    console.error('❌ Gallery GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── POST: Upload a generated image/video to gallery ──
export async function POST(req: Request) {
  try {
    const { dataUrl, prompt, mediaType = 'image' } = await req.json();

    if (!dataUrl) {
      return NextResponse.json({ success: false, error: 'dataUrl requis' }, { status: 400 });
    }

    const clientId = getClientId();
    const supabase = getSupabase();
    await ensureBucket();

    const timestamp = Date.now();
    // Clean prompt for filename (keep first 60 chars, alphanumeric + spaces)
    const promptSlug = (prompt || '')
      .substring(0, 60)
      .replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s-]/g, '')
      .trim()
      .replace(/\s+/g, '__');

    // Detect format from data URL
    let ext = 'png';
    let contentType = 'image/png';
    let buffer: Buffer;

    if (dataUrl.startsWith('data:')) {
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
      if (mimeMatch) {
        contentType = mimeMatch[1];
        if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        else if (contentType.includes('video')) { ext = 'mp4'; contentType = 'video/mp4'; }
        else if (contentType.includes('webp')) ext = 'webp';
      }
      const base64 = dataUrl.split(',')[1];
      buffer = Buffer.from(base64, 'base64');
    } else if (dataUrl.startsWith('http')) {
      // URL — fetch and upload
      const resp = await fetch(dataUrl);
      const arrayBuf = await resp.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
      contentType = resp.headers.get('content-type') || 'image/png';
      if (contentType.includes('jpeg')) ext = 'jpg';
      else if (contentType.includes('video')) { ext = 'mp4'; contentType = 'video/mp4'; }
      else if (contentType.includes('webp')) ext = 'webp';
    } else {
      return NextResponse.json({ success: false, error: 'Format dataUrl non supporté' }, { status: 400 });
    }

    const fileName = `${timestamp}_${mediaType}${promptSlug ? `_${promptSlug}` : ''}.${ext}`;
    const filePath = `${clientId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      return NextResponse.json({ success: false, error: uploadError.message });
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`;

    console.log(`✅ Média sauvegardé: ${filePath} (${(buffer.length / 1024).toFixed(0)}KB)`);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName,
      mediaType,
    });
  } catch (error: any) {
    console.error('❌ Gallery POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ── DELETE: Remove an image from gallery ──
export async function DELETE(req: Request) {
  try {
    const { fileName } = await req.json();
    if (!fileName) {
      return NextResponse.json({ success: false, error: 'fileName requis' }, { status: 400 });
    }

    const clientId = getClientId();
    const supabase = getSupabase();
    const filePath = `${clientId}/${fileName}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([filePath]);

    if (error) {
      console.error('❌ Delete error:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    console.log(`🗑️ Média supprimé: ${filePath}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('❌ Gallery DELETE error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}