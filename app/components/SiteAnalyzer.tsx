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

interface AnalyzeResult {
  success: boolean;
  analysis?: SiteAnalysis;
  prompts?: PromptItem[];
  promptCount?: number;
  addedToDatabase?: number;
  totalForBrand?: number;
  contentType?: string;
  message?: string;
  error?: string;
}

interface SiteAnalyzerProps {
  onPromptsGenerated?: () => void;
}

export default function SiteAnalyzer({ onPromptsGenerated }: SiteAnalyzerProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingType, setLoadingType] = useState<string>('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptCount, setPromptCount] = useState(20);
  // Historique des générations
  const [generationHistory, setGenerationHistory] = useState<{ type: string; count: number; timestamp: number }[]>([]);

  const generatePrompts = async (contentType: 'photo' | 'video' | 'both') => {
    if (!url.trim()) {
      setStatus('❌ Entre une URL');
      return;
    }

    setLoading(true);
    setLoadingType(contentType);
    setStatus('🌐 Connexion au site...');
    setResult(null);

    const typeLabel = contentType === 'photo' ? '📷 images' : contentType === 'video' ? '🎬 vidéos' : '📷🎬 mixtes';

    try {
      setTimeout(() => { if (loading) setStatus('📥 Analyse du contenu...'); }, 2000);
      setTimeout(() => { if (loading) setStatus(`🧠 Claude génère ${promptCount} prompts ${typeLabel}...`); }, 5000);
      setTimeout(() => { if (loading) setStatus(`✍️ Création des prompts ${typeLabel}...`); }, 10000);
      setTimeout(() => { if (loading) setStatus('💾 Ajout à la base de données...'); }, 20000);

      const response = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: url.trim(),
          contentType,
          promptCount,
        }),
      });

      const data: AnalyzeResult = await response.json();

      if (data.success) {
        setStatus(`✅ ${data.promptCount} prompts ${typeLabel} générés et ajoutés !`);
        setResult(data);
        setGenerationHistory(prev => [
          { type: contentType, count: data.promptCount || 0, timestamp: Date.now() },
          ...prev,
        ]);
        if (onPromptsGenerated) {
          onPromptsGenerated();
        }
      } else {
        setStatus(`❌ ${data.error}`);
      }
    } catch (error: any) {
      setStatus(`❌ Erreur: ${error.message}`);
    } finally {
      setLoading(false);
      setLoadingType('');
    }
  };

  const typeLabel = (type: string) => {
    if (type === 'photo') return '📷 Images';
    if (type === 'video') return '🎬 Vidéos';
    return '📷🎬 Mixte';
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        🔍 Générateur de Prompts IA
      </h2>
      
      <p className="text-gray-600 mb-4">
        Entre l'URL de ton site web. Claude va l'analyser et générer des <strong>prompts marketing</strong> optimisés pour tes publicités.
      </p>

      {/* URL Input */}
      <div className="flex gap-3 mb-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example.com"
          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none transition-colors"
          disabled={loading}
        />
        <div className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-xl border border-gray-200">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Nb:</label>
          <select
            value={promptCount}
            onChange={(e) => setPromptCount(parseInt(e.target.value))}
            disabled={loading}
            className="bg-transparent text-sm font-semibold text-gray-800 focus:outline-none cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </div>
      </div>

      {/* Boutons de génération */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <button
          onClick={() => generatePrompts('photo')}
          disabled={loading || !url.trim()}
          className={`px-4 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
            loading && loadingType === 'photo'
              ? 'bg-blue-100 text-blue-500 cursor-wait'
              : loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:shadow-lg hover:scale-105 active:scale-95'
          }`}
        >
          {loading && loadingType === 'photo' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              En cours...
            </span>
          ) : (
            <>📷 Prompts Images</>
          )}
        </button>

        <button
          onClick={() => generatePrompts('video')}
          disabled={loading || !url.trim()}
          className={`px-4 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
            loading && loadingType === 'video'
              ? 'bg-red-100 text-red-500 cursor-wait'
              : loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:shadow-lg hover:scale-105 active:scale-95'
          }`}
        >
          {loading && loadingType === 'video' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              En cours...
            </span>
          ) : (
            <>🎬 Prompts Vidéos</>
          )}
        </button>

        <button
          onClick={() => generatePrompts('both')}
          disabled={loading || !url.trim()}
          className={`px-4 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${
            loading && loadingType === 'both'
              ? 'bg-purple-100 text-purple-500 cursor-wait'
              : loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105 active:scale-95'
          }`}
        >
          {loading && loadingType === 'both' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              En cours...
            </span>
          ) : (
            <>📷🎬 Les deux</>
          )}
        </button>
      </div>

      {/* Historique des générations */}
      {generationHistory.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {generationHistory.map((gen, i) => (
            <span key={i} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
              {typeLabel(gen.type)} × {gen.count} — {new Date(gen.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ))}
        </div>
      )}

      {/* Status */}
      {status && (
        <div className={`p-4 rounded-xl mb-4 ${
          status.startsWith('✅') ? 'bg-green-50 text-green-700' :
          status.startsWith('❌') ? 'bg-red-50 text-red-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {status}
        </div>
      )}

      {/* Résultats */}
      {result?.success && result.analysis && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-5">
            <h3 className="font-bold text-lg mb-3 text-purple-800">
              📊 Analyse : {result.analysis.brandName}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-700">Positionnement :</span>
                <p className="text-gray-600">{result.analysis.positioning}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Cible :</span>
                <p className="text-gray-600">{result.analysis.targetAudience}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Ton :</span>
                <p className="text-gray-600">{result.analysis.tone}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">USPs :</span>
                <ul className="text-gray-600 list-disc list-inside">
                  {result.analysis.usps.slice(0, 3).map((usp, i) => (
                    <li key={i}>{usp}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{result.promptCount}</div>
              <div className="text-sm text-green-700">Prompts générés</div>
            </div>
            <div className="flex-1 bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{result.totalForBrand || result.addedToDatabase}</div>
              <div className="text-sm text-blue-700">Total en base</div>
            </div>
          </div>

          <button
            onClick={() => setShowPrompts(!showPrompts)}
            className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors"
          >
            {showPrompts ? '🔼 Masquer les prompts' : '🔽 Voir les prompts générés'}
          </button>

          {showPrompts && result.prompts && (
            <div className="max-h-96 overflow-y-auto space-y-3 border rounded-xl p-4">
              {result.prompts.map((p, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                      {p.angle}
                    </span>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                      {p.concept}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      p.type === 'video' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}>
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

      <div className="mt-4 text-xs text-gray-500">
        💡 L'analyse prend environ 30-40 secondes. Tu peux relancer autant de fois que tu veux pour ajouter plus de prompts.
      </div>
    </div>
  );
}
