import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' })
      }
    }
  );
}

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

// ── Étape 1 : Fetch le contenu du site ──
async function fetchWebsite(url: string): Promise<string> {
  let normalizedUrl = url;
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  // Tentative 1 : fetch direct avec headers navigateur
  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });

    if (response.ok) {
      const html = await response.text();
      const cleanText = cleanHtml(html);
      if (cleanText.length > 200) {
        console.log('✅ Fetch direct OK');
        return cleanText;
      }
    }
    console.log(`⚠️ Fetch direct échoué (${response.status}), fallback Jina Reader...`);
  } catch (e) {
    console.log('⚠️ Fetch direct échoué, fallback Jina Reader...');
  }

  // Tentative 2 : Jina Reader (passe Cloudflare, WAF, etc.)
  try {
    const jinaResponse = await fetch(`https://r.jina.ai/${normalizedUrl}`, {
      headers: {
        'Accept': 'text/plain',
      },
    });

    if (!jinaResponse.ok) {
      throw new Error('Jina Reader: HTTP ' + jinaResponse.status);
    }

    const text = await jinaResponse.text();
    const cleanText = text.trim().slice(0, 15000);

    if (cleanText.length < 100) {
      throw new Error('Contenu trop court');
    }

    console.log('✅ Jina Reader OK');
    return cleanText;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Jina Reader échoué:', errorMessage);
    throw new Error('Impossible de charger le site: ' + url + ' (protégé contre le scraping)');
  }
}

function cleanHtml(html: string): string {
  return html
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
}

// ── Étape 2a : Analyser le site (sans générer de prompts) ──
async function analyzeWithClaude(siteContent: string, siteUrl: string): Promise<SiteAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const systemPrompt = `Tu es un expert en marketing digital. Analyse le contenu de ce site web et extrais les informations clés de la marque.

FORMAT DE RÉPONSE (JSON strict) :
{
  "brandName": "nom de la marque",
  "positioning": "positionnement en 1-2 phrases",
  "usps": ["USP 1", "USP 2", "USP 3"],
  "values": ["valeur 1", "valeur 2", "valeur 3"],
  "products": ["produit/catégorie 1", "produit/catégorie 2", "produit/catégorie 3"],
  "targetAudience": "description de la cible principale",
  "tone": "ton de communication de la marque",
  "socialProof": ["preuve sociale 1", "preuve sociale 2"]
}

IMPORTANT pour les produits : liste chaque CATÉGORIE ou TYPE de produit distinct, pas des produits individuels.
Par exemple pour une pépinière : "Arbustes", "Vivaces", "Fruitiers", "Grimpantes", "Conifères"
Par exemple pour une boutique de vêtements : "Robes", "Pantalons", "Accessoires", "Chaussures"
Ces catégories serviront de groupes de produits pour la génération de visuels ciblés.

Réponds UNIQUEMENT avec le JSON, sans texte avant ou après.`;

  const userMessage = `Analyse ce site web.\n\nURL : ${siteUrl}\n\nCONTENU :\n${siteContent}`;

  console.log('🤖 Appel Claude API (analyse uniquement)...');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erreur Claude API:', errorText);
    throw new Error('Erreur API analyse: ' + response.status);
  }

  const data = await response.json();
  const content = data.content[0]?.text;
  if (!content) throw new Error('Réponse analyse vide');

  console.log('✅ Analyse reçue');

  const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleanContent);
}

// ── Étape 2b : Générer des prompts ciblés sur un produit ──
async function generatePromptsWithClaude(
  analysis: SiteAnalysis,
  siteUrl: string,
  existingCount: number,
  contentType: 'photo' | 'video' | 'both',
  promptCount: number,
  targetProduct?: string,
  productPageContent?: string
): Promise<PromptItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const conceptsList = CREATIVE_CONCEPTS.map((c, i) => (i + 1) + '. ' + c).join('\n');

  const variationNote = existingCount > 0
    ? `\n\nIMPORTANT: Cette marque a déjà ${existingCount} prompts en base. Génère des prompts DIFFÉRENTS et NOUVEAUX, avec des angles et concepts variés.`
    : '';

  // ── Instruction produit ciblé ──
  let productInstruction = '';
  if (targetProduct) {
    productInstruction = `\n\nPRODUIT CIBLÉ : "${targetProduct}"
IMPORTANT : TOUS les prompts doivent mettre en scène SPÉCIFIQUEMENT ce produit/catégorie "${targetProduct}".
- Chaque prompt doit montrer ce produit en situation
- Les visuels doivent être cohérents avec ce type de produit
- Ne mélange PAS avec d'autres catégories de produits de la marque
- Adapte les compositions, décors et mises en scène à "${targetProduct}"`;
    if (productPageContent) {
      productInstruction += `\n\nINFORMATIONS DÉTAILLÉES DU PRODUIT (extraites de la page produit) :\n${productPageContent.slice(0, 5000)}\n\nUtilise ces détails pour rendre les prompts plus précis et pertinents : caractéristiques, couleurs, matières, usages, etc.`;
    }
  } else {
    productInstruction = `\n\nPRODUITS : ${analysis.products.join(', ')}
Répartis les prompts entre les différents produits de la marque.`;
  }

  let typeInstruction = '';
  if (contentType === 'photo') {
    typeInstruction = '\n\nTYPE : Génère UNIQUEMENT des prompts "photo". Optimise pour images fixes : compositions, éclairages, angles de vue.';
  } else if (contentType === 'video') {
    typeInstruction = '\n\nTYPE : Génère UNIQUEMENT des prompts "video". Optimise pour vidéo : mouvements de caméra, actions, transitions, séquences dynamiques.';
  } else {
    typeInstruction = '\n\nTYPE : Génère un MIX photo ET vidéo (environ 50/50).';
  }

  const systemPrompt = `Tu es un expert en création de contenu publicitaire pour Meta Ads, TikTok, Instagram.

MARQUE ANALYSÉE :
- Nom : ${analysis.brandName}
- Positionnement : ${analysis.positioning}
- USPs : ${analysis.usps.join(', ')}
- Valeurs : ${analysis.values.join(', ')}
- Cible : ${analysis.targetAudience}
- Ton : ${analysis.tone}
${productInstruction}

CONCEPTS CRÉATIFS 2026 :
${conceptsList}
${typeInstruction}

RÈGLES :
- Prompts en ANGLAIS
- Descriptions visuelles détaillées de 2-4 phrases
- Mentionner le produit naturellement
- Varier angles marketing : bénéfices, émotions, social proof, lifestyle
- Finir chaque prompt par "no text, no watermark"
${variationNote}

FORMAT JSON strict :
{
  "prompts": [
    {
      "prompt": "le prompt créatif en anglais",
      "angle": "angle marketing",
      "concept": "concept créatif",
      "type": "photo ou video",
      "format": "9:16 ou 1:1 ou 16:9"
    }
  ]
}

Génère EXACTEMENT ${promptCount} prompts variés.`;

  const productLabel = targetProduct ? ` pour "${targetProduct}"` : '';
  const userMessage = `Génère ${promptCount} prompts marketing créatifs${productLabel} pour ${analysis.brandName} (${siteUrl}).\n\nRéponds UNIQUEMENT avec le JSON.`;

  console.log(`🤖 Appel Claude API (${promptCount} prompts ${contentType}${productLabel})...`);

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
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erreur Claude API:', errorText);
    throw new Error('Erreur API analyse: ' + response.status);
  }

  const data = await response.json();
  const content = data.content[0]?.text;
  if (!content) throw new Error('Réponse analyse vide');

  console.log('✅ Prompts reçus');

  const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const result = JSON.parse(cleanContent);
  return result.prompts;
}

// ── Étape 2c : Générer des variantes à partir de prompts existants ──
async function generateVariantsWithClaude(
  sourcePrompts: { prompt: string; type: string }[],
  contentType: 'photo' | 'video' | 'both',
  promptCount: number
): Promise<PromptItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const sourceList = sourcePrompts.map((p, i) => `${i + 1}. [${p.type}] ${p.prompt}`).join('\n');

  let typeInstruction = '';
  if (contentType === 'photo') {
    typeInstruction = 'Génère UNIQUEMENT des prompts "photo".';
  } else if (contentType === 'video') {
    typeInstruction = 'Génère UNIQUEMENT des prompts "video" avec mouvements de caméra et actions dynamiques.';
  } else {
    typeInstruction = 'Génère un mix de prompts photo ET vidéo.';
  }

  const systemPrompt = `Tu es un expert en création de contenu publicitaire pour Meta Ads.

L'utilisateur a sélectionné des contenus qu'il considère réussis. Ta mission : générer ${promptCount} VARIANTES inspirées de ces prompts.

PROMPTS SOURCES (ceux qui ont bien marché) :
${sourceList}

RÈGLES POUR LES VARIANTES :
- Garde le même style, ton et niveau de qualité que les sources
- Varie les angles de vue, les compositions, les éclairages, les scènes
- Garde les mêmes produits/marques référencés dans les sources
- Chaque variante doit être suffisamment différente pour ne pas être un doublon
- Prompts en ANGLAIS, 2-4 phrases descriptives
- Finir par "no text, no watermark"
- ${typeInstruction}

TYPES DE VARIATIONS À EXPLORER :
- Même concept, cadrage différent (gros plan → plan large, plongée → contre-plongée)
- Même produit, contexte/décor différent (intérieur → extérieur, matin → soir)
- Même angle marketing, exécution créative différente
- Même ambiance, produit mis en scène différemment

FORMAT JSON strict :
{
  "prompts": [
    {
      "prompt": "le prompt variante en anglais",
      "angle": "angle marketing",
      "concept": "concept créatif",
      "type": "photo ou video",
      "format": "9:16 ou 1:1 ou 16:9"
    }
  ]
}

Génère EXACTEMENT ${promptCount} variantes.`;

  const userMessage = `Génère ${promptCount} variantes créatives inspirées de mes ${sourcePrompts.length} prompts favoris.\n\nRéponds UNIQUEMENT avec le JSON.`;

  console.log(`🤖 Appel Claude API (${promptCount} variantes de ${sourcePrompts.length} sources)...`);

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
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erreur Claude API:', errorText);
    throw new Error('Erreur API analyse: ' + response.status);
  }

  const data = await response.json();
  const content = data.content[0]?.text;
  if (!content) throw new Error('Réponse analyse vide');

  console.log('✅ Variantes reçues');

  const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const result = JSON.parse(cleanContent);
  return result.prompts;
}

// ── Supabase helpers ──
async function addPromptsToSupabase(prompts: PromptItem[], brandName: string, productGroup?: string): Promise<number> {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) throw new Error('CLIENT_ID non configuré');

  const rows = prompts.map(p => ({
    client_id: clientId,
    brand: brandName,
    prompt: p.prompt,
    format: p.format || '9:16',
    type: p.type || 'photo',
    angle: p.angle || null,
    concept: p.concept || null,
    product_group: productGroup || null,
    status: 'pending',
    image_url: null,
  }));

  const { error } = await getSupabase()
    .from('prompts')
    .insert(rows)
    .select();

  if (error) {
    console.error('Erreur Supabase:', error);
    throw new Error('Erreur insertion Supabase: ' + error.message);
  }

  console.log('✅ ' + rows.length + ' prompts ajoutés à Supabase' + (productGroup ? ` (groupe: ${productGroup})` : ''));
  return rows.length;
}

async function countExistingPrompts(brandName: string): Promise<number> {
  const clientId = process.env.CLIENT_ID;
  if (!clientId) return 0;

  const { count, error } = await getSupabase()
    .from('prompts')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('brand', brandName);

  if (error) return 0;
  return count || 0;
}

// ============================================================
// HANDLER POST
// ============================================================
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, action = 'analyze', analysis: existingAnalysis, contentType = 'both', promptCount = 20, brandOverride, sourcePrompts, targetProduct, productUrl } = body;

    // ── ACTION : ANALYZE (étape 1) ──
    if (action === 'analyze') {
      if (!url) {
        return NextResponse.json({ success: false, error: 'URL du site requise' }, { status: 400 });
      }

      console.log('🌐 Analyse du site: ' + url);

      const siteContent = await fetchWebsite(url);
      console.log('📄 Contenu récupéré: ' + siteContent.length + ' caractères');

      const analysis = await analyzeWithClaude(siteContent, url);
      console.log('✅ Analyse terminée pour: ' + analysis.brandName);

      const existingCount = await countExistingPrompts(analysis.brandName);

      return NextResponse.json({
        success: true,
        action: 'analyze',
        analysis,
        existingCount,
      });
    }

    // ── ACTION : GENERATE (étape 2) ──
    if (action === 'generate') {
      if (!existingAnalysis) {
        return NextResponse.json({ success: false, error: 'Analyse manquante. Analyse le site d\'abord.' }, { status: 400 });
      }
      if (!url) {
        return NextResponse.json({ success: false, error: 'URL manquante' }, { status: 400 });
      }

      const brandName = brandOverride || existingAnalysis.brandName;
      const existingCount = await countExistingPrompts(brandName);

      const productLabel = targetProduct ? ` → "${targetProduct}"` : '';
      console.log(`🎯 Génération de ${promptCount} prompts ${contentType}${productLabel} pour ${brandName}`);

      // Fetch product page content if URL provided
      let productPageContent: string | undefined;
      if (productUrl) {
        try {
          console.log(`📄 Récupération de la page produit: ${productUrl}`);
          productPageContent = await fetchWebsite(productUrl);
          console.log(`✅ Page produit récupérée: ${productPageContent.length} caractères`);
        } catch (e) {
          console.warn(`⚠️ Impossible de charger la page produit: ${productUrl}`);
        }
      }

      const prompts = await generatePromptsWithClaude(
        existingAnalysis,
        url,
        existingCount,
        contentType,
        promptCount,
        targetProduct,
        productPageContent
      );

      console.log('💾 Ajout à Supabase...');
      const addedCount = await addPromptsToSupabase(prompts, brandName, targetProduct);

      return NextResponse.json({
        success: true,
        action: 'generate',
        prompts,
        promptCount: prompts.length,
        addedToDatabase: addedCount,
        totalForBrand: existingCount + addedCount,
        contentType,
        targetProduct: targetProduct || null,
        message: `${prompts.length} prompts ${contentType} générés pour ${brandName}${productLabel}`,
      });
    }

    // ── ACTION : VARIANTS (à partir de favoris) ──
    if (action === 'variants') {
      if (!sourcePrompts || sourcePrompts.length === 0) {
        return NextResponse.json({ success: false, error: 'Aucun prompt source fourni.' }, { status: 400 });
      }

      console.log(`✨ Génération de ${promptCount} variantes à partir de ${sourcePrompts.length} favori(s)`);

      const prompts = await generateVariantsWithClaude(sourcePrompts, contentType, promptCount);

      const clientId = process.env.CLIENT_ID || 'default';
      let brandName = brandOverride || 'variants';
      
      if (!brandOverride) {
        const { data: latestPrompt } = await getSupabase()
          .from('prompts')
          .select('brand')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (latestPrompt?.brand) brandName = latestPrompt.brand;
      }

      console.log('💾 Ajout à Supabase...');
      const addedCount = await addPromptsToSupabase(prompts, brandName);

      return NextResponse.json({
        success: true,
        action: 'variants',
        prompts,
        promptCount: prompts.length,
        addedToDatabase: addedCount,
        contentType,
        message: `${prompts.length} variantes générées`,
      });
    }

    // ── LEGACY ──
    if (!url) {
      return NextResponse.json({ success: false, error: 'URL du site requise' }, { status: 400 });
    }

    console.log('🌐 [Legacy] Analyse + génération pour: ' + url);

    const siteContent = await fetchWebsite(url);
    const analysis = await analyzeWithClaude(siteContent, url);
    const brandName = brandOverride || analysis.brandName;
    const existingCount = await countExistingPrompts(brandName);
    const prompts = await generatePromptsWithClaude(analysis, url, existingCount, 'both', 20);
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
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
