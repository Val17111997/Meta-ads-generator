import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface VeoOperation {
  name: string;
  done?: boolean;
  metadata?: any;
  response?: {
    videos?: Array<{
      uri: string;
    }>;
  };
}

async function generateVeoVideo(apiKey: string, prompt: string, format: string): Promise<string | null> {
  try {
    console.log('📡 Génération vidéo avec Veo 3.1...');
    console.log('🔑 API Key présente:', apiKey ? `${apiKey.substring(0, 20)}...` : 'MANQUANTE');
    console.log('📝 Prompt:', prompt.substring(0, 100));
    console.log('📐 Format demandé:', format);
    
    const aspectRatio = format === '16:9' || format === '9:16' ? format : '9:16';
    console.log('📐 Format final (aspect ratio):', aspectRatio);
    
    const requestBody = {
      instances: [{
        prompt: prompt,
        config: {
          aspectRatio: aspectRatio,
          durationSeconds: 8,
          resolution: "720p"
        }
      }]
    };
    
    console.log('📦 Request body:', JSON.stringify(requestBody, null, 2));
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`;
    console.log('🌐 URL appelée:', url.replace(apiKey, '[API_KEY_MASQUEE]'));
    
    const startResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    console.log('📊 Response status:', startResponse.status, startResponse.statusText);
    
    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error('❌ Erreur démarrage Veo (HTTP ' + startResponse.status + '):', errorText);
      
      try {
        const errorJson = JSON.parse(errorText);
        console.error('📋 Détails erreur:', JSON.stringify(errorJson, null, 2));
      } catch (parseError) {
        console.error('📋 Erreur brute:', errorText);
      }
      
      return null;
    }
    
    const operation: VeoOperation = await startResponse.json();
    console.log('⏳ Opération lancée:', operation.name);
    
    let attempts = 0;
    const maxAttempts = 6;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;
      
      console.log(`⏳ Vérification ${attempts}/${maxAttempts}...`);
      
      const checkUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${apiKey}`;
      
      const checkResponse = await fetch(checkUrl, { 
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('📊 Check response status:', checkResponse.status);
      
      if (!checkResponse.ok) {
        const checkError = await checkResponse.text();
        console.error('❌ Erreur vérification:', checkError);
        continue;
      }
      
      const updatedOperation: VeoOperation = await checkResponse.json();
      console.log('📊 Status opération:', JSON.stringify(updatedOperation, null, 2));
      
      if (updatedOperation.done) {
        console.log('✅ Vidéo générée !');
        
        const videoUri = updatedOperation.response?.videos?.[0]?.uri;
        
        if (videoUri) {
          console.log('📹 URI vidéo:', videoUri);
          return videoUri;
        }
        
        console.error('❌ Pas de vidéo dans la réponse');
        return null;
      }
      
      console.log('⏳ Vidéo pas encore prête...');
    }
    
    console.log('⏰ Timeout après 60s');
    return null;
    
  } catch (error: any) {
    console.error('❌ Exception:', error.message);
    console.error('📚 Stack:', error.stack);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    console.log('🎬 Démarrage du worker vidéo Cron...');
    
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
    
    if (authHeader !== expectedAuth) {
      console.log('⚠️ Authentification cron échouée');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const GEMINI_API_KEY = process.env.GOOGLE_API_KEY?.split(',')[0];
    
    console.log('🔧 Configuration OK');
    
    if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY || !GEMINI_API_KEY) {
      console.error('❌ Variables environnement manquantes');
      return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 });
    }
    
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
    
    const row = videoRows[0];
    const prompt = row.get('Prompt');
    const format = row.get('Format') || '9:16';
    
    console.log('🎬 Traitement vidéo...');
    
    try {
      const videoUri = await generateVeoVideo(GEMINI_API_KEY, prompt, format);
      
      if (videoUri) {
        console.log('✅ Succès !');
        
        row.set('Statut', 'généré');
        row.set('URL Image', videoUri);
        row.set('Date génération', new Date().toLocaleString('fr-FR'));
        await row.save();
        
        return NextResponse.json({ 
          success: true, 
          message: 'Vidéo générée',
          processed: 1,
          videoUri
        });
      } else {
        console.error('❌ Échec');
        
        row.set('Statut', 'erreur génération');
        await row.save();
        
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
    console.error('❌ Erreur globale:', error.message);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
