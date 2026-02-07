import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================================
// GÉNÉRATION VIDÉO avec Veo — predictLongRunning + polling
// ============================================================
async function generateVideoWithVeo(
  prompt: string,
  format: string = '9:16',
  referenceImages: string[] = [],
  retries = 3
): Promise<string | null> {
  const apiKeys = process.env.GOOGLE_API_KEY!.split(',').map(k => k.trim());
  let currentKeyIndex = 0;

  const aspectRatio = (format === '16:9' || format === '9:16') ? format : '9:16';
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const apiKey = apiKeys[currentKeyIndex % apiKeys.length];
      console.log(`🎬 Tentative vidéo ${attempt}/${retries} (clé #${(currentKeyIndex % apiKeys.length) + 1})`);

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

      console.log('📊 Status démarrage:', startResponse.status);

      if (startResponse.status === 429) {
        console.log('⚠️ Rate limit (429), on change de clé...');
        currentKeyIndex++;
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (startResponse.status === 503) {
        console.log('⚠️ Serveur surchargé (503), retry...');
        await new Promise(r => setTimeout(r, attempt * 3000));
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

      console.log('✅ Opération Veo démarrée:', operation.name);

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
            throw new Error(`Veo done mais pas de vidéo dans la réponse`);
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

      console.log('⏰ Timeout polling après 40s. Operation:', operation.name);
      throw new Error(`Timeout polling Veo | operation:${operation.name}`);

    } catch (error: any) {
      if (error.message.includes('Timeout polling') || error.message.includes('done mais pas de vidéo')) {
        throw error;
      }
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw new Error('Échec génération vidéo après toutes les tentatives');
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
  retries = 5
) {
  const apiKeys = process.env.GOOGLE_API_KEY!.split(',').map(k => k.trim());
  let currentKeyIndex = 0;
  
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

  let textInstructions = shouldIncludeText
    ? '\n\nTEXT OVERLAY:\n- Add compelling French marketing text overlay on the image\n- Include catchy headlines, product benefits, or promotional messages\n- Use modern, readable typography\n- Ensure text is clearly visible and well-positioned'
    : '\n\nNO TEXT RULE:\n- DO NOT add ANY text, words, letters, numbers, or characters on the image\n- Pure visual composition without any textual elements';
  
  let brandInstructions = '';
  const hasLogo = brandAssetsData.some(a => a.type === 'logo') && shouldIncludeLogo;
  const hasPalette = brandAssetsData.some(a => a.type === 'palette');
  const hasStyle = brandAssetsData.some(a => a.type === 'style');

  if (hasLogo || hasPalette || hasStyle) {
    brandInstructions = '\n\nBRAND CONSISTENCY GUIDELINES:';
    if (hasLogo) brandInstructions += '\n- Logo provided: Incorporate the brand logo naturally.';
    if (hasPalette) brandInstructions += '\n- Color palette reference provided: Use these EXACT colors.';
    if (hasStyle) brandInstructions += '\n- Visual style references provided: Match the aesthetic feel.';
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const apiKey = apiKeys[currentKeyIndex % apiKeys.length];
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                ...productParts,
                ...brandParts,
                { 
                  text: `Create a professional Meta ad image. ${prompt}. 

CRITICAL PRODUCT RULES:
- The product(s) in the provided image(s) MUST be clearly visible and recognizable
- NEVER deform, distort, or modify the product's shape, proportions, labels, or branding
- Keep the product EXACTLY as shown in the reference images
${textInstructions}
${brandInstructions}

Professional marketing photography. High quality. Eye-catching for social media. 
ALL TEXT IN THE IMAGE MUST BE IN FRENCH.`
                }
              ]
            }],
            generationConfig: {
              imageConfig: { 
                aspectRatio: format,
                imageSize: '2K'
              }
            }
          }),
        }
      );

      if (response.status === 503 || response.status === 429) {
        currentKeyIndex++;
        await new Promise(resolve => setTimeout(resolve, attempt * 3000));
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
      if (attempt === retries) throw error;
    }
  }
  
  throw new Error('Échec après plusieurs tentatives');
}

// ============================================================
// HANDLER POST principal
// ============================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productGroups = {}, brandAssets = [] } = body;
    
    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json({ 
        success: false,
        error: 'GOOGLE_API_KEY non configurée' 
      }, { status: 500 });
    }

    const totalImages = Object.values(productGroups).reduce((sum: number, imgs: any) => sum + imgs.length, 0);
    if (totalImages === 0) {
      return NextResponse.json({ 
        success: false,
        error: 'Aucune image produit. Crée un groupe et upload des images !' 
      }, { status: 400 });
    }
    
    // Récupérer les prompts en attente depuis Supabase
    const { data: pendingPrompts, error: fetchError } = await supabase
      .from('prompts')
      .select('*')
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
    
    // Sélection des images produit
    let selectedImages: string[] = [];
    
    if (productName && productGroups[productName]) {
      selectedImages = productGroups[productName].map((img: any) => img.url);
      console.log(`📂 Groupe sélectionné: "${productName}" (${selectedImages.length} images)`);
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
      return NextResponse.json({ 
        success: false,
        message: 'Aucune image disponible pour ce produit' 
      });
    }
    
    // Validation format
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
    
    // Compter les prompts restants
    const { data: allPending } = await supabase
      .from('prompts')
      .select('id')
      .eq('status', 'pending');
    const remainingCount = (allPending?.length || 1) - 1;
    
    // ============================================================
    // VIDEO
    // ============================================================
    if (contentType === 'video') {
      console.log('🎬 Démarrage génération vidéo Veo...');
      
      try {
        const videoUri = await generateVideoWithVeo(prompt, format, selectedImages);

        // Mise à jour Supabase
        await supabase
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
        const opMatch = videoError.message?.match(/operation:(.+)/);
        if (opMatch) {
          const operationName = opMatch[1];
          
          await supabase
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
            imageUrl: null,
            prompt,
            remaining: remainingCount,
            message: 'Vidéo en cours — polling à reprendre',
          });
        }
        throw videoError;
      }
    }

    // ============================================================
    // IMAGE
    // ============================================================
    const mediaUrl = await generateWithProductImage(
      prompt, 
      selectedImages, 
      brandAssets, 
      false, // shouldIncludeLogo
      true,  // shouldIncludeText
      format
    );
    
    // Mise à jour Supabase
    await supabase
      .from('prompts')
      .update({ 
        status: 'generated',
        image_url: 'Téléchargée localement'
      })
      .eq('id', promptRow.id);
    
    console.log('✅ Image générée');
    
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
