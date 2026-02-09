'use client';

import { useState } from 'react';

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

interface SiteAnalyzerProps {
  onPromptsGenerated?: () => void;
}

export default function SiteAnalyzer({ onPromptsGenerated }: SiteAnalyzerProps) {
  const [url, setUrl] = useState('');
  
  // Étape 1 : Analyse
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<SiteAnalysis | null>(null);
  const [existingCount, setExistingCount] = useState(0);
  
  // Étape 2 : Génération
  const [generating, setGenerating] = useState(false);
  const [generatingType, setGeneratingType] = useState<string>('');
  const [promptCount, setPromptCount] = useState(20);
  
  // Résultats
  const [status, setStatus] = useState('');
  const [lastPrompts, setLastPrompts] = useState<PromptItem[] | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  // Track combien ont été générés par type
  const [generatedCounts, setGeneratedCounts] = useState<{ photo: number; video: number; both: number }>({ photo: 0, video: 0, both: 0 });
  const [generationHistory, setGenerationHistory] = useState<{ type: string; count: number; timestamp: number }[]>([]);

  // ── Étape 1 : Analyser le site ──
  const analyzeSite = async () => {
    if (!url.trim()) { setStatus('❌ Entre une URL'); return; }

    setAnalyzing(true);
    setAnalysis(null);
    setLastPrompts(null);
    setGenerationHistory([]);
    setGeneratedCounts({ photo: 0, video: 0, both: 0 });
    setStatus('🌐 Connexion au site...');

    try {
      setTimeout(() => setStatus('📥 Récupération du contenu...'), 2000);
      setTimeout(() => setStatus('🧠 Claude analyse la marque...'), 5000);

      const response = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), action: 'analyze' }),
      });

      const data = await response.json();

      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
        setExistingCount(data.existingCount || 0);
        setStatus('');
      } else {
        setStatus(`❌ ${data.error || 'Erreur lors de l\'analyse'}`);
      }
    } catch (error: any) {
      setStatus(`❌ Erreur: ${error.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Étape 2 : Générer les prompts ──
  const generatePrompts = async (contentType: 'photo' | 'video' | 'both') => {
    if (!analysis) return;

    setGenerating(true);
    setGeneratingType(contentType);
    setLastPrompts(null);
    setShowPrompts(false);

    const typeLabel = contentType === 'photo' ? '📷 images' : contentType === 'video' ? '🎬 vidéos' : '📷🎬 mixtes';
    setStatus(`✍️ Génération de ${promptCount} prompts ${typeLabel}...`);

    try {
      setTimeout(() => setStatus(`🧠 Claude crée les prompts ${typeLabel}...`), 3000);
      setTimeout(() => setStatus('💾 Ajout à la base de données...'), 15000);

      const response = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          action: 'generate',
          analysis,
          contentType,
          promptCount,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setLastPrompts(data.prompts);
        setExistingCount(data.totalForBrand || existingCount + (data.promptCount || 0));
        setGeneratedCounts(prev => ({ ...prev, [contentType]: prev[contentType] + (data.promptCount || 0) }));
        setGenerationHistory(prev => [
          { type: contentType, count: data.promptCount || 0, timestamp: Date.now() },
          ...prev,
        ]);
        setStatus(`✅ ${data.promptCount} prompts ${typeLabel} ajoutés !`);
        if (onPromptsGenerated) onPromptsGenerated();
      } else {
        setStatus(`❌ ${data.error || 'Erreur lors de la génération'}`);
      }
    } catch (error: any) {
      setStatus(`❌ Erreur: ${error.message}`);
    } finally {
      setGenerating(false);
      setGeneratingType('');
    }
  };

  // ── Labels dynamiques ──
  const hasGenerated = (type: 'photo' | 'video' | 'both') => generatedCounts[type] > 0;
  const totalGenerated = generatedCounts.photo + generatedCounts.video + generatedCounts.both;

  const getButtonLabel = (type: 'photo' | 'video' | 'both') => {
    const icon = type === 'photo' ? '📷' : type === 'video' ? '🎬' : '📷🎬';
    const name = type === 'photo' ? 'Images' : type === 'video' ? 'Vidéos' : 'Les deux';
    
    if (hasGenerated(type)) {
      return `${icon} + ${promptCount} ${name}`;
    }
    return `${icon} ${promptCount} ${name}`;
  };

  const typeIcon = (type: string) => type === 'photo' ? '📷' : type === 'video' ? '🎬' : '📷🎬';

  const isLoading = analyzing || generating;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        🔍 Générateur de Prompts IA
      </h2>

      {/* ── Étape 1 : URL + Analyser ── */}
      <div className="flex gap-3 mb-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example.com"
          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none transition-colors"
          disabled={isLoading}
          onKeyDown={(e) => e.key === 'Enter' && !isLoading && analyzeSite()}
        />
        <button
          onClick={analyzeSite}
          disabled={isLoading || !url.trim()}
          className={`px-6 py-3 rounded-xl font-semibold transition-all ${
            analyzing
              ? 'bg-gray-300 text-gray-500 cursor-wait'
              : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 active:scale-95'
          } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
        >
          {analyzing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
              Analyse...
            </span>
          ) : analysis ? '🔄 Ré-analyser' : '🔍 Analyser le site'}
        </button>
      </div>

      {/* Status (seulement erreurs ou loading, pas le succès d'analyse) */}
      {status && (
        <div className={`p-4 rounded-xl mb-4 text-sm font-medium ${
          status.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' :
          status.startsWith('❌') ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {status}
        </div>
      )}

      {/* ── Résultat de l'analyse ── */}
      {analysis && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-5 border border-purple-100">
            <h3 className="font-bold text-lg mb-3 text-purple-800">
              📊 {analysis.brandName}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-700">Positionnement :</span>
                <p className="text-gray-600">{analysis.positioning}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Cible :</span>
                <p className="text-gray-600">{analysis.targetAudience}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Ton :</span>
                <p className="text-gray-600">{analysis.tone}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">USPs :</span>
                <ul className="text-gray-600 list-disc list-inside">
                  {analysis.usps.slice(0, 3).map((usp, i) => <li key={i}>{usp}</li>)}
                </ul>
              </div>
              {analysis.products.length > 0 && (
                <div>
                  <span className="font-semibold text-gray-700">Produits :</span>
                  <p className="text-gray-600">{analysis.products.join(', ')}</p>
                </div>
              )}
              {analysis.values.length > 0 && (
                <div>
                  <span className="font-semibold text-gray-700">Valeurs :</span>
                  <p className="text-gray-600">{analysis.values.join(', ')}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Étape 2 : Générer les prompts ── */}
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800">
                {totalGenerated > 0 ? `✨ Ajouter des prompts (${existingCount} en base)` : '✨ Générer des prompts'}
              </h3>
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                <label className="text-sm font-medium text-gray-600">Nb :</label>
                <select
                  value={promptCount}
                  onChange={(e) => setPromptCount(parseInt(e.target.value))}
                  disabled={generating}
                  className="bg-transparent text-sm font-semibold text-gray-800 focus:outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                </select>
              </div>
            </div>

            {totalGenerated === 0 && (
              <p className="text-sm text-gray-500 mb-3">Choisis le type de contenu pour lequel générer des prompts marketing :</p>
            )}

            <div className="grid grid-cols-3 gap-3">
              {(['photo', 'video', 'both'] as const).map((type) => {
                const isActive = generating && generatingType === type;
                const colors = type === 'photo'
                  ? { active: 'bg-blue-100 text-blue-500', normal: 'bg-gradient-to-r from-blue-500 to-blue-600' }
                  : type === 'video'
                  ? { active: 'bg-red-100 text-red-500', normal: 'bg-gradient-to-r from-red-500 to-red-600' }
                  : { active: 'bg-purple-100 text-purple-500', normal: 'bg-gradient-to-r from-purple-600 to-indigo-600' };

                return (
                  <button
                    key={type}
                    onClick={() => generatePrompts(type)}
                    disabled={generating}
                    className={`px-4 py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 text-sm ${
                      isActive
                        ? `${colors.active} cursor-wait`
                        : generating
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : `${colors.normal} text-white hover:shadow-lg hover:scale-105 active:scale-95`
                    }`}
                  >
                    {isActive ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        En cours...
                      </span>
                    ) : getButtonLabel(type)}
                  </button>
                );
              })}
            </div>

            {/* Historique des générations */}
            {generationHistory.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-200">
                <span className="text-xs text-gray-500 font-medium self-center">Historique :</span>
                {generationHistory.map((gen, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-gray-600 rounded-full text-xs font-medium border border-gray-200">
                    {typeIcon(gen.type)} ×{gen.count} — {new Date(gen.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Derniers prompts générés ── */}
          {lastPrompts && lastPrompts.length > 0 && (
            <div>
              <button
                onClick={() => setShowPrompts(!showPrompts)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors"
              >
                {showPrompts ? '🔼 Masquer les prompts' : `🔽 Voir les ${lastPrompts.length} derniers prompts générés`}
              </button>

              {showPrompts && (
                <div className="max-h-96 overflow-y-auto space-y-3 border rounded-xl p-4 mt-3">
                  {lastPrompts.map((p, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                      <div className="flex gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">{p.angle}</span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">{p.concept}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.type === 'video' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {p.type} • {p.format}
                        </span>
                      </div>
                      <p className="text-gray-700">{p.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        {!analysis
          ? '💡 Analyse le site d\'abord, puis choisis le type de prompts à générer.'
          : totalGenerated > 0
          ? '💡 Chaque clic ajoute de nouveaux prompts différents à la base. Claude varie automatiquement les angles.'
          : '💡 Après la 1ère génération, tu pourras en ajouter autant que tu veux.'
        }
      </div>
    </div>
  );
}
