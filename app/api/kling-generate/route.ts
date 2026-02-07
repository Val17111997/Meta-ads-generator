import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ============================================================
// JWT Token Generation for Kling API (HS256)
// ============================================================
async function generateKlingJWT(): Promise<string> {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('KLING_ACCESS_KEY ou KLING_SECRET_KEY non configuré');
  }

  // Header
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');

  // Payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: now + 1800, // 30 min
    nbf: now - 5,    // valid 5s before
    iat: now,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // Signature (HS256 = HMAC-SHA256)
  const crypto = await import('crypto');
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

// ============================================================
// POST: Start Kling image-to-video generation
// ============================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, imageUrl, duration = 5, aspectRatio = '16:9', mode = 'pro' } = body;

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt requis' }, { status: 400 });
    }

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: 'Image requise pour image-to-video' }, { status: 400 });
    }

    // Generate JWT token
    const token = await generateKlingJWT();

    console.log('🎬 [Kling v3] Démarrage image-to-video...');
    console.log(`📝 Prompt: ${prompt.substring(0, 80)}...`);
    console.log(`📐 Format: ${aspectRatio}, Durée: ${duration}s, Mode: ${mode}`);

    // Determine if imageUrl is base64 or a URL
    let imagePayload: string;
    if (imageUrl.startsWith('data:')) {
      // Base64 image — Kling needs a URL, so we need to handle this
      // Kling API accepts base64 in the "image" field directly
      imagePayload = imageUrl;
    } else {
      imagePayload = imageUrl;
    }

    // Build request body for Kling v3 image-to-video
    const requestBody: any = {
      model_name: 'kling-v3',
      prompt: prompt,
      image: imagePayload,
      cfg_scale: 0.5,
      mode: mode,          // 'std' or 'pro'
      duration: String(duration), // '5' or '10'
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

    const responseText = await response.text();
    let result: any;
    try {
      result = JSON.parse(responseText);
    } catch {
      console.error('❌ [Kling] Réponse non-JSON:', responseText.substring(0, 300));
      return NextResponse.json({
        success: false,
        error: 'Réponse inattendue de Kling',
      }, { status: 502 });
    }

    console.log('📊 [Kling] Status:', response.status, '| Code:', result.code);

    if (response.status === 429) {
      return NextResponse.json({
        success: false,
        error: 'Rate limit Kling — réessaie dans un moment',
        retryable: true,
      }, { status: 429 });
    }

    if (!response.ok || (result.code && result.code !== 0)) {
      console.error('❌ [Kling] Erreur:', JSON.stringify(result).substring(0, 500));
      return NextResponse.json({
        success: false,
        error: result.message || `Erreur Kling (${response.status})`,
      }, { status: response.status });
    }

    const taskId = result.data?.task_id;
    if (!taskId) {
      console.error('❌ [Kling] Pas de task_id dans la réponse:', JSON.stringify(result).substring(0, 500));
      return NextResponse.json({
        success: false,
        error: 'Kling n\'a pas retourné de task_id',
      }, { status: 502 });
    }

    console.log('✅ [Kling] Tâche créée:', taskId);

    // Poll a few times within the request timeout (max ~50s)
    const maxInlinePolls = 5;
    for (let poll = 1; poll <= maxInlinePolls; poll++) {
      await new Promise(r => setTimeout(r, 8000)); // 8s between polls
      console.log(`⏳ [Kling] Polling ${poll}/${maxInlinePolls}...`);

      const pollToken = await generateKlingJWT();
      const pollResponse = await fetch(`https://api.klingai.com/v1/videos/image2video/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${pollToken}`,
        },
        cache: 'no-store',
      });

      if (!pollResponse.ok) continue;

      const pollText = await pollResponse.text();
      let pollResult: any;
      try {
        pollResult = JSON.parse(pollText);
      } catch {
        continue;
      }

      const taskStatus = pollResult.data?.task_status;
      console.log(`📊 [Kling] Status tâche: ${taskStatus}`);

      if (taskStatus === 'succeed') {
        const videoUrl = pollResult.data?.task_result?.videos?.[0]?.url;
        if (videoUrl) {
          console.log('✅ [Kling] Vidéo générée !', videoUrl.substring(0, 80));

          // Try to fetch and convert to base64
          try {
            const videoRes = await fetch(videoUrl);
            if (videoRes.ok) {
              const videoBuffer = await videoRes.arrayBuffer();
              const base64 = Buffer.from(videoBuffer).toString('base64');
              const mimeType = videoRes.headers.get('content-type') || 'video/mp4';
              return NextResponse.json({
                success: true,
                done: true,
                videoUri: `data:${mimeType};base64,${base64}`,
                taskId,
              });
            }
          } catch {
            // Fallback: return URL directly
          }

          return NextResponse.json({
            success: true,
            done: true,
            videoUri: videoUrl,
            taskId,
          });
        }
      }

      if (taskStatus === 'failed') {
        const errorMsg = pollResult.data?.task_status_msg || 'Échec de la génération';
        console.error('❌ [Kling] Tâche échouée:', errorMsg);
        return NextResponse.json({
          success: false,
          error: errorMsg,
        }, { status: 500 });
      }

      // processing/submitted — continue polling
    }

    // Timeout inline, return task_id for client-side polling
    console.log('⏰ [Kling] Timeout inline, polling côté client pour taskId:', taskId);
    return NextResponse.json({
      success: true,
      done: false,
      pending: true,
      taskId,
      message: 'Vidéo en cours — polling à reprendre côté client',
    });

  } catch (error: any) {
    console.error('❌ [Kling] Erreur inattendue:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
