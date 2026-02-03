import { NextResponse } from 'next/server';

/**
 * GET /api/test-veo
 * 
 * Route de diagnostic : lance une opération Veo, puis teste le polling
 * avec les DEUX méthodes d'authentification pour voir laquelle marche.
 * 
 * Appelle cette URL une fois, attends la réponse (peut prendre ~20-30s),
 * puis regarde le JSON retourné pour savoir ce qui marche.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 55; // Rester sous le timeout Vercel

export async function GET() {
  const apiKey = (process.env.GOOGLE_API_KEY || '').split(',')[0]?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: 'Pas de clé API trouvée' }, { status: 500 });
  }

  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
  const results: any = { steps: [] };

  // ── Étape 1 : Lancer une opération Veo ──
  results.steps.push('1. Lancement opération...');

  const startRes = await fetch(`${BASE_URL}/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      instances: [{ prompt: 'A simple white cat sitting on a table' }],
      parameters: {
        aspectRatio: '16:9',
        durationSeconds: 4,
        resolution: '720p'
      }
    })
  });

  results.startStatus = startRes.status;

  if (!startRes.ok) {
    const errText = await startRes.text();
    results.startError = errText.substring(0, 500);
    results.steps.push(`❌ Échec démarrage: HTTP ${startRes.status}`);
    return NextResponse.json(results);
  }

  const startData = await startRes.json();
  results.operationName = startData.name;
  results.steps.push(`✅ Opération lancée: ${startData.name}`);

  if (!startData.name) {
    results.steps.push('❌ Pas de operation.name dans la réponse');
    results.startResponse = startData;
    return NextResponse.json(results);
  }

  // ── Attendre 15s pour que l'opération existe bien ──
  results.steps.push('2. Attente 15s...');
  await new Promise(r => setTimeout(r, 15000));

  // ── Étape 2 : Tester le polling avec 3 méthodes différentes ──

  // MÉTHODE A : ?key= comme query param (comme dans les docs Google REST officiels)
  results.steps.push('3. Test polling méthode A (?key= query param)...');
  const urlA = `${BASE_URL}/${startData.name}?key=${apiKey}`;
  const resA = await fetch(urlA, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  let dataA: any;
  try { dataA = await resA.json(); } catch { dataA = await resA.text(); }

  results.methodA = {
    url: urlA.replace(apiKey, 'KEY_REDACTED'),
    status: resA.status,
    done: dataA?.done,
    hasError: !!dataA?.error,
    keys: typeof dataA === 'object' ? Object.keys(dataA) : 'not-json',
    // On montre la réponse complète pour diagnostic
    response: typeof dataA === 'string' ? dataA.substring(0, 500) : dataA,
  };

  // MÉTHODE B : header x-goog-api-key uniquement (ce que ton code fait actuellement)
  results.steps.push('4. Test polling méthode B (header x-goog-api-key)...');
  const urlB = `${BASE_URL}/${startData.name}`;
  const resB = await fetch(urlB, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    cache: 'no-store',
  });
  let dataB: any;
  try { dataB = await resB.json(); } catch { dataB = await resB.text(); }

  results.methodB = {
    url: urlB.replace(apiKey, 'KEY_REDACTED'),
    status: resB.status,
    done: dataB?.done,
    hasError: !!dataB?.error,
    keys: typeof dataB === 'object' ? Object.keys(dataB) : 'not-json',
    response: typeof dataB === 'string' ? dataB.substring(0, 500) : dataB,
  };

  // MÉTHODE C : Les deux en même temps
  results.steps.push('5. Test polling méthode C (query param + header)...');
  const urlC = `${BASE_URL}/${startData.name}?key=${apiKey}`;
  const resC = await fetch(urlC, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    cache: 'no-store',
  });
  let dataC: any;
  try { dataC = await resC.json(); } catch { dataC = await resC.text(); }

  results.methodC = {
    url: urlC.replace(apiKey, 'KEY_REDACTED'),
    status: resC.status,
    done: dataC?.done,
    hasError: !!dataC?.error,
    keys: typeof dataC === 'object' ? Object.keys(dataC) : 'not-json',
    response: typeof dataC === 'string' ? dataC.substring(0, 500) : dataC,
  };

  // ── Conclusion ──
  results.steps.push('6. Analyse...');

  if (dataA?.done || dataB?.done || dataC?.done) {
    results.conclusion = '✅ Le polling marche ! La vidéo est déjà prête (elle était rapide)';
  } else {
    // Aucune méthode ne donne done=true après 15s — normal, Veo prend 30-90s
    // Le point important c'est de voir si les réponses sont identiques ou différentes
    const aOk = resA.status === 200;
    const bOk = resB.status === 200;
    const cOk = resC.status === 200;

    if (aOk && bOk && cOk) {
      // Toutes les méthodes donnent 200 — le problème n'est pas l'auth
      // Il faut juste attendre plus longtemps
      results.conclusion = '✅ Les 3 méthodes donnent HTTP 200. Le polling est correct — il faut simplement attendre que done=true. La vidéo n\'est pas encore prête après 15s (normal, Veo prend 30-90s). Déploie les fichiers corrects et teste avec un polling plus long.';
    } else {
      results.conclusion = `⚠️ Résultats mixtes: A=${resA.status}, B=${resB.status}, C=${resC.status}. Vérifie les détails ci-dessous.`;
    }
  }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
}
