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
    
    const aspectRatio = format === '16:9' || format === '9:16' ? format : '9:16';
    
    // Étape 1 : Lancer la génération (Operation)
    const startResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateVideos?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          config: {
            aspectRatio: aspectRatio,
            numberOfVideos: 1,
            durationSeconds: 8,
            personGeneration: 'ALLOW_ADULT',
            resolution: '720p'
          }
        })
      }
    );
    
    if (!startResponse.ok) {
      const error = await startResponse.text();
      console.error('❌ Erreur démarrage Veo:', error);
      return null;
    }
    
    const operation: VeoOperation = await startResponse.json();
    console.log('⏳ Opération lancée:', operation.name);
    
    // Étape 2 : Attendre que la vidéo soit prête (polling)
    let attempts = 0;
    const maxAttempts = 6; // 6 tentatives * 10s = 60s max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10s
      attempts++;
      
      console.log(`⏳ Vérification ${attempts}/${maxAttempts}...`);
      
      const checkResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${apiKey}`,
        { method: 'GET' }
      );
      
      if (!checkResponse.ok) {
        console.error('❌ Erreur vérification status');
        continue;
      }
      
      const updatedOperation: VeoOperation & { result?: VeoResult } = await checkResponse.json();
      
      if (updatedOperation.done) {
        console.log('✅ Vidéo générée !');
        
        const result = updatedOperation.result;
        if (result?.generated_videos && result.generated_videos.length > 0) {
          const videoUri = result.generated_videos[0].video.uri;
          console.log('📹 URI vidéo:', videoUri);
          return videoUri;
        }
        
        console.error('❌ Pas de vidéo dans le résultat');
        return null;
      }
    }
    
    console.log('⏰ Timeout: vidéo pas encore prête après 60s');
    return null;
    
  } catch (error: any) {
    console.error('❌ Erreur Veo:', error.message);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    console.log('🎬 Démarrage du worker vidéo Cron...');
    
    // Vérifier le cron secret (sécurité)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('⚠️ Authentification cron échouée');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Configuration
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY?.split(',')[0]; // Première clé
    
    if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY || !GEMINI_API_KEY) {
      console.error('❌ Variables environnement manquantes');
      return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 });
    }
    
    // Connexion Google Sheets
    const serviceAccountAuth = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    console.log(`📋 ${rows.length} lignes dans le Sheet`);
    
    // Chercher les vidéos en cours
    const videoRows = rows.filter(row => {
      const status = (row.get('Statut') || '').toLowerCase();
      const type = (row.get('Type') || '').toLowerCase();
      return status === 'en cours vidéo' && type === 'video';
    });
    
    console.log(`🎬 ${videoRows.length} vidéo(s) en attente`);
    
    if (videoRows.length === 0) {
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
    
    console.log(`🎬 Génération: "${prompt.substring(0, 50)}..."`);
    
    try {
      const videoUri = await generateVeoVideo(GEMINI_API_KEY, prompt, format);
      
      if (videoUri) {
        // Succès
        row.set('Statut', 'généré');
        row.set('URL Image', videoUri);
        row.set('Date génération', new Date().toLocaleString('fr-FR'));
        await row.save();
        
        console.log('✅ Vidéo générée et Sheet mis à jour');
        
        return NextResponse.json({ 
          success: true, 
          message: 'Vidéo générée',
          processed: 1,
          videoUri
        });
      } else {
        // Échec
        row.set('Statut', 'erreur génération');
        await row.save();
        
        console.error('❌ Échec génération vidéo');
        
        return NextResponse.json({ 
          success: false, 
          message: 'Échec génération',
          processed: 0
        });
      }
      
    } catch (error: any) {
      console.error('❌ Erreur:', error.message);
      row.set('Statut', `erreur: ${error.message.substring(0, 50)}`);
      await row.save();
      
      return NextResponse.json({ 
        success: false, 
        error: error.message,
        processed: 0
      }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error('❌ Erreur globale cron:', error.message);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
