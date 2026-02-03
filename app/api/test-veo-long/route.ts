import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 110;

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export async function GET() {
  const apiKey = process.env.GOOGLE_API_KEY?.split(',')[0]?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'No GOOGLE_API_KEY' }, { status: 500 });
  }

  const logs: string[] = [];

  // 1. Lance predictLongRunning
  logs.push('1. Lancement via predictLongRunning...');
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
  logs.push(`OK operation: ${operationName}`);

  // 2. Test generateVideos en parallèle
  logs.push('2. Test POST :generateVideos...');
  let gvResult: any = null;
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
    gvResult = { status: gvRes.status, body: await gvRes.json() };
  } catch (e: any) {
    gvResult = { error: e.message };
  }
  logs.push(`   generateVideos => ${JSON.stringify(gvResult).slice(0, 400)}`);

  // 3. Polling prolongé sur predictLongRunning (90s)
  logs.push('3. Polling predictLongRunning toutes les 10s...');
  const pollResults: any[] = [];
  const t0 = Date.now();

  for (let i = 0; i < 9; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const elapsed = Math.round((Date.now() - t0) / 1000);

    const res = await fetch(`${BASE_URL}/${operationName}?key=${apiKey}`, {
      headers: { 'x-goog-api-key': apiKey },
      cache: 'no-store',
    });
    const json = await res.json();
    pollResults.push({ t: elapsed, keys: Object.keys(json), done: json.done ?? null });
    logs.push(`   [${elapsed}s] keys=${JSON.stringify(Object.keys(json))} done=${json.done ?? 'absent'}`);

    if (json.done === true) {
      logs.push(`   DONE at ${elapsed}s! response=${JSON.stringify(json.response).slice(0,300)}`);
      break;
    }
  }

  // 4. Si generateVideos a retourné une opération, on la pollé aussi
  let gvPollResults: any[] = [];
  if (gvResult?.body?.name) {
    logs.push(`4. Polling sur opération generateVideos: ${gvResult.body.name}`);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const res = await fetch(`${BASE_URL}/${gvResult.body.name}?key=${apiKey}`, {
        headers: { 'x-goog-api-key': apiKey },
        cache: 'no-store',
      });
      const json = await res.json();
      gvPollResults.push({ t: elapsed, keys: Object.keys(json), done: json.done ?? null });
      logs.push(`   [${elapsed}s] keys=${JSON.stringify(Object.keys(json))} done=${json.done ?? 'absent'}`);
      if (json.done === true) break;
    }
  }

  return NextResponse.json({ logs, operationName, gvResult, pollResults, gvPollResults });
}
