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
  message?: string;
  error?: string;
}

interface SiteAnalyzerProps {
  onPromptsGenerated?: () => void;
}

export default function SiteAnalyzer({ onPromptsGenerated }: SiteAnalyzerProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);

  const analyzeSite = async () => {
    if (!url.trim()) {
      setStatus('❌ Entre une URL');
      return;
    }

    setLoading(true);
    setStatus('🌐 Connexion au site...');
    setResult(null);

    try {
      setTimeout(() => setStatus('📥 Analyse du contenu...'), 2000);
      setTimeout(() => setStatus('🧠 Claude génère les prompts...'), 5000);
      setTimeout(() => setStatus('✍️ Création des 20 prompts...'), 10000);
      setTimeout(() => setStatus('💾 Ajout à la base de données...'), 20000);

      const response = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data: AnalyzeResult = await response.json();

      if (data.success) {
        setStatus(`✅ ${data.promptCount} prompts générés et ajoutés !`);
        setResult(data);
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
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        🔍 Générateur de Prompts IA
      </h2>
      
      <p className="text-gray-600 mb-4">
        Entre l'URL de ton site web. Claude va l'analyser et générer <strong>20 prompts marketing</strong> optimisés pour tes publicités.
      </p>

      <div className="flex gap-3 mb-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example.com"
          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none transition-colors"
          disabled={loading}
        />
        <button
          onClick={analyzeSite}
          disabled={loading || !url.trim()}
          className={`px-6 py-3 rounded-xl font-semibold transition-all ${
            loading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105'
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Analyse...
            </span>
          ) : (
            '🚀 Analyser'
          )}
        </button>
      </div>

      {status && (
        <div className={`p-4 rounded-xl mb-4 ${
          status.startsWith('✅') ? 'bg-green-50 text-green-700' :
          status.startsWith('❌') ? 'bg-red-50 text-red-700' :
          'bg-blue-50 text-blue-700'
        }`}>
          {status}
        </div>
      )}

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
        💡 L'analyse prend environ 30-40 secondes. Les prompts sont automatiquement ajoutés à ta base de données.
      </div>
    </div>
  );
}
