import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SiteAnalysis {
  brandName: string;
  positioning: string;
  usps: string[];
  values: string[];
  products: string[];
  targetAudience: string;
  tone: string;
  socialProof: string[];
}

interface PromptItem {
  prompt: string;
  angle: string;
  concept: string;
  type: string;
  format: string;
}

// Concepts créatifs 2026
const CREATIVE_CONCEPTS = [
  'UGC/Native style - authentic smartphone footage look',
  'Problem-Solution split - before/after transformation',
  'Before/After comparison - dramatic visual change',
  'Testimonial/Social proof - real customer moment',
  'Flat lay composition - products and ingredients artfully arranged',
  'Grid composition - multiple product angles in mosaic',
  'Comparatif visuel - side by side with competitor or alternative',
  'Unboxing moment - hands opening package reveal',
  'Founder story - behind the scenes authenticity',
  'Lifestyle aspiration - dream scenario with product',
  'POV first person - subjective camera using product',
  'ASMR sensory - close-up textures and sounds',
  'Stop motion - playful animated product movement',
  'Cinematic hero shot - dramatic lighting and angles',
  'Tutorial/How-to - step by step demonstration'
];

// Fetch le contenu d'un site web
async function fetchWebsite(url: string): Promise<string> {
  try {
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    
    const html = await response.text();
    
    const cleanText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim()
      .slice(0, 15000);
    
    return cleanText;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Erreur fetch ' + url + ':', errorMessage);
    throw new Error('Impossible de charger le site: ' + errorMessage);
  }
}

// Appeler Claude API pour analyser et générer des prompts
async function callClaude(siteContent: string, siteUrl: string, existingCount: number = 0): Promise<{ analysis: SiteAnalysis; prompts: PromptItem[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }
  
  const conceptsList = CREATIVE_CONCEPTS.map((c, i) => (i + 1) + '. ' + c).join('\n');
  
  const variationNote = existingCount > 0 
    ? '\n\nIMPORTANT: Cette marque a déjà ' + existingCount + ' prompts. Génère des prompts DIFFÉRENTS et NOUVEAUX, avec des angles et concepts variés que tu n\'as pas encore utilisés.'
    : '';
  
  const systemPrompt = 'Tu es un expert en marketing digital et création de contenu publicitaire pour les réseaux sociaux (Meta Ads, TikTok, Instagram).\n\nTa mission : analyser un site web de marque et générer 20 prompts créatifs pour la génération d\'images et vidéos publicitaires avec l\'IA (Gemini/Veo).\n\nCONCEPTS CRÉATIFS 2026 À UTILISER :\n' + conceptsList + '\n\nRÈGLES POUR LES PROMPTS :\n- Chaque prompt doit être en ANGLAIS (meilleur pour les modèles IA)\n- Décrire précisément la scène visuelle, l\'éclairage, l\'ambiance, le cadrage\n- Mentionner le produit de manière naturelle sans forcer\n- Varier les angles marketing : bénéfices, émotions, social proof, lifestyle\n- Adapter au ton et positionnement de la marque\n- Finir chaque prompt par "no text, no watermark" pour éviter les textes générés\n- Format : descriptions visuelles détaillées de 2-4 phrases' + variationNote + '\n\nFORMAT DE RÉPONSE (JSON strict) :\n{\n  "analysis": {\n    "brandName": "nom de la marque",\n    "positioning": "positionnement en 1 phrase",\n    "usps": ["USP 1", "USP 2", "USP 3"],\n    "values": ["valeur 1", "valeur 2"],\n    "products": ["produit 1", "produit 2"],\n    "targetAudience": "cible principale",\n    "tone": "ton de communication",\n    "socialProof": ["preuve sociale 1", "preuve sociale 2"]\n  },\n  "prompts": [\n    {\n      "prompt": "le prompt créatif complet en anglais",\n      "angle": "nom de l\'angle marketing",\n      "concept": "concept créatif utilisé",\n      "type": "photo ou video",\n      "format": "9:16 ou 1:1 ou 16:9"\n    }\n  ]\n}\n\nGénère EXACTEMENT 20 prompts variés couvrant différents angles et concepts.';

  const userMessage = 'Analyse ce site web et génère 20 prompts marketing créatifs.\n\nURL du site : ' + siteUrl + '\n\nCONTENU DU SITE :\n' + siteContent + '\n\nRéponds UNIQUEMENT avec le JSON demandé, sans texte avant ou après.';

  console.log('🤖 Appel Claude API...');
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userMessage }
      ],
      system: systemPrompt,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erreur Claude API:', errorText);
    throw new Error('Claude API error: ' + response.status);
  }
  
  const data = await response.json();
  const content = data.content[0]?.text;
  
  if (!content) {
    throw new Error('Réponse Claude vide');
  }
  
  console.log('✅ Réponse Claude reçue');
  
  try {
    const cleanContent = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const result = JSON.parse(cleanContent);
    return result;
  } catch (parseError) {
    console.error('Erreur parsing JSON:', content.slice(0, 500));
    throw new Error('Impossible de parser la réponse Claude');
  }
}

// Ajouter les prompts à Supabase
async function addPromptsToSupabase(prompts: PromptItem[], brandName: string): Promise<number> {
  const rows = prompts.map(p => ({
    brand: brandName,
    prompt: p.prompt,
    format: p.format || '9:16',
    type: p.type || 'photo',
    angle: p.angle || null,
    concept: p.concept || null,
    status: 'pending',
    image_url: null,
  }));

  const { data, error } = await supabase
    .from('prompts')
    .insert(rows)
    .select();

  if (error) {
    console.error('Erreur Supabase:', error);
    throw new Error('Erreur insertion Supabase: ' + error.message);
  }

  console.log('✅ ' + rows.length + ' prompts ajoutés à Supabase');
  return rows.length;
}

// Compter les prompts existants pour une marque
async function countExistingPrompts(brandName: string): Promise<number> {
  const { count, error } = await supabase
    .from('prompts')
    .select('*', { count: 'exact', head: true })
    .eq('brand', brandName);

  if (error) {
    console.error('Erreur count:', error);
    return 0;
  }

  return count || 0;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, brandOverride } = body;
    
    if (!url) {
      return NextResponse.json({
        success: false,
        error: 'URL du site requise'
      }, { status: 400 });
    }
    
    console.log('🌐 Analyse du site: ' + url);
    
    // Étape 1 : Fetch le contenu du site
    console.log('📥 Récupération du contenu...');
    const siteContent = await fetchWebsite(url);
    console.log('📄 Contenu récupéré: ' + siteContent.length + ' caractères');
    
    // Étape 2 : Analyser avec Claude
    console.log('🧠 Analyse avec Claude...');
    const { analysis, prompts } = await callClaude(siteContent, url, 0);
    const brandName = brandOverride || analysis.brandName;
    
    // Compter les existants pour info
    const existingCount = await countExistingPrompts(brandName);
    console.log('📊 Prompts existants pour ' + brandName + ': ' + existingCount);
    console.log('✅ ' + prompts.length + ' nouveaux prompts générés');
    
    // Étape 3 : Ajouter à Supabase
    console.log('💾 Ajout à Supabase...');
    const addedCount = await addPromptsToSupabase(prompts, brandName);
    
    return NextResponse.json({
      success: true,
      analysis,
      prompts,
      promptCount: prompts.length,
      addedToDatabase: addedCount,
      totalForBrand: existingCount + addedCount,
      message: prompts.length + ' prompts générés pour ' + brandName,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Erreur:', errorMessage);
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}
