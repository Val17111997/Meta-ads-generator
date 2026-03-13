import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;
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
    const { sourceImage, prompt, targetFormat, safeZoneNote = '' } = await request.json();

    if (!sourceImage) {
      return NextResponse.json({ success: false, error: 'Image source manquante' }, { status: 400 });
    }

    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'CLIENT_ID non configuré' }, { status: 500 });
    }

    const apiKeys = process.env.GOOGLE_API_KEY!.split(',').map(k => k.trim()).filter(Boolean);
    const startIndex = Math.floor(Math.random() * apiKeys.length);
    const maxAttempts = Math.max(apiKeys.length, 3);

    const base64Data = sourceImage.includes(',') ? sourceImage.split(',')[1] : sourceImage;

    const adaptPrompt = `Recreate this EXACT same image but adapted to a ${targetFormat} aspect ratio.

CRITICAL RULES:
- Keep the EXACT same concept, composition, colors, style, mood, and elements
- Keep the EXACT same product appearance — do not change, deform, or modify it
- Keep the EXACT same text/headlines if any are present — reproduce them identically
- Adapt the framing and layout naturally for the new aspect ratio
- When extending the image to fill the new format, the added areas MUST be completely seamless — same exact color, texture, lighting, and grain as the original background. There must be ZERO visible border, line, or color shift between the original and extended areas.
- Do NOT crop or cut any important element${safeZoneNote}

Original prompt for reference: ${prompt || 'N/A'}

no watermark`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const keyIndex = (startIndex + attempt) % apiKeys.length;
      const apiKey = apiKeys[keyIndex];

      try {
        console.log(`📐 Resize ${attempt + 1}/${maxAttempts} → ${targetFormat} (clé #${keyIndex + 1})`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: base64Data
                    }
                  },
                  { text: adaptPrompt }
                ]
              }],
              generationConfig: {
                imageConfig: {
                  aspectRatio: targetFormat,
                  imageSize: '4K'
                }
              }
            }),
          }
        );

        if (response.status === 503 || response.status === 429 || response.status === 500) {
          console.log(`⚠️ Resize: ${response.status} sur clé #${keyIndex + 1}, retry...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (!response.ok) {
          throw new Error(`Erreur API: ${response.status}`);
        }

        const data = await response.json();
        const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

        if (!imagePart?.inlineData?.data) {
          throw new Error('Pas de données image dans la réponse');
        }

        const resultBase64 = `data:image/png;base64,${imagePart.inlineData.data}`;

        // Upload to Supabase Storage
        const supabase = getSupabase();
        const fileName = `${clientId}/${Date.now()}-resize-${Math.random().toString(36).slice(2, 8)}.png`;
        const buffer = Buffer.from(imagePart.inlineData.data, 'base64');

        const { error: uploadError } = await supabase.storage
          .from('gallery')
          .upload(fileName, buffer, {
            contentType: 'image/png',
            upsert: false,
          });

        let finalUrl = resultBase64;
        if (!uploadError) {
          const { data: publicData } = supabase.storage.from('gallery').getPublicUrl(fileName);
          finalUrl = publicData.publicUrl;
          console.log(`📦 Resize uploaded: ${fileName}`);
        }

        console.log(`✅ Resize ${targetFormat} OK`);

        return NextResponse.json({
          success: true,
          imageUrl: finalUrl,
          format: targetFormat,
        });

      } catch (error: any) {
        if (attempt === maxAttempts - 1) throw error;
      }
    }

    throw new Error('Échec après toutes les clés');

  } catch (error: any) {
    console.error('❌ Resize error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
