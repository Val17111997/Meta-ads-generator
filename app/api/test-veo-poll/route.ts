import { NextResponse } from 'next/server';

// Route temporaire de test : /api/test-veo-poll
// Supprime après avoir confirmé le bon endpoint

export async function GET(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY?.split(',')[0];

  if (!apiKey) {
    return NextResponse.json({ error: 'Pas de clé API trouvée' });
  }

  // L'opération du dernier test — on en lance une nouvelle pour avoir une opération fraîche
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  // 1) Lance une nouvelle opération Veo (prompt simple, rapide)
  console.log('🚀 Lancement opération de test...');
  const startRes = await fetch(`${BASE_URL}/models/veo-3.1-generate-preview:predictLongRunning`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      instances: [{ prompt: 'A simple white cat sitting on a table, 2 seconds' }],
      parameters: { aspectRatio: '16:9', durationSeconds: 4, resolution: '720p' }
    })
  });

  const startData = await startRes.json();
  console.log('📦 Start response:', JSON.stringify(startData));

  if (!startData.name) {
    return NextResponse.json({ error: 'Pas de operation name', startStatus: startRes.status, startData });
  }

  const operationName = startData.name;
  // Attendre 5s pour que l'opération existe bien
  await new Promise(r => setTimeout(r, 5000));

  // 2) Poll avec le chemin COMPLET (celui qu'on utilise actuellement)
  // ex: /v1beta/models/veo-3.1-generate-preview/operations/xxx
  const url1 = `${BASE_URL}/${operationName}`;
  const res1 = await fetch(url1, { headers: { 'x-goog-api-key': apiKey } });
  const data1 = await res1.json();

  // 3) Poll avec JUSTE l'ID d'opération
  // ex: /v1beta/operations/xxx
  const opId = operationName.split('/').pop(); // extraire juste "xxx"
  const url2 = `${BASE_URL}/operations/${opId}`;
  const res2 = await fetch(url2, { headers: { 'x-goog-api-key': apiKey } });
  let data2: any;
  try { data2 = await res2.json(); } catch { data2 = await res2.text(); }

  return NextResponse.json({
    operationName,
    test1_url_complete: {
      url: url1,
      status: res1.status,
      response: data1
    },
    test2_url_id_seul: {
      url: url2,
      status: res2.status,
      response: data2
    }
  }, { headers: { 'Cache-Control': 'no-store' } });
}
