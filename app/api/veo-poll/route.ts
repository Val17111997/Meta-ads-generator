import { NextResponse } from 'next/server';

export const maxDuration = 55; // Vercel: max 55s sur Pro

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Extraction robuste de l'URI vidéo — supporte les deux formats
// Gemini API: response.generateVideoResponse.generatedSamples[0].video.uri
// Vertex AI:  response.videos[0].gcsUri
function extractVideoUri(op: any): string | null {
  // Chemin 1 : Gemini API (celui qu'on utilise)
  const geminiUri = op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (geminiUri) return geminiUri;

  // Chemin 2 : Vertex AI (backup)
  const vertexUri = op?.response?.videos?.[0]?.gcsUri;
  if (vertexUri) return vertexUri;

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationName = url.searchParams.get('operation');

  if (!operationName) {
    return NextResponse.json({ error: 'Paramètre operation manquant' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY non configurée' }, { status: 500 });
  }

  const pollUrl = `${BASE_URL}/${operationName}`;
  console.log('🎬 veo-poll: polling', pollUrl);

  // Boucle interne: 5 tentatives × 10s = 50s max (dans maxDuration: 55)
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1) {
      console.log(`⏳ veo-poll: attente 10s avant tentative ${attempt}/5`);
      await new Promise(r => setTimeout(r, 10000));
    }

    try {
      const res = await fetch(pollUrl, {
        headers: { 'x-goog-api-key': apiKey }
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`❌ veo-poll: HTTP ${res.status}`, errText);
        // 404 = operation inconnue → pas la peine de réessayer
        if (res.status === 404) {
          return NextResponse.json({ error: `Operation introuvable: ${errText}` }, { status: 404 });
        }
        continue; // réessayer sur les autres erreurs
      }

      const op = await res.json();
      console.log('📡 veo-poll réponse brute:', JSON.stringify(op, null, 2));

      if (op.done === true) {
        // Check erreur côté Veo
        if (op.error) {
          console.error('❌ veo-poll: erreur dans operation:', op.error);
          return NextResponse.json({
            success: false,
            done: true,
            error: op.error?.message || 'Erreur inconnue Veo'
          });
        }

        const videoUri = extractVideoUri(op);
        if (!videoUri) {
          console.error('❌ veo-poll: done=true mais pas d\'URI vidéo. Réponse:', JSON.stringify(op));
          return NextResponse.json({
            success: false,
            done: true,
            error: 'Vidéo générée mais URI introuvable',
            rawResponse: op
          });
        }

        console.log('✅ veo-poll: vidéo prête!', videoUri);

        // La vidéo URI nécessite x-goog-api-key pour être téléchargée
        // On la télécharge ici côté serveur et on retourne en base64
        try {
          console.log('📥 veo-poll: téléchargement vidéo depuis', videoUri);
          const videoRes = await fetch(videoUri, {
            headers: { 'x-goog-api-key': apiKey },
            redirect: 'follow' // IMPORTANT: suivre les redirects
          });

          if (videoRes.ok) {
            const videoBuffer = await videoRes.arrayBuffer();
            const base64 = Buffer.from(videoBuffer).toString('base64');
            const mimeType = videoRes.headers.get('content-type') || 'video/mp4';
            const dataUri = `data:${mimeType};base64,${base64}`;
            console.log(`✅ veo-poll: vidéo téléchargée (${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);

            return NextResponse.json({
              success: true,
              done: true,
              videoUri: dataUri,
              originalUri: videoUri
            });
          } else {
            console.warn(`⚠️ veo-poll: téléchargement vidéo échoué (${videoRes.status}), retourne URI brute`);
            // Fallback: retourner l'URI brute — le frontend devra la proxier
            return NextResponse.json({
              success: true,
              done: true,
              videoUri: videoUri,
              requiresAuth: true
            });
          }
        } catch (downloadErr: any) {
          console.warn('⚠️ veo-poll: erreur download vidéo:', downloadErr.message);
          return NextResponse.json({
            success: true,
            done: true,
            videoUri: videoUri,
            requiresAuth: true
          });
        }

      } else {
        console.log(`⏳ veo-poll: tentative ${attempt}/5 — pas encore done`);
        // Continue la boucle
      }

    } catch (fetchErr: any) {
      console.error(`❌ veo-poll: erreur fetch tentative ${attempt}:`, fetchErr.message);
    }
  }

  // Après 5 tentatives sans done=true → retourner pending
  console.log('⏳ veo-poll: timeout après 5 tentatives, vidéo toujours en cours');
  return NextResponse.json({
    pending: true,
    operation: operationName,
    message: 'Vidéo toujours en cours après 50s — le frontend va re-poller'
  });
}
