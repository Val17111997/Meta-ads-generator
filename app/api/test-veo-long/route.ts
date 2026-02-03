import { NextResponse } from 'next/server';

/**
 * GET /api/veo-poll?operation=models/veo-3.1-generate-preview/operations/XXXX
 * 
 * Poll une opération Veo long-running.
 * Retourne :
 *   { success: true, done: true, videoUri: "..." }   — vidéo prête
 *   { success: true, pending: true }                  — encore en cours
 *   { success: false, error: "..." }                  — erreur définitive
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationName = url.searchParams.get('operation');

  if (!operationName) {
    return NextResponse.json({ success: false, error: 'Paramètre "operation" manquant' }, { status: 400 });
  }

  const apiKeys = (process.env.GOOGLE_API_KEY || '').split(',');
  const apiKey = apiKeys[0]?.trim();

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'GOOGLE_API_KEY non configurée' }, { status: 500 });
  }

  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  // ──────────────────────────────────────────────────────
  // POINT CLEF : l'URL de polling doit être exactement
  //   ${BASE_URL}/${operation_name}
  // avec ?key= comme query param (plus fiable que le header
  // pour les opérations long-running sur Gemini API).
  //
  // operation_name ressemble à :
  //   "models/veo-3.1-generate-preview/operations/abc123"
  // ──────────────────────────────────────────────────────
  const pollUrl = `${BASE_URL}/${operationName}?key=${apiKey}`;

  console.log('🔍 Polling URL:', pollUrl.replace(apiKey, 'KEY_REDACTED'));

  try {
    const response = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // On garde aussi le header — belt & suspenders
        'x-goog-api-key': apiKey,
      },
      // Crucial : pas de cache
      cache: 'no-store',
    });

    console.log('📊 Poll status HTTP:', response.status);

    if (response.status === 429) {
      // Rate limit — on retourne "pending" pour qu'il réessaie
      console.log('⚠️ Rate limit sur le polling, retry...');
      return NextResponse.json({ success: true, pending: true });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erreur polling HTTP', response.status, ':', errorText.substring(0, 300));
      
      // Si c'est un 404, l'opération n'existe plus (expirée après 2 jours)
      if (response.status === 404) {
        return NextResponse.json({ success: false, error: 'Opération expirée ou introuvable (404). Regénère la vidéo.' });
      }

      return NextResponse.json({ success: false, error: `Polling échoué: HTTP ${response.status}` });
    }

    const data = await response.json();
    console.log('📦 Réponse polling (keys):', Object.keys(data));
    console.log('📦 done:', data.done);

    // ── Pas encore terminé ──
    if (!data.done) {
      console.log('⏳ Opération encore en cours...');
      return NextResponse.json({ success: true, pending: true });
    }

    // ── Opération terminée avec erreur côté Veo ──
    if (data.error) {
      console.error('❌ Erreur dans l\'opération Veo:', JSON.stringify(data.error));
      return NextResponse.json({
        success: false,
        error: data.error?.message || 'Erreur Veo inconnue dans l\'opération',
      });
    }

    // ── done: true — extraire l'URI de la vidéo ──
    // Structure officielle (docs Google REST) :
    //   response.generateVideoResponse.generatedSamples[0].video.uri
    const videoUri =
      data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      // Fallbacks au cas où Google change la structure :
      data.response?.generatedVideos?.[0]?.video?.uri ||
      data.response?.videos?.[0]?.uri;

    if (!videoUri) {
      console.error('❌ done=true mais URI introuvable. Réponse complète:', JSON.stringify(data).substring(0, 800));
      return NextResponse.json({
        success: false,
        error: 'Vidéo générée mais URI introuvable dans la réponse. Vérifie les logs.',
      });
    }

    console.log('✅ Vidéo prête ! URI:', videoUri.substring(0, 80) + '...');

    // ── Proxy : télécharger la vidéo côté serveur ──
    // L'URI Veo nécessite x-goog-api-key et des redirects.
    // Le browser ne peut pas ça directement (CORS).
    try {
      const videoRes = await fetch(videoUri, {
        headers: { 'x-goog-api-key': apiKey },
        redirect: 'follow',
      });

      if (videoRes.ok) {
        const videoBuffer = await videoRes.arrayBuffer();
        const base64 = Buffer.from(videoBuffer).toString('base64');
        const mimeType = videoRes.headers.get('content-type') || 'video/mp4';
        const sizeMB = (videoBuffer.byteLength / 1024 / 1024).toFixed(2);
        console.log(`✅ Vidéo proxy OK (${sizeMB} MB, ${mimeType})`);

        return NextResponse.json({
          success: true,
          done: true,
          videoUri: `data:${mimeType};base64,${base64}`,
        });
      } else {
        console.warn(`⚠️ Proxy vidéo échoué (${videoRes.status}) — retourne l'URI brute`);
        return NextResponse.json({
          success: true,
          done: true,
          videoUri: videoUri, // Le frontend devra gérer cette URL
        });
      }
    } catch (dlErr: any) {
      console.warn('⚠️ Erreur download vidéo:', dlErr.message, '— retourne URI brute');
      return NextResponse.json({
        success: true,
        done: true,
        videoUri: videoUri,
      });
    }

  } catch (error: any) {
    console.error('❌ Erreur fetch polling:', error.message);
    return NextResponse.json({ success: false, error: `Erreur réseau polling: ${error.message}` });
  }
}
