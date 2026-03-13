import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
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

// ── Upload base64 image/video to Supabase Storage, return public URL ──
async function uploadToStorage(
  base64DataUrl: string,
  clientId: string,
  mediaType: string = 'image'
): Promise<string> {
  const supabase = getSupabase();
  const isVideo = mediaType === 'video' || base64DataUrl.startsWith('data:video');
  const ext = isVideo ? 'mp4' : 'png';
  const mimeType = isVideo ? 'video/mp4' : 'image/png';
  const fileName = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Extract raw base64 data
  const base64Raw = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
  const buffer = Buffer.from(base64Raw, 'base64');

  const { error } = await supabase.storage
    .from('gallery')
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error('⚠️ Storage upload error:', error.message);
    // Fallback: return base64 if upload fails
    return base64DataUrl;
  }

  const { data: publicData } = supabase.storage.from('gallery').getPublicUrl(fileName);
  console.log(`📦 Uploaded to storage: ${fileName}`);
  return publicData.publicUrl;
}

// ============================================================
// GÉNÉRATION VIDÉO avec Veo — predictLongRunning + polling
// ============================================================
async function generateVideoWithVeo(
  prompt: string,
  format: string = '9:16',
  referenceImages: string[] = [],
): Promise<string | null> {
  const apiKeys = process.env.GOOGLE_API_KEY!.split(',').map(k => k.trim()).filter(Boolean);
  const maxAttempts = apiKeys.length; // Tester CHAQUE clé une fois
  const startIndex = Math.floor(Math.random() * apiKeys.length); // Round-robin distribué

  const aspectRatio = (format === '16:9' || format === '9:16') ? format : '9:16';
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyIndex = (startIndex + attempt) % apiKeys.length;
    const apiKey = apiKeys[keyIndex];

    try {
      console.log(`🎬 Tentative vidéo ${attempt + 1}/${maxAttempts} (clé #${keyIndex + 1}/${apiKeys.length})`);

      const startUrl = `${BASE_URL}/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`;
      
      const requestBody: any = {
        instances: [{ prompt: prompt }],
        parameters: {
          aspectRatio: aspectRatio,
          durationSeconds: 8
        }
      };

      if (referenceImages.length === 1) {
        const img = referenceImages[0];
        const mimeMatch = img.match(/^data:(image\/[a-z]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
        const base64Data = img.split(',')[1] || img;
        
        requestBody.instances[0].image = {
          bytesBase64Encoded: base64Data,
          mimeType: mimeType
        };
        console.log(`🖼️ 1 image → mode FIRST FRAME (image-to-video)`);
        
      } else if (referenceImages.length > 1) {
        const refImages = referenceImages.slice(0, 3).map(img => {
          const mimeMatch = img.match(/^data:(image\/[a-z]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          const base64Data = img.split(',')[1] || img;
          
          return {
            image: {
              bytesBase64Encoded: base64Data,
              mimeType: mimeType
            },
            referenceType: 'asset'
          };
        });
        
        requestBody.instances[0].referenceImages = refImages;
        console.log(`🖼️ ${refImages.length} images → mode REFERENCE IMAGES`);
      }

      const startResponse = await fetch(startUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody)
      });

      console.log(`📊 Status démarrage: ${startResponse.status} (clé #${keyIndex + 1})`);

      if (startResponse.status === 429) {
        console.log(`⚠️ Rate limit (429) sur clé #${keyIndex + 1}, passage à la suivante...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      if (startResponse.status === 503) {
        console.log('⚠️ Serveur surchargé (503), retry...');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (!startResponse.ok) {
        const errorText = await startResponse.text();
        console.error('❌ Erreur démarrage Veo:', errorText.substring(0, 500));
        throw new Error(`Veo HTTP ${startResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const startText = await startResponse.text();
      let operation: any;
      try {
        operation = JSON.parse(startText.trim());
      } catch {
        throw new Error(`Veo texte non-JSON: ${startText.substring(0, 150)}`);
      }

      if (!operation.name) {
        throw new Error('Pas de operation name retourné par Veo');
      }

      console.log('✅ Opération Veo démarrée:', operation.name, `(clé #${keyIndex + 1})`);

      // Polling inline (4 × 10s = 40s max)
      const maxPolls = 4;
      for (let poll = 1; poll <= maxPolls; poll++) {
        await new Promise(r => setTimeout(r, 10000));
        console.log(`⏳ Polling ${poll}/${maxPolls}...`);

        const checkUrl = `${BASE_URL}/${operation.name}?key=${apiKey}`;
        const checkResponse = await fetch(checkUrl, {
          method: 'GET',
          headers: { 'x-goog-api-key': apiKey },
          cache: 'no-store',
        });

        if (checkResponse.status === 429) continue;
        if (!checkResponse.ok) continue;

        const checkText = await checkResponse.text();
        let updatedOp: any;
        try {
          updatedOp = JSON.parse(checkText.trim());
        } catch {
          continue;
        }

        if (updatedOp.done) {
          if (updatedOp.error) {
            throw new Error(`Veo erreur: ${updatedOp.error?.message || 'inconnue'}`);
          }

          const videoUri =
            updatedOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
            updatedOp.response?.generatedVideos?.[0]?.video?.uri ||
            updatedOp.response?.videos?.[0]?.uri;

          if (!videoUri) {
            const raiReasons = updatedOp.response?.generateVideoResponse?.raiMediaFilteredReasons;
            if (raiReasons && raiReasons.length > 0) {
              console.error('🚫 Veo: prompt bloqué par filtre sécurité:', raiReasons[0]);
              throw new Error(`Prompt bloqué par le filtre de sécurité. Modifie le prompt et réessaie.`);
            }
            console.warn('⚠️ Veo done mais structure réponse inattendue:', JSON.stringify(updatedOp.response || updatedOp).substring(0, 500));
            continue;
          }

          console.log('✅ Vidéo générée ! URI:', videoUri.substring(0, 80) + '...');

          try {
            const videoRes = await fetch(videoUri, {
              headers: { 'x-goog-api-key': apiKey },
              redirect: 'follow'
            });
            if (videoRes.ok) {
              const videoBuffer = await videoRes.arrayBuffer();
              const base64 = Buffer.from(videoBuffer).toString('base64');
              const mimeType = videoRes.headers.get('content-type') || 'video/mp4';
              return `data:${mimeType};base64,${base64}`;
            }
            return videoUri;
          } catch {
            return videoUri;
          }
        }
      }

      console.log('⏰ Timeout polling après 40s. Operation:', operation.name, `keyIndex: ${keyIndex}`);
      throw new Error(`Timeout polling Veo | operation:${operation.name} | keyIndex:${keyIndex}`);

    } catch (error: any) {
      if (error.message.includes('Timeout polling') || error.message.includes('bloqué par le filtre')) {
        throw error;
      }
      if (attempt === maxAttempts - 1) throw error;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw new Error('Échec génération vidéo après toutes les clés');
}

// ============================================================
// GÉNÉRATION IMAGE avec Gemini
// ============================================================
async function generateWithProductImage(
  prompt: string, 
  productImagesBase64: string[], 
  brandAssetsData: { url: string; type: 'logo' | 'palette' | 'style' }[] = [],
  shouldIncludeLogo: boolean = false,
  shouldIncludeText: boolean = true,
  format: string = '1:1',
  brandColors: string = '',
) {
  const apiKeys = process.env.GOOGLE_API_KEY!.split(',').map(k => k.trim()).filter(Boolean);
  const maxAttempts = Math.max(apiKeys.length, 5); // Au moins 5 tentatives (503 sont temporaires)
  const startIndex = Math.floor(Math.random() * apiKeys.length);
  
  const productParts = productImagesBase64.map(imgBase64 => {
    const base64Data = imgBase64.split(',')[1] || imgBase64;
    return {
      inlineData: { 
        mimeType: 'image/png',
        data: base64Data
      }
    };
  });

  const brandParts = brandAssetsData
    .filter(asset => asset.type !== 'palette') // palette is now text-based, not an image
    .filter(asset => shouldIncludeLogo ? true : asset.type !== 'logo')
    .map(asset => {
      const base64Data = asset.url.split(',')[1] || asset.url;
      return {
        inlineData: { 
          mimeType: 'image/png',
          data: base64Data
        }
      };
    });

      const hasLogo = brandAssetsData.some(a => a.type === 'logo') && shouldIncludeLogo;
      const hasStyle = brandAssetsData.some(a => a.type === 'style');
      const hasRefImages = productImagesBase64.length > 0;

      let textBlock = '';
      if (shouldIncludeText) {
        textBlock = '\nInclude text overlays as described in the prompt. ALL text MUST be in FRENCH. Use modern, readable typography.';
      } else {
        textBlock = '\nDo NOT add any text, words, headlines, labels or typography on the image. Ignore any text/headline/CTA instructions in the prompt. Pure visual only.';
      }

      let brandBlock = '';
      if (hasLogo) brandBlock += ' Incorporate the brand logo naturally.';
      if (brandColors) brandBlock += ` Use these brand colors: ${brandColors}.`;
      if (hasStyle) brandBlock += ' Match the visual style references.';

      const refBlock = hasRefImages
        ? '\nKeep the product/subject faithful to the reference images.'
        : '';

      const finalPrompt = `${prompt}.${textBlock}${brandBlock ? '\n' + brandBlock.trim() : ''}${refBlock}`;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyIndex = (startIndex + attempt) % apiKeys.length;
    const apiKey = apiKeys[keyIndex];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                ...productParts,
                ...brandParts,
                { 
                  text: finalPrompt
                }
              ]
            }],
            generationConfig: {
              imageConfig: { 
                aspectRatio: format,
                imageSize: '4K'
              }
            }
          }),
        }
      );

      if (response.status === 503 || response.status === 429 || response.status === 500) {
        console.log(`⚠️ Image: ${response.status} sur clé #${keyIndex + 1}, passage à la suivante...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Erreur API: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.candidates?.[0]?.content?.parts) {
        throw new Error('Aucune image générée');
      }
      
      const imagePart = data.candidates[0].content.parts.find((part: any) => part.inlineData);
      
      if (!imagePart?.inlineData?.data) {
        throw new Error('Pas de données image dans la réponse');
      }
      
      return `data:image/png;base64,${imagePart.inlineData.data}`;
      
    } catch (error: any) {
      if (attempt === maxAttempts - 1) throw error;
    }
  }
  
  throw new Error('Échec après toutes les clés');
}

// ============================================================
// JWT Token Generation for Kling API (HS256)
// ============================================================
async function generateKlingJWT(): Promise<string> {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) throw new Error('KLING_ACCESS_KEY ou KLING_SECRET_KEY non configuré');

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5, iat: now };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const crypto = await import('crypto');
  const signature = crypto.createHmac('sha256', secretKey).update(`${headerB64}.${payloadB64}`).digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

// ============================================================
// GÉNÉRATION VIDÉO avec Kling 2.6 — image-to-video
// ============================================================
async function generateVideoWithKling(
  prompt: string,
  format: string = '9:16',
  referenceImages: string[] = [],
  retries = 2
): Promise<{ videoUri?: string; taskId?: string; pending?: boolean }> {
  const aspectRatio = (format === '16:9' || format === '9:16' || format === '1:1') ? format : '9:16';
  
  const imageUrl = referenceImages.length > 0 ? referenceImages[0] : null;
  if (!imageUrl) throw new Error('Kling image-to-video nécessite au moins une image');

  let klingImage: string;
  if (imageUrl.startsWith('data:')) {
    const base64Part = imageUrl.split(',')[1];
    if (!base64Part || base64Part.length < 100) {
      throw new Error('Image base64 invalide ou trop petite');
    }
    klingImage = base64Part;
  } else {
    klingImage = imageUrl;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const token = await generateKlingJWT();
      console.log(`🎬 [Kling 2.6] Tentative ${attempt}/${retries}`);

      const requestBody: any = {
        model_name: 'kling-v2-6',
        prompt: prompt,
        image: klingImage,
        cfg_scale: 0.5,
        mode: 'pro',
        duration: '5',
        aspect_ratio: aspectRatio,
      };

      const response = await fetch('https://api.klingai.com/v1/videos/image2video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.status === 429) {
        console.log('⚠️ [Kling] Rate limit, retry...');
        await new Promise(r => setTimeout(r, attempt * 5000));
        continue;
      }

      const responseText = await response.text();
      let result: any;
      try { result = JSON.parse(responseText); } catch { throw new Error('Kling réponse non-JSON'); }

      if (!response.ok || (result.code && result.code !== 0)) {
        throw new Error(result.message || `Kling erreur (${response.status})`);
      }

      const taskId = result.data?.task_id;
      if (!taskId) throw new Error('Kling: pas de task_id retourné');

      console.log('✅ [Kling] Tâche créée:', taskId);

      for (let poll = 1; poll <= 3; poll++) {
        await new Promise(r => setTimeout(r, 10000));
        console.log(`⏳ [Kling] Polling ${poll}/3...`);

        const pollToken = await generateKlingJWT();
        const pollRes = await fetch(`https://api.klingai.com/v1/videos/image2video/${taskId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${pollToken}` },
          cache: 'no-store',
        });

        if (!pollRes.ok) continue;
        const pollText = await pollRes.text();
        let pollResult: any;
        try { pollResult = JSON.parse(pollText); } catch { continue; }

        const status = pollResult.data?.task_status;
        console.log(`📊 [Kling] Status: ${status}`);

        if (status === 'succeed') {
          const videoUrl = pollResult.data?.task_result?.videos?.[0]?.url;
          if (videoUrl) {
            try {
              const videoRes = await fetch(videoUrl);
              if (videoRes.ok) {
                const buf = await videoRes.arrayBuffer();
                const b64 = Buffer.from(buf).toString('base64');
                const mime = videoRes.headers.get('content-type') || 'video/mp4';
                return { videoUri: `data:${mime};base64,${b64}` };
              }
            } catch {}
            return { videoUri: videoUrl };
          }
        }

        if (status === 'failed') {
          throw new Error(pollResult.data?.task_status_msg || 'Kling: génération échouée');
        }
      }

      console.log('⏰ [Kling] Timeout inline, taskId:', taskId);
      return { taskId, pending: true };

    } catch (error: any) {
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  throw new Error('Kling: échec après toutes les tentatives');
}

// ============================================================
// HANDLER POST principal
// ============================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productGroups = {}, brandAssets = [], brandColors = '', includeText = true, includeLogo = false, videoEngine = 'veo' } = body;
    
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ 
        success: false,
        error: 'CLIENT_ID non configuré sur ce déploiement' 
      }, { status: 500 });
    }

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json({ 
        success: false,
        error: 'GOOGLE_API_KEY non configurée' 
      }, { status: 500 });
    }

    // Log des clés disponibles au démarrage
    const keyCount = process.env.GOOGLE_API_KEY.split(',').filter(k => k.trim()).length;
    console.log(`🔑 ${keyCount} clé(s) Google API configurée(s)`);

    const totalImages = Object.values(productGroups).reduce((sum: number, imgs: any) => sum + imgs.length, 0);
    if (totalImages === 0) {
      console.log('📂 Aucune image produit — génération sans référence visuelle');
    }
    
    const { data: pendingPrompts, error: fetchError } = await getSupabase()
      .from('prompts')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    
    if (fetchError) {
      console.error('Erreur Supabase:', fetchError);
      return NextResponse.json({ 
        success: false,
        error: 'Erreur lecture base de données' 
      }, { status: 500 });
    }
    
    if (!pendingPrompts || pendingPrompts.length === 0) {
      return NextResponse.json({ 
        success: false,
        message: 'Aucun prompt en attente !' 
      });
    }
    
    const promptRow = pendingPrompts[0];
    const prompt = promptRow.prompt;
    let format = (promptRow.format || '1:1').trim();
    const productName = (promptRow.product_group || '').trim();
    const contentType = (promptRow.type || 'photo').trim().toLowerCase();
    
    console.log(`📝 Prompt: ${prompt.substring(0, 50)}...`);
    console.log(`📐 Format: ${format}, Type: ${contentType}`);
    console.log(`✍️ Texte: ${includeText ? 'OUI' : 'NON'}, 🏷️ Logo: ${includeLogo ? 'OUI' : 'NON'}`);
    
    let selectedImages: string[] = [];
    
    if (productName && productGroups[productName]) {
      // Shuffle to vary across product variants (different fragrances, colors, etc.)
      const shuffled = [...productGroups[productName]].sort(() => Math.random() - 0.5);
      selectedImages = shuffled.slice(0, 4).map((img: any) => img.url);
      console.log(`📂 Groupe sélectionné: "${productName}" (${selectedImages.length}/${productGroups[productName].length} images, aléatoire)`);
    } else if (productName && !productGroups[productName]) {
      return NextResponse.json({ 
        success: false,
        message: `Groupe "${productName}" introuvable. Groupes disponibles: ${Object.keys(productGroups).join(', ')}` 
      });
    } else {
      selectedImages = Object.values(productGroups)
        .flat()
        .map((img: any) => img.url);
      console.log(`📂 Aucun groupe spécifié, utilisation de toutes les images (${selectedImages.length})`);
    }
    
    if (selectedImages.length === 0) {
      console.log('📂 Aucune image sélectionnée — génération sans référence visuelle');
    }
    
    const validFormats = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    format = format.replace(/^0+(\d)/, '$1');
    if (!validFormats.includes(format)) {
      format = '1:1';
    }
    
    if (!prompt?.trim()) {
      return NextResponse.json({ 
        success: false,
        message: 'Prompt vide' 
      });
    }
    
    const { data: allPending } = await getSupabase()
      .from('prompts')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'pending');
    const remainingCount = (allPending?.length || 1) - 1;
    
    // ============================================================
    // VIDEO
    // ============================================================
    if (contentType === 'video') {
      const engine = videoEngine || 'veo';
      console.log(`🎬 Démarrage génération vidéo avec ${engine.toUpperCase()}...`);
      
      // ---- KLING ----
      if (engine === 'kling') {
        try {
          const klingResult = await generateVideoWithKling(prompt, format, selectedImages);

          if (klingResult.videoUri) {
            await getSupabase()
              .from('prompts')
              .update({ status: 'generated', image_url: 'Vidéo Kling générée' })
              .eq('id', promptRow.id);

            return NextResponse.json({
              success: true,
              mediaType: 'video',
              imageUrl: klingResult.videoUri,
              prompt,
              remaining: remainingCount,
            });
          }

          if (klingResult.pending && klingResult.taskId) {
            await getSupabase()
              .from('prompts')
              .update({ status: 'generating', image_url: `kling:${klingResult.taskId}` })
              .eq('id', promptRow.id);

            return NextResponse.json({
              success: true,
              mediaType: 'video',
              videoOperation: `kling:${klingResult.taskId}`,
              imageUrl: null,
              prompt,
              remaining: remainingCount,
              message: 'Vidéo Kling en cours — polling à reprendre',
            });
          }
        } catch (klingError: any) {
          console.error('❌ [Kling] Erreur:', klingError.message);
          
          await getSupabase()
            .from('prompts')
            .update({ status: 'error', image_url: `Kling: ${klingError.message.substring(0, 100)}` })
            .eq('id', promptRow.id);

          return NextResponse.json({
            success: false,
            error: `❌ Kling: ${klingError.message}`,
            remaining: remainingCount,
          });
        }
      }
      
      // ---- VEO (seulement si sélectionné) ----
      if (engine === 'veo') {
      try {
        const videoUri = await generateVideoWithVeo(prompt, format, selectedImages);

        await getSupabase()
          .from('prompts')
          .update({ 
            status: 'generated',
            image_url: 'Vidéo générée - voir app'
          })
          .eq('id', promptRow.id);

        return NextResponse.json({
          success: true,
          mediaType: 'video',
          imageUrl: videoUri,
          prompt,
          remaining: remainingCount,
        });
      } catch (videoError: any) {
        if (videoError.message?.includes('bloqué par le filtre')) {
          await getSupabase()
            .from('prompts')
            .update({ status: 'error', image_url: 'Bloqué par filtre sécurité' })
            .eq('id', promptRow.id);

          return NextResponse.json({
            success: false,
            error: '🚫 Ce prompt a été bloqué par le filtre de sécurité. Il a été marqué en erreur, relance pour passer au suivant.',
            remaining: remainingCount,
          });
        }

        const opMatch = videoError.message?.match(/operation:(.+?)(?:\s*\|.*)?$/);
        if (opMatch) {
          const fullMatch = opMatch[1].trim();
          const keyIndexMatch = videoError.message?.match(/keyIndex:(\d+)/);
          const keyIndex = keyIndexMatch ? parseInt(keyIndexMatch[1]) : 0;
          const operationName = fullMatch.replace(/\s*\|.*$/, '').trim();
          
          await getSupabase()
            .from('prompts')
            .update({ 
              status: 'generating',
              image_url: operationName
            })
            .eq('id', promptRow.id);

          return NextResponse.json({
            success: true,
            mediaType: 'video',
            videoOperation: operationName,
            videoKeyIndex: keyIndex,
            imageUrl: null,
            prompt,
            remaining: remainingCount,
            message: 'Vidéo en cours — polling à reprendre',
          });
        }
        throw videoError;
      }
      } // fin if (engine === 'veo')
    }

    // ============================================================
    // IMAGE
    // ============================================================
    const mediaBase64 = await generateWithProductImage(
      prompt, 
      selectedImages, 
      brandAssets, 
      includeLogo,
      includeText,
      format,
      brandColors
    );

    // Upload to Supabase Storage instead of returning base64
    const mediaUrl = await uploadToStorage(mediaBase64, clientId, 'image');
    
    await getSupabase()
      .from('prompts')
      .update({ 
        status: 'generated',
        image_url: mediaUrl
      })
      .eq('id', promptRow.id);
    
    console.log('✅ Image générée et uploadée');
    
    return NextResponse.json({ 
      success: true, 
      imageUrl: mediaUrl,
      mediaType: 'image',
      prompt,
      remaining: remainingCount,
    });
    
  } catch (error: any) {
    console.error('❌ Erreur:', error);
    return NextResponse.json({ 
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
