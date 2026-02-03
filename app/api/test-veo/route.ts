import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 110; // > 90s de polling

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY?.split(',')[0]?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'No GOOGLE_API_KEY' }, { status: 500 });
  }

  const logs: string[] = [];

  // --- 1. Lance une opération Veo ---
  logs.push('1. Lancement opération via predictLongRunning...');

  const startRes = await fetch(
    `${BASE_URL}/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        instances: [{ prompt: 'A simple red ball bouncing on a white floor.' }],
        parameters: { aspectRatio: '16:9', sampleCount: 1 },
      }),
    }
  );

  const startData = await startRes.json();
  if (!startData.name) {
    return NextResponse.json({ error: 'Failed to start', startData }, { status: 500 });
  }

  const operationName = startData.name;
  logs.push(`✅ Opération lancée: ${operationName}`);

  // --- 2. Teste aussi l'endpoint generateVideos (POST) pour comparaison ---
  logs.push('2. Test parallèle: POST generateVideos...');

  let generateVideosResult: any = null;
  try {
    const gvRes = await fetch(
      `${BASE_URL}/models/veo-3.1-generate-preview:generateVideos?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          prompt: 'A simple red ball bouncing on a white floor.',
          config: { aspectRatio: '16:9' },
        }),
      }
    );
    generateVideosResult = {
      status: gvRes.status,
      body: await gvRes.json(),
    };
  } catch (e: any) {
    generateVideosResult = { error: e.message };
  }
  logs.push(`   generateVideos result: ${JSON.stringify(generateVideosResult).slice(0, 300)}`);

  // --- 3. Polling prolongé sur l'opération predictLongRunning (90s) ---
  logs.push('3. Polling prolongé (90s, toutes les 10s)...');

  const pollResults: { t: number; keys: string[]; done?: boolean; response?: any; raw?: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < 9; i++) {
    // Attends 10s avant chaque poll
    await new Promise((r) => setTimeout(r, 10000));

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const pollUrl = `${BASE_URL}/${operationName}?key=${apiKey}`;
    const pollRes = await fetch(pollUrl, {
      headers: { 'x-goog-api-key': apiKey },
      cache: 'no-store',
    });

    const pollText = await pollRes.text();
    let pollJson: any = {};
    try {
      pollJson = JSON.parse(pollText);
    } catch {}

    pollResults.push({
      t: elapsed,
      keys: Object.keys(pollJson),
      done: pollJson.done,
      response: pollJson.response ? pollJson.response : undefined,
      raw: pollText.slice(0, 200),
    });

    logs.push(`   [${elapsed}s] keys=${JSON.stringify(Object.keys(pollJson))} done=${pollJson.done ?? 'absent'}`);

    // Si done:true, on s'arrête
    if (pollJson.done === true) {
      logs.push(`   🎉 done:true trouvé à ${elapsed}s !`);
      break;
    }
  }

  // --- 4. Si generateVideos a retourné une opération, on la pollé aussi ---
  let generateVideosPolling: any[] = [];
  if (generateVideosResult?.body?.name) {
    const gvOpName = generateVideosResult.body.name;
    logs.push(`4. Polling sur l'opération generateVideos: ${gvOpName}`);

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      const gvPollRes = await fetch(`${BASE_URL}/${gvOpName}?key=${apiKey}`, {
        headers: { 'x-goog-api-key': apiKey },
        cache: 'no-store',
      });
      const gvPollJson = await gvPollRes.json();
      generateVideosPolling.push({ t: elapsed, keys: Object.keys(gvPollJson), done: gvPollJson.done });
      logs.push(`   [${elapsed}s] keys=${JSON.stringify(Object.keys(gvPollJson))} done=${gvPollJson.done ?? 'absent'}`);

      if (gvPollJson.done === true) break;
    }
  }

  return NextResponse.json({
    logs,
    operationName,
    generateVideosResult,
    pollResults,
    generateVideosPolling,
  });
}
