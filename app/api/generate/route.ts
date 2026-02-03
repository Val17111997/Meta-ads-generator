import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function getSheetData(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);
      
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();
      
      return { sheet, rows };
    } catch (error: any) {
      console.error(`Erreur Google Sheets (tentative ${attempt}/${retries}):`, error.message);
      
      if (error.message.includes('503') && attempt < retries) {
        const waitTime = attempt * 2000;
        console.log(`⏳ Attente ${waitTime/1000}s avant retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      throw new Error(`Erreur d'accès au Google Sheet: ${error.message}`);
    }
  }
  
  throw new Error('Échec après plusieurs tentatives');
}

// ============================================================
// GÉNÉRATION VIDÉO avec Veo - predictLongRunning + polling
// ============================================================
async function generateVideoWithVeo(
  prompt: string,
  format: string = '9:16',
  retries = 3
): Promise<string | null> {
  const apiKeys = process.env.GOOGLE_API_KEY!.split(',');
  let currentKeyIndex = 0;

  const aspectRatio = (format === '16:9' || format === '9:16') ? format : '9:16';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const apiKey = apiKeys[currentKeyIndex % apiKeys.length];
      console.log(`🎬 Tentative vidéo ${attempt}/${retries} (clé #${(currentKeyIndex % apiKeys.length) + 1})`);

      // --- Étape 1 : Lancer l'opération predictLongRunning ---
      const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning`;

      const requestBody = {
        instances: [{
          prompt: prompt
        }],
        parameters: {
          aspectRatio: aspectRatio,
          durationSeconds: 8,
          resolution: "720p"
        }
      };

      console.log('📦 Request body:', JSON.stringify(requestBody));

      const startResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
        console.error('❌ Erreur démarrage Veo:', errorText);
        throw new Error(`Veo HTTP ${startResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const startText = await startResponse.text();
      console.log('📡 Réponse brute (200 premiers chars):', startText.substring(0, 200));

      let operation: any;
      try {
        operation = JSON.parse(startText);
      } catch {
        console.error('❌ Réponse non-JSON de Veo:', startText.substring(0, 500));
        throw new Error(`Veo texte non-JSON: ${startText.substring(0, 150)}`);
      }

      console.log('⏳ Opération lancée:', operation.name);

      if (!operation.name) {
        console.error('❌ Pas de operation.name:', JSON.stringify(operation));
        throw new Error('Pas de operation name retourné par Veo');
      }

      console.log('✅ Opération Veo démarrée, début polling...');

      // --- Étape 2 : Polling jusqu'à done=true
      // On reste dans les 55s pour avoir de la marge sur les 60s Vercel
      // Veo peut prendre 30-90s — on fait du mieux dans la contrainte
      const maxPolls = 5; // 5 × 10s = 50s
      for (let poll = 1; poll <= maxPolls; poll++) {
        await new Promise(r => setTimeout(r, 10000));
        console.log(`⏳ Polling ${poll}/${maxPolls}...`);

        const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}`;
        const checkResponse = await fetch(checkUrl, { headers: { 'x-goog-api-key': apiKey } });

        if (!checkResponse.ok) {
          console.error('❌ Erreur polling:', await checkResponse.text());
          continue;
        }

        const checkText = await checkResponse.text();
        console.log('📡 Polling réponse brute:', checkText.substring(0, 500));

        let updatedOp: any;
        try {
          updatedOp = JSON.parse(checkText);
        } catch {
          console.error('❌ Polling réponse non-JSON:', checkText.substring(0, 300));
          continue;
        }

        console.log('📊 done:', updatedOp.done, '| keys:', Object.keys(updatedOp));

        if (updatedOp.done) {
          // Essayer les deux structures possibles :
          // 1) Gemini API: response.generateVideoResponse.generatedSamples[0].video.uri
          // 2) Vertex AI:  response.videos[0].uri  (ou gcsUri)
          const videoUri =
            updatedOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
            updatedOp.response?.videos?.[0]?.uri ||
            updatedOp.response?.videos?.[0]?.gcsUri;

          if (videoUri) {
            console.log('✅ Vidéo générée ! URI récupérée.');
            return videoUri;
          }
          // done=true mais pas de vidéo — log tout pour debug
          console.error('❌ done=true mais URI introuvable. Réponse complète:', JSON.stringify(updatedOp));
          throw new Error(`Veo done mais pas de vidéo dans la réponse`);
        }
      }

      // Timeout polling — on retourne l'operation.name pour que le frontend puisse reprendre le polling
      console.log('⏰ Timeout polling après 50s. Operation:', operation.name);
      throw new Error(`Timeout polling Veo | operation:${operation.name}`);

    } catch (error: any) {
      console.error(`❌ Tentative ${attempt} échouée:`, error.message);
      // Ne pas retry si c'est un timeout polling — l'opération existe déjà, on ne relance pas
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
// GÉNÉRATION IMAGE avec Gemini (inchangé)
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
  try {
    console.log('🎨 Génération avec Nano Banana Pro');
    console.log('📸 Prompt:', prompt);
    console.log('📐 Format:', format);
    console.log('🖼️ Nombre d\'images produit:', productImagesBase64.length);
    console.log('🎨 Nombre d\'assets de marque:', brandAssetsData.length);
    console.log('🏷️ Inclusion logo:', shouldIncludeLogo);
    console.log('📝 Inclusion texte:', shouldIncludeText);
    
    const apiKeys = process.env.GOOGLE_API_KEY!.split(',');
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

    let textInstructions = '';
    if (shouldIncludeText) {
      textInstructions = '\n\nTEXT OVERLAY:\n- Add compelling French marketing text overlay on the image\n- Include catchy headlines, product benefits, or promotional messages\n- Use modern, readable typography\n- Ensure text is clearly visible and well-positioned';
    } else {
      textInstructions = '\n\nNO TEXT RULE:\n- DO NOT add ANY text, words, letters, numbers, or characters on the image\n- Pure visual composition without any textual elements\n- Focus solely on product photography and visual storytelling';
    }
    
    let brandInstructions = '';
    const hasLogo = brandAssetsData.some(a => a.type === 'logo') && shouldIncludeLogo;
    const hasPalette = brandAssetsData.some(a => a.type === 'palette');
    const hasStyle = brandAssetsData.some(a => a.type === 'style');

    if (hasLogo || hasPalette || hasStyle) {
      brandInstructions = '\n\nBRAND CONSISTENCY GUIDELINES:';
      if (hasLogo) brandInstructions += '\n- Logo provided: Incorporate the brand logo naturally and prominently in the composition as requested in the prompt.';
      if (hasPalette) brandInstructions += '\n- Color palette reference provided: Use these EXACT colors consistently for backgrounds, text overlays, decorative elements, and overall color scheme.';
      if (hasStyle) brandInstructions += '\n- Visual style references provided: Match the aesthetic feel, photography style, composition approach, lighting, and overall brand atmosphere.';
      brandInstructions += '\n- Prioritize color accuracy and visual style consistency.';
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 Tentative ${attempt}/${retries}...`);
        
        const apiKey = apiKeys[currentKeyIndex % apiKeys.length];
        console.log(`🔑 Utilisation clé API #${(currentKeyIndex % apiKeys.length) + 1}`);
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  ...productParts,
                  ...brandParts,
                  { 
                    text: `Create a professional Meta ad image. ${prompt}. 

CRITICAL PRODUCT RULES:
- The product(s) in the provided image(s) MUST be clearly visible and recognizable in the scene
- NEVER deform, distort, or modify the product's shape, proportions, labels, or branding
- Keep the product EXACTLY as shown in the reference images unless the prompt explicitly requests "illustration style", "drawing", "schematic", "cartoon", or similar artistic interpretation
- The product packaging, bottles, labels and logo must remain accurate and readable
- Only the background, lighting, and scene composition should be creative - the product itself stays authentic
${textInstructions}
${brandInstructions}

Professional marketing photography. High quality. Eye-catching for social media. 
ALL TEXT IN THE IMAGE MUST BE IN FRENCH. Use French language for all labels, titles, and descriptions in the image.`
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

        if (response.status === 503) {
          console.log('⚠️ Serveur surchargé (503)...');
          if (attempt < retries) {
            const waitTime = attempt * 3000;
            console.log(`⏳ Attente ${waitTime/1000}s avant retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw new Error('Serveurs Google surchargés. Réessaye dans quelques minutes.');
        }

        if (response.status === 429) {
          console.log('⚠️ Limite de débit atteinte (429)...');
          currentKeyIndex++;
          if (attempt < retries) {
            const waitTime = apiKeys.length > 1 ? 2000 : 10000 + (attempt * 5000);
            console.log(`⏳ Attente ${waitTime/1000}s avant retry avec ${apiKeys.length > 1 ? 'clé suivante' : 'même clé'}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw new Error('Limite de requêtes atteinte. Attends quelques minutes avant de réessayer.');
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Erreur API:', errorText);
          throw new Error(`Erreur API: ${response.status}`);
        }

        const data = await response.json();
        console.log('📦 Réponse reçue');
        
        if (!data.candidates || data.candidates.length === 0) {
          throw new Error('Aucune image générée');
        }
        
        const candidate = data.candidates[0];
        const parts = candidate.content?.parts || [];
        const imagePart = parts.find((part: any) => part.inlineData);
        
        if (!imagePart?.inlineData?.data) {
          throw new Error('Pas de données image dans la réponse');
        }
        
        const imageUrl = `data:image/png;base64,${imagePart.inlineData.data}`;
        console.log('✅ Image générée avec succès');
        
        return imageUrl;
        
      } catch (error: any) {
        if (attempt === retries) {
          throw error;
        }
        console.log(`❌ Tentative ${attempt} échouée, retry...`);
      }
    }
    
    throw new Error('Échec après plusieurs tentatives');
    
  } catch (error: any) {
    console.error('❌ Erreur:', error.message);
    throw error;
  }
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
    
    const { rows } = await getSheetData();
    
    const pendingRows = rows.filter(row => {
      const status = row.get('Statut') || '';
      return status.toLowerCase() !== 'généré';
    });
    
    console.log(`⏳ Prompts en attente: ${pendingRows.length}`);
    
    if (pendingRows.length === 0) {
      return NextResponse.json({ 
        success: false,
        message: 'Aucun prompt en attente !' 
      });
    }
    
    const row = pendingRows[0];
    const prompt = row.get('Prompt');
    let format = (row.get('Format') || '1:1').trim();
    const productName = (row.get('Produit') || '').trim();
    const contentType = (row.get('Type') || 'photo').trim().toLowerCase();
    
    const avecTexte = (row.get('Avec Texte') || 'oui').trim().toLowerCase();
    const avecLogo = (row.get('Avec Logo') || 'non').trim().toLowerCase();
    
    const shouldIncludeText = avecTexte === 'oui';
    const shouldIncludeLogo = avecLogo === 'oui';
    
    console.log(`📝 Options: Type=${contentType}, Texte=${shouldIncludeText}, Logo=${shouldIncludeLogo}`);
    
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
    
    const validFormats = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    format = format.replace(/^0+(\d)/, '$1');
    
    if (!validFormats.includes(format)) {
      console.log(`⚠️ Format invalide "${format}", utilisation de 1:1 par défaut`);
      format = '1:1';
    }
    
    if (!prompt?.trim()) {
      return NextResponse.json({ 
        success: false,
        message: 'Prompt vide' 
      });
    }
    
    console.log('🚀 Génération:', prompt);
    console.log('📐 Format demandé:', format);
    console.log('🎬 Type de contenu:', contentType);
    
    // ============================================================
    // VIDEO : génération + polling inline (comme les images)
    // ============================================================
    if (contentType === 'video') {
      console.log('🎬 Démarrage génération vidéo Veo...');
      
      try {
        const videoUri = await generateVideoWithVeo(prompt, format);

        // Mise à jour Sheet
        row.set('Statut', 'généré');
        row.set('URL Image', videoUri);
        row.set('Date génération', new Date().toLocaleString('fr-FR'));
        await row.save();

        console.log('✅ Vidéo générée et Sheet mis à jour');

        return NextResponse.json({
          success: true,
          mediaType: 'video',
          imageUrl: videoUri,
          prompt,
          remaining: pendingRows.length - 1,
        });
      } catch (videoError: any) {
        // Si timeout polling, retourner l'operation pour que le frontend reprend le polling
        const opMatch = videoError.message?.match(/operation:(.+)/);
        if (opMatch) {
          const operationName = opMatch[1];
          console.log('⏳ Timeout inline, on retourne l\'opération pour polling frontend:', operationName);
          
          row.set('Statut', 'en cours vidéo');
          row.set('URL Image', operationName); // stocke l'operation name pour reprendre
          row.set('Date génération', new Date().toLocaleString('fr-FR'));
          await row.save();

          return NextResponse.json({
            success: true,
            mediaType: 'video',
            videoOperation: operationName,
            imageUrl: null,
            prompt,
            remaining: pendingRows.length - 1,
            message: 'Vidéo en cours — polling à reprendre',
          });
        }
        // Autre erreur — on re-throw
        throw videoError;
      }
    }

    // IMAGE : appel direct à Gemini (comme avant)
    let mediaUrl: string | null = null;
    mediaUrl = await generateWithProductImage(
      prompt, 
      selectedImages, 
      brandAssets, 
      shouldIncludeLogo,
      shouldIncludeText, 
      format
    );
    
    // Mise à jour du Sheet
    row.set('Statut', 'généré');
    row.set('URL Image', 'Téléchargée localement');
    row.set('Date génération', new Date().toLocaleString('fr-FR'));
    await row.save();
    
    console.log('✅ Terminé');
    
    return NextResponse.json({ 
      success: true, 
      imageUrl: mediaUrl,
      mediaType: 'image',
      prompt,
      remaining: pendingRows.length - 1,
    });
    
  } catch (error: any) {
    console.error('❌ Erreur:', error);
    return NextResponse.json({ 
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
