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
      
      // Si c'est une erreur 503 et qu'il reste des tentatives, on attend et on réessaie
      if (error.message.includes('503') && attempt < retries) {
        const waitTime = attempt * 2000; // 2s, 4s, 6s
        console.log(`⏳ Attente ${waitTime/1000}s avant retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Sinon on lance l'erreur
      throw new Error(`Erreur d'accès au Google Sheet: ${error.message}`);
    }
  }
  
  throw new Error('Échec après plusieurs tentatives');
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
    
    // Rotation de clés API - ajouter plusieurs clés séparées par des virgules
    const apiKeys = process.env.GOOGLE_API_KEY!.split(',');
    let currentKeyIndex = 0;
    
    // Préparer toutes les images produits en base64
    const productParts = productImagesBase64.map(imgBase64 => {
      const base64Data = imgBase64.split(',')[1] || imgBase64;
      return {
        inlineData: { 
          mimeType: 'image/png',
          data: base64Data
        }
      };
    });

    // Préparer les assets de marque
    // Inclure le logo UNIQUEMENT si shouldIncludeLogo est true
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

    // Construire les instructions de texte
    let textInstructions = '';
    if (shouldIncludeText) {
      textInstructions = '\n\nTEXT OVERLAY:\n- Add compelling French marketing text overlay on the image\n- Include catchy headlines, product benefits, or promotional messages\n- Use modern, readable typography\n- Ensure text is clearly visible and well-positioned';
    } else {
      textInstructions = '\n\nNO TEXT RULE:\n- DO NOT add ANY text, words, letters, numbers, or characters on the image\n- Pure visual composition without any textual elements\n- Focus solely on product photography and visual storytelling';
    }
    
    // Construire les instructions de marque
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
        
        // Utiliser une clé API différente à chaque tentative
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
            const waitTime = attempt * 3000; // 3s, 6s, 9s, 12s, 15s
            console.log(`⏳ Attente ${waitTime/1000}s avant retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw new Error('Serveurs Google surchargés. Réessaye dans quelques minutes.');
        }

        if (response.status === 429) {
          console.log('⚠️ Limite de débit atteinte (429)...');
          currentKeyIndex++; // Passer à la clé suivante
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

    // Vérifier qu'il y a au moins un groupe avec des images
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
    
    // Lire les options depuis le Sheet
    const avecTexte = (row.get('Avec Texte') || 'oui').trim().toLowerCase();
    const avecLogo = (row.get('Avec Logo') || 'non').trim().toLowerCase();
    
    const shouldIncludeText = avecTexte === 'oui';
    const shouldIncludeLogo = avecLogo === 'oui';
    
    console.log(`📝 Options: Texte=${shouldIncludeText}, Logo=${shouldIncludeLogo}`);
    
    // Sélectionner les images du groupe demandé
    let selectedImages: string[] = [];
    
    if (productName && productGroups[productName]) {
      // Groupe spécifique demandé
      selectedImages = productGroups[productName].map((img: any) => img.url);
      console.log(`📂 Groupe sélectionné: "${productName}" (${selectedImages.length} images)`);
    } else if (productName && !productGroups[productName]) {
      // Groupe demandé mais n'existe pas
      return NextResponse.json({ 
        success: false,
        message: `Groupe "${productName}" introuvable. Groupes disponibles: ${Object.keys(productGroups).join(', ')}` 
      });
    } else {
      // Pas de groupe spécifié → prendre toutes les images
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
    
    // Liste des formats valides
    const validFormats = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
    
    // Nettoyer le format (enlever les zéros devant)
    format = format.replace(/^0+(\d)/, '$1');
    
    // Valider le format
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
    console.log('🖼️ Images sélectionnées:', selectedImages.length);
    if (brandAssets.length > 0) {
      console.log('🎨 Assets de marque disponibles:', brandAssets.length);
      console.log(`🏷️ Logo: ${shouldIncludeLogo ? 'OUI' : 'NON'}`);
    }
    console.log(`📝 Texte sur image: ${shouldIncludeText ? 'OUI' : 'NON'}`);
    
    const imageUrl = await generateWithProductImage(
      prompt, 
      selectedImages, 
      brandAssets, 
      shouldIncludeLogo,
      shouldIncludeText, 
      format
    );
    
    row.set('Statut', 'généré');
    row.set('URL Image', 'Téléchargée localement');
    row.set('Date génération', new Date().toLocaleString('fr-FR'));
    await row.save();
    
    console.log('✅ Terminé');
    
    return NextResponse.json({ 
      success: true, 
      imageUrl,
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