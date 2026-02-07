import { NextResponse } from 'next/server';

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

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
    iat: now,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const crypto = await import('crypto');
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

// ============================================================
// GET: Poll Kling task status
// ============================================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ success: false, error: 'taskId requis' }, { status: 400 });
    }

    const token = await generateKlingJWT();

    const response = await fetch(`https://api.klingai.com/v1/videos/image2video/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json({
          success: false,
          pending: true,
          message: 'Rate limit, réessaie bientôt',
        });
      }
      return NextResponse.json({
        success: false,
        error: `Erreur Kling polling (${response.status})`,
      }, { status: response.status });
    }

    const text = await response.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      return NextResponse.json({
        success: false,
        pending: true,
        error: 'Réponse non-JSON de Kling',
      });
    }

    const taskStatus = result.data?.task_status;

    if (taskStatus === 'succeed') {
      const videoUrl = result.data?.task_result?.videos?.[0]?.url;
      if (!videoUrl) {
        return NextResponse.json({
          success: false,
          error: 'Kling: tâche terminée mais pas de vidéo dans la réponse',
        });
      }

      // Try to fetch video and convert to base64
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
          });
        }
      } catch {
        // Fallback
      }

      return NextResponse.json({
        success: true,
        done: true,
        videoUri: videoUrl,
      });
    }

    if (taskStatus === 'failed') {
      return NextResponse.json({
        success: false,
        done: true,
        error: result.data?.task_status_msg || 'Génération vidéo échouée',
      });
    }

    // submitted / processing
    return NextResponse.json({
      success: true,
      done: false,
      pending: true,
      status: taskStatus,
      message: `Vidéo en cours (${taskStatus || 'processing'})...`,
    });

  } catch (error: any) {
    console.error('❌ [Kling Poll] Erreur:', error.message);
    return NextResponse.json({
      success: false,
      pending: true,
      error: error.message,
    });
  }
}
