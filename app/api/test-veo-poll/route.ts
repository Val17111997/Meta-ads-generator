import { NextResponse } from 'next/server';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export async function GET() {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').split(',')[0];
  if (!apiKey) return NextResponse.json({ error: 'Pas de clé API' });

  // 1) Lance une opération Veo
  const startRes = await fetch(BASE_URL + '/models/veo-3.1-generate-preview:predictLongRunning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      instances: [{ prompt: 'A white cat sitting on a table' }],
      parameters: { aspectRatio: '16:9', durationSeconds: 4, resolution: '720p' }
    })
  });
  const startData = await startRes.json();
  if (!startData.name) return NextResponse.json({ error: 'Pas de name', startData });

  const operationName: string = startData.name;
  // Attendre 5s que l'opération existe
  await new Promise(function(r) { setTimeout(r, 5000); });

  // 2) Test URL 1 : chemin complet comme retourné par Google
  // ex: /v1beta/models/veo-3.1-generate-preview/operations/xxx
  const url1 = BASE_URL + '/' + operationName;
  const res1 = await fetch(url1, { headers: { 'x-goog-api-key': apiKey } });
  const text1 = await res1.text();

  // 3) Test URL 2 : juste /operations/ID
  // ex: /v1beta/operations/xxx
  const opId = operationName.split('/').pop();
  const url2 = BASE_URL + '/operations/' + opId;
  const res2 = await fetch(url2, { headers: { 'x-goog-api-key': apiKey } });
  const text2 = await res2.text();

  return NextResponse.json({
    operationName: operationName,
    test1_chemin_complet: { url: url1, status: res1.status, response: text1 },
    test2_id_seul: { url: url2, status: res2.status, response: text2 }
  });
}
