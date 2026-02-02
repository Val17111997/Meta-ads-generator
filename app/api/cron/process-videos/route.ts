import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const maxDuration = 60; // Maximum 60 secondes
export const dynamic = 'force-dynamic';

interface VeoOperation {
  name: string;
  done: boolean;
}

interface VeoResult {
  generated_videos?: Array<{
    video: {
      uri: string;
    };
  }>;
}

async function generateVeoVideo(apiKey: string, prompt: string, format: string): Promise<string | null> {
  try {
    console.log('📡 Lancement génération Veo...');
    console.log('🔑 API Key présente:', apiKey ? `${apiKey.substring(0, 20)}...` : 'MANQUANTE');
    console.log('📝 Prompt:', prompt.substring(0, 100));
    console.log('📐 Format demandé:', format);
    
    const aspectRatio = format === '16:9' || format === '9:16' ? format : '9:16';
    console.log('📐 Format final (aspect ratio):', aspectRatio);
    
    const requestBody = {
      prompt: prompt,
      config: {
        aspectRatio: aspectRatio,
        numberOfVideos: 1,
        durationSeconds: 8,
        personGeneration: 'ALLOW_ADULT',
        resolution: '720p'
      }
    };
    
    console.log('📦 Request body:', JSON.stringify(requestBody, null, 2));
    
    // Étape 1 : Lancer la génération (Operation)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateVideos?key=${apiKey}`;
    console.log('🌐 URL appelée:', url.replace(apiKey, '[API_KEY_MASQUEE]'));
    
    const startResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    console.log('📊 Response status:', startResponse.status, startResponse.statusText);
    console.log('📊 Response headers:', JSON.stringify(Object.fromEntries(startResponse.headers.entries())));
    
    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error('❌ Erreur démarrage Veo (HTTP ' + startResponse.status + '):', errorText);
      
      // Essayer de parser en JSON pour plus de détails
      try {
        const errorJson = JSON.parse(errorText);
        console.error('📋 Détails erreur (JSON parsé):', JSON.stringify(errorJson, null, 2));
        
        if (errorJson.error) {
          console.error('🔴 Code erreur:', errorJson.error.code);
          console.error('🔴 Message:', errorJson.error.message);
          console.error('🔴 Status:', errorJson.error.status);
        }
      } catch (parseError) {
        console.error('📋 Erreur brute (non-JSON):', errorText);
      }
      
      return null;
    }
    
    const operation: VeoOperation = await startResponse.json();
    console.log('⏳ Opération lancée avec succès !');
    console.log('📋 Operation name:', operation.name);
    console.log('📋 Operation complete:', JSON.stringify(operation, null, 2));
    
    // Étape 2 : Attendre que la vidéo soit prête (polling)
    let attempts = 0;
    const maxAttempts = 6; // 6 tentatives * 10s = 60s max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10s
      attempts++;
      
      console.log(`⏳ Vérification ${attempts}/${maxAttempts}...`);
      
      const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${apiKey}`;
      console.log('🔍 Check URL:', checkUrl.replace(apiKey, '[API_KEY_MASQUEE]'));
      
      const checkResponse = await fetch(checkUrl, { 
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('📊 Check response status:', checkResponse.status);
      
      if (!checkResponse.ok) {
        const checkError = await checkResponse.text();
        console.error('❌ Erreur vérification status (HTTP ' + checkResponse.status + '):', checkError);
        continue;
      }
      
      const updatedOperation: VeoOperation & { result?: VeoResult } = await checkResponse.json();
      console.log('📊 Status opération:', JSON.stringify(updatedOperation, null, 2));
      console.log('🔄 Done:', updatedOperation.done);
      
      if (updatedOperation.done) {
        console.log('✅ Vidéo générée (done=true) !');
        
        const result = updatedOperation.result;
        console.log('📦 Result object:', JSON.stringify(result, null, 2));
        
        if (result?.generated_videos && result.generated_videos.length > 0) {
          const videoUri = result.generated_videos[0].video.uri;
          console.log('📹 URI vidéo récupérée:', videoUri);
          return videoUri;
        }
        
        console.error('❌ Pas de vidéo dans le résultat (result.generated_videos vide ou absent)');
        console.error('📋 Result complet:', JSON.stringify(result, null, 2));
        return null;
      }
      
      console.log('⏳ Vidéo pas encore prête, on continue...');
    }
    
    console.log('⏰ Timeout: vidéo pas encore prête après 60s (maxAttempts atteint)');
    return null;
    
  } catch (error: any) {
    console.error('❌ Exception dans generateVeoVideo:', error.message);
    console.error('📚 Stack trace:', error.stack);
    console.error('📋 Error object complet:', JSON.stringify(error, null, 2));
    return null;
  }
}

export async function GET(request: Request) {
  try {
    console.log('🎬 ========================================');
    console.log('🎬 Démarrage du worker vidéo Cron...');
    console.log('🎬 Timestamp:', new Date().toISOString());
    console.log('🎬 ========================================');
    
    // Vérifier le cron secret (sécurité)
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
    
    console.log('🔐 Auth header présent:', !!authHeader);
    console.log('🔐 Auth valide:', authHeader === expectedAuth);
    
    if (authHeader !== expectedAuth) {
      console.log('⚠️ Authentification cron échouée');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Configuration
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY?.split(',')[0]; // Première clé
    
    console.log('🔧 Configuration:');
    console.log('  - SHEET_ID:', SHEET_ID ? 'OK' : 'MANQUANT');
    console.log('  - SERVICE_ACCOUNT_EMAIL:', SERVICE_ACCOUNT_EMAIL ? 'OK' : 'MANQUANT');
    console.log('  - PRIVATE_KEY:', PRIVATE_KEY ? 'OK' : 'MANQUANT');
    console.log('  - GEMINI_API_KEY:', GEMINI_API_KEY ? `OK (${GEMINI_API_KEY.substring(0, 20)}...)` : 'MANQUANT');
    
    if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY || !GEMINI_API_KEY) {
      console.error('❌ Variables environnement manquantes');
      return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 });
    }
    
    // Connexion Google Sheets
    console.log('📊 Connexion à Google Sheets...');
    const serviceAccountAuth = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log('📊 Sheet chargé:', doc.title);
    
    const sheet = doc.sheetsByIndex[0];
    console.log('📊 Première feuille:', sheet.title);
    
    const rows = await sheet.getRows();
    console.log(`📋 ${rows.length} lignes totales dans le Sheet`);
    
    // Debug: afficher quelques lignes
    if (rows.length > 0) {
      console.log('📋 Exemple de ligne (première):');
      const firstRow = rows[0];
      console.log('  - Prompt:', firstRow.get('Prompt')?.substring(0, 50));
      console.log('  - Statut:', firstRow.get('Statut'));
      console.log('  - Type:', firstRow.get('Type'));
      console.log('  - Format:', firstRow.get('Format'));
    }
    
    // Chercher les vidéos en cours
    const videoRows = rows.filter(row => {
      const status = (row.get('Statut') || '').toLowerCase();
      const type = (row.get('Type') || '').toLowerCase();
      const match = status === 'en cours vidéo' && type === 'video';
      
      if (match) {
        console.log('🎯 Ligne trouvée en attente:');
        console.log('  - Row number:', row.rowNumber);
        console.log('  - Statut:', row.get('Statut'));
        console.log('  - Type:', row.get('Type'));
        console.log('  - Prompt:', row.get('Prompt')?.substring(0, 50));
      }
      
      return match;
    });
    
    console.log(`🎬 ${videoRows.length} vidéo(s) en attente de traitement`);
    
    if (videoRows.length === 0) {
      console.log('✅ Aucune vidéo à traiter, fin du cron');
      return NextResponse.json({ 
        success: true, 
        message: 'Aucune vidéo en attente',
        processed: 0
      });
    }
    
    // Traiter UNE vidéo (pour éviter timeout)
    const row = videoRows[0];
    const prompt = row.get('Prompt');
    const format = row.get('Format') || '9:16';
    
    console.log('');
    console.log('🎬 ========================================');
    console.log('🎬 TRAITEMENT VIDÉO');
    console.log('🎬 ========================================');
    console.log(`📝 Prompt complet: "${prompt}"`);
    console.log(`📐 Format: "${format}"`);
    console.log(`📍 Row number: ${row.rowNumber}`);
    console.log('');
    
    try {
      const videoUri = await generateVeoVideo(GEMINI_API_KEY, prompt, format);
      
      console.log('');
      console.log('🎬 ========================================');
      console.log('🎬 RÉSULTAT GÉNÉRATION');
      console.log('🎬 ========================================');
      
      if (videoUri) {
        console.log('✅ Vidéo générée avec succès !');
        console.log('📹 URI:', videoUri);
        
        // Succès - mise à jour Sheet
        console.log('💾 Mise à jour du Google Sheet...');
        row.set('Statut', 'généré');
        row.set('URL Image', videoUri);
        row.set('Date génération', new Date().toLocaleString('fr-FR'));
        await row.save();
        
        console.log('✅ Sheet mis à jour avec succès');
        console.log('');
        
        return NextResponse.json({ 
          success: true, 
          message: 'Vidéo générée',
          processed: 1,
          videoUri
        });
      } else {
        console.error('❌ generateVeoVideo a retourné null');
        
        // Échec - marquer comme erreur
        console.log('💾 Mise à jour du statut en "erreur génération"...');
        row.set('Statut', 'erreur génération');
        await row.save();
        
        console.error('❌ Échec génération vidéo (voir logs ci-dessus)');
        console.log('');
        
        return NextResponse.json({ 
          success: false, 
          message: 'Échec génération',
          processed: 0
        });
      }
      
    } catch (error: any) {
      console.error('❌ Exception lors du traitement:', error.message);
      console.error('📚 Stack:', error.stack);
      
      row.set('Statut', `erreur: ${error.message.substring(0, 50)}`);
      await row.save();
      
      return NextResponse.json({ 
        success: false, 
        error: error.message,
        processed: 0
      }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('❌ ========================================');
    console.error('❌ ERREUR GLOBALE CRON');
    console.error('❌ ========================================');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('Error object:', JSON.stringify(error, null, 2));
    
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
