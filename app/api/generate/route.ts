import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

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

async function generateVideoWithVeo3(
  prompt: string,
  productImagesBase64: string[],
  brandAssetsData: { url: string; type: 'logo' | 'palette' | 'style' }[] = [],
  shouldIncludeLogo: boolean = false,
  shouldIncludeText: boolean = true,
  format: string = '9:16',
  retries = 5
) {
  try {
    console.log('🎬 Génération vidéo avec Veo 3.1 (multi-image reference)');
    console.log('📸 Prompt:', prompt);
    console.log('📐 Format:', format);
    console.log('🖼️ Nombre d\'images produit disponibles:', productImagesBase64.length);
    
    const apiKeys = process.env.GOOGLE_API_KEY!.split(',');
    let currentKeyIndex = 0;
    
    // TEMPORAIRE : Limiter à 1 image pour éviter erreur 400
    const maxReferenceImages = 1; // Au lieu de 3
    const productReferences = productImagesBase64.slice(0, maxReferenceImages);
    console.log(`🖼️ Utilisation de ${productReferences.length} image(s) produit comme référence(s)`);
    
    // Compresser les images pour Veo (max 1024x1024, qualité 60%)
    const compressImageForVeo = (base64: string): string => {
      try {
        // Si l'image est trop grande, la retourner telle quelle (sera gérée par le canvas côté client)
        // Pour l'instant, on envoie directement
        return base64;
      } catch (e) {
        return base64;
      }
    };
    
    const imageParts = productReferences.map(imgBase64 => {
      const base64Data = imgBase64.split(',')[1] || imgBase64;
      // Limiter la taille de chaque image à ~500KB en base64 (≈375KB en bytes)
      const maxBase64Length = 500000;
      const trimmedData = base64Data.length > maxBase64Length 
        ? base64Data.substring(0, maxBase64Length) 
        : base64Data;
      
      return {
        inlineData: {
          mimeType: 'image/jpeg', // JPEG au lieu de PNG pour Veo
          data: trimmedData
        }
      };
    });
    
    const remainingSlots = maxReferenceImages - productReferences.length;
    const brandParts = brandAssetsData
      .filter(asset => shouldIncludeLogo ? true : asset.type !== 'logo')
      .slice(0, remainingSlots)
      .map(asset => {
        const base64Data = asset.url.split(',')[1] || asset.url;
        return {
          inlineData: {
            mimeType: 'image/png',
            data: base64Data
          }
        };
      });
    
    if (brandParts.length > 0) {
      console.log(`🎨 Ajout de ${brandParts.length} asset(s) de marque comme référence(s)`);
    }
    
    let videoInstructions = `Create a professional Meta ad video featuring the product(s) shown in the reference images. ${prompt}.

VIDEO GENERATION RULES:
- Use the ${productReferences.length} product image(s) provided as visual references
- Smooth, cinematic camera movements (zoom, pan, dolly, rotate)
- Keep all products clearly visible and recognizable throughout the video
- Professional lighting and composition
- Eye-catching motion perfect for social media advertising
- 8 seconds duration
- High quality, polished result`;

    if (shouldIncludeText) {
      videoInstructions += '\n- Add compelling French marketing text overlay that remains readable throughout';
    } else {
      videoInstructions += '\n- NO text or words on the video - pure visual storytelling only';
    }
    
    if (shouldIncludeLogo && brandParts.length > 0) {
      videoInstructions += '\n- Incorporate the brand logo naturally and subtly in the composition';
    }
    
    // TEST : Version simplifiée sans images pour debug
    console.log('🧪 TEST: Génération Veo sans images de référence');
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 Tentative ${attempt}/${retries}...`);
        
        const apiKey = apiKeys[currentKeyIndex % apiKeys.length];
        console.log(`🔑 Utilisation clé API #${(currentKeyIndex % apiKeys.length) + 1}`);
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    text: `A beautiful product video. ${prompt}. Smooth camera movement. 8 seconds. High quality.`
                  }
                ]
              }],
              generationConfig: {
                videoConfig: {
                  aspectRatio: format,
                  duration: '8s'
                }
              }
            }),
          }
        );

        console.log('📡 Status réponse:', response.status);
        console.log('📡 Headers:', JSON.stringify(Object.fromEntries(response.headers)));
        
        const responseText = await response.text();
        console.log('📡 Réponse brute (300 premiers chars):', responseText.substring(0, 300));

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
          const errorText = responseText;
          console.error('❌ Erreur API Veo:', errorText.substring(0, 500));
          throw new Error(`Erreur API Veo: ${response.status}`);
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.error('❌ Impossible de parser la réponse JSON');
          throw new Error('Réponse invalide de Veo');
        }
        console.log('📦 Réponse Veo reçue');
        console.log('🔍 Structure réponse:', JSON.stringify(data).substring(0, 500));
        
        if (!data.candidates || data.candidates.length === 0) {
          console.error('❌ Aucun candidat dans la réponse');
          console.error('Réponse complète:', JSON.stringify(data));
          throw new Error('Aucune vidéo générée');
        }
        
        const candidate = data.candidates[0];
        console.log('🔍 Candidate structure:', Object.keys(candidate));
        
        const parts = candidate.content?.parts || [];
        console.log('🔍 Nombre de parts:', parts.length);
        console.log('🔍 Types de parts:', parts.map((p: any) => Object.keys(p)));
        
        const videoPart = parts.find((part: any) => part.inlineData);
        
        if (!videoPart?.inlineData?.data) {
          console.error('❌ Pas de inlineData trouvé');
          console.error('Parts disponibles:', JSON.stringify(parts).substring(0, 500));
          throw new Error('Pas de données vidéo dans la réponse');
        }
        
        const videoUrl = `data:video/mp4;base64,${videoPart.inlineData.data}`;
        console.log('✅ Vidéo générée avec succès avec multi-image reference');
        
        return videoUrl;
        
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
    console.log('🖼️ Images sélectionnées:', selectedImages.length);
    if (brandAssets.length > 0) {
      console.log('🎨 Assets de marque disponibles:', brandAssets.length);
      console.log(`🏷️ Logo: ${shouldIncludeLogo ? 'OUI' : 'NON'}`);
    }
    console.log(`📝 Texte sur ${contentType}: ${shouldIncludeText ? 'OUI' : 'NON'}`);
    
    let mediaUrl: string | null = null;
    let mediaType: string;
    
    if (contentType === 'video') {
      // Pour les vidéos, on marque "en cours vidéo" et le cron job s'en occupera
      row.set('Statut', 'en cours vidéo');
      row.set('Date génération', new Date().toLocaleString('fr-FR'));
      await row.save();
      
      console.log('🎬 Vidéo mise en file d\'attente pour le cron job');
      
      return NextResponse.json({ 
        success: true, 
        imageUrl: null,
        mediaType: 'video',
        prompt,
        remaining: pendingRows.length - 1,
        message: 'Vidéo en cours de génération (traitement dans 1-2 minutes)'
      });
    } else {
      mediaUrl = await generateWithProductImage(
        prompt, 
        selectedImages, 
        brandAssets, 
        shouldIncludeLogo,
        shouldIncludeText, 
        format
      );
      mediaType = 'image';
    }
    
    row.set('Statut', 'généré');
    row.set('URL Image', 'Téléchargée localement');
    row.set('Date génération', new Date().toLocaleString('fr-FR'));
    await row.save();
    
    console.log('✅ Terminé');
    
    return NextResponse.json({ 
      success: true, 
      imageUrl: mediaUrl,
      mediaType: mediaType,
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
